const { admin, getAdminApp, verifyBearer, isAdmin, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function sanitizeNickname(value, fallback = 'BarTail User') {
  const out = String(value || '').replace(/[<>\n\r\t]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 20);
  return out || fallback;
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
        const profile = { uid: decoded.uid, nickname: fallback, avatar: '' };
        await ref.set({ ...profile, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
      await ref.set({ uid: decoded.uid, nickname, avatar, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return json(res, 200, { ok: true, profile: { uid: decoded.uid, nickname, avatar } });
    }
    return json(res, 405, { error: 'GET/POST만 허용됩니다.' });
  } catch (error) {
    console.error('profile route failed:', error);
    const status = error?.message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? error.message : `프로필 처리 서버 오류: ${error?.message || ''}` });
  }
};
