const { admin, getAdminApp, verifyBearer, isAdmin, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function sanitizeNickname(value, fallback = 'BarTail User') {
  const out = String(value || '').replace(/[<>\n\r\t]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 20);
  return out || fallback;
}

// 닉네임 중복 판정용 정규화: 앞뒤 공백/연속 공백과 영문 대소문자 차이를 무시합니다.
function normalizeNickname(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ko-KR');
}

function nicknameKey(value) {
  return encodeURIComponent(normalizeNickname(value)).slice(0, 1500);
}

function activeAccess(data) {
  if (!data || data.active !== true) return false;
  const ms = value => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  };
  const now = Date.now();
  return (!ms(data.validFrom) || ms(data.validFrom) <= now) && (!ms(data.validUntil) || ms(data.validUntil) >= now);
}

async function canUse(decoded, db) {
  if (isAdmin(decoded)) return true;
  const snap = await db.doc(`users/${decoded.uid}/access/meta`).get();
  return snap.exists && activeAccess(snap.data());
}

async function claimNickname(db, uid, nickname) {
  const normalized = normalizeNickname(nickname);
  const key = nicknameKey(nickname);
  const indexRef = db.doc(`nicknameIndex/${key}`);

  // 기존 profiles가 아직 nicknameIndex를 갖고 있지 않아도 중복을 막습니다.
  // 프로필 저장은 드물기 때문에 이 검사는 안전성을 우선해 전체 프로필을 확인합니다.
  const existingProfiles = await db.collection('profiles').get();
  for (const doc of existingProfiles.docs) {
    if (doc.id === uid) continue;
    const data = doc.data() || {};
    const existingNickname = sanitizeNickname(data.nickname, '');
    if (existingNickname && normalizeNickname(existingNickname) === normalized) {
      const error = new Error('이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.');
      error.code = 'NICKNAME_TAKEN';
      throw error;
    }
  }

  await db.runTransaction(async transaction => {
    const indexSnap = await transaction.get(indexRef);
    if (indexSnap.exists && indexSnap.data()?.uid !== uid) {
      const error = new Error('이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.');
      error.code = 'NICKNAME_TAKEN';
      throw error;
    }
    transaction.set(indexRef, {
      uid,
      nickname,
      normalized,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return normalized;
}

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req);
    const db = admin.firestore(getAdminApp());
    if (!await canUse(decoded, db)) return json(res, 403, { error: '활성 이용권이 필요합니다.' });
    if (!enforceRateLimit(req, res, `profile:${decoded.uid}`, 20, 60_000)) return;

    const ref = db.doc(`profiles/${decoded.uid}`);
    if (req.method === 'GET') {
      const snap = await ref.get();
      const fallback = sanitizeNickname(String(decoded.email || '').split('@')[0]);
      if (!snap.exists) {
        let nickname = fallback;
        try {
          await claimNickname(db, decoded.uid, nickname);
        } catch (error) {
          if (error?.code !== 'NICKNAME_TAKEN') throw error;
          nickname = `${fallback.slice(0, 17)}_${String(decoded.uid).slice(0, 3)}`.slice(0, 20);
          await claimNickname(db, decoded.uid, nickname);
        }
        const profile = { uid: decoded.uid, nickname, avatar: '' };
        await ref.set({ ...profile, nicknameNormalized: normalizeNickname(nickname), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return json(res, 200, { profile });
      }
      const data = snap.data() || {};
      return json(res, 200, { profile: { uid: decoded.uid, nickname: sanitizeNickname(data.nickname, fallback), avatar: typeof data.avatar === 'string' ? data.avatar : '' } });
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const fallback = sanitizeNickname(String(decoded.email || '').split('@')[0]);
      const nickname = sanitizeNickname(req.body?.nickname, fallback);
      if (nickname.length < 2) return json(res, 400, { error: '닉네임은 2자 이상 입력해주세요.' });
      const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.slice(0, 600000) : '';
      const normalized = await claimNickname(db, decoded.uid, nickname);
      await ref.set({ uid: decoded.uid, nickname, nicknameNormalized: normalized, avatar, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return json(res, 200, { ok: true, profile: { uid: decoded.uid, nickname, avatar } });
    }
    return json(res, 405, { error: 'GET/POST/PATCH만 허용됩니다.' });
  } catch (error) {
    console.error('profile route failed:', error);
    if (error?.code === 'NICKNAME_TAKEN') return json(res, 409, { error: error.message });
    const status = error?.message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? error.message : `프로필 처리 서버 오류: ${error?.message || ''}` });
  }
};
