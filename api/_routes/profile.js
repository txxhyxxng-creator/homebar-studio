const { admin, getAdminApp, verifyBearer, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function sanitizeNickname(value) {
  return String(value || '').replace(/[<>\n\r\t]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 20);
}

function isValidAvatar(value) {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  // Profile images are stored as compact data URLs by the client.
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value)) return false;
  // Keep Firestore documents comfortably below the 1 MiB limit.
  return Buffer.byteLength(value, 'utf8') <= 400 * 1024;
}

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req);
    if (!enforceRateLimit(req, res, `profile:${decoded.uid}`, 30, 60_000)) return;

    const app = getAdminApp();
    const db = admin.firestore(app);
    const ref = db.doc(`profiles/${decoded.uid}`);

    if (req.method === 'GET') {
      const snap = await ref.get();
      if (!snap.exists) {
        const fallback = String(decoded.email || '').split('@')[0] || 'BarTail User';
        return json(res, 200, { profile: { uid: decoded.uid, nickname: sanitizeNickname(fallback) || 'BarTail User', avatar: '' } });
      }
      const data = snap.data() || {};
      return json(res, 200, {
        profile: {
          uid: decoded.uid,
          nickname: sanitizeNickname(data.nickname) || 'BarTail User',
          avatar: typeof data.avatar === 'string' ? data.avatar : ''
        }
      });
    }

    if (req.method !== 'POST' && req.method !== 'PATCH') return json(res, 405, { error: 'GET, POST, PATCH만 허용됩니다.' });

    const body = req.body || {};
    const nickname = sanitizeNickname(body.nickname);
    const avatar = body.avatar == null ? '' : body.avatar;
    if (nickname.length < 2) return json(res, 400, { error: '닉네임은 2자 이상 입력해주세요.' });
    if (!isValidAvatar(avatar)) return json(res, 400, { error: '프로필 사진 형식이 올바르지 않거나 파일이 너무 큽니다.' });

    await ref.set({
      uid: decoded.uid,
      nickname,
      avatar,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(body.createIfMissing ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {})
    }, { merge: true });

    return json(res, 200, { ok: true, profile: { uid: decoded.uid, nickname, avatar } });
  } catch (error) {
    console.error('profile API failed:', error);
    const message = error?.message || '프로필 처리에 실패했습니다.';
    const status = /인증 토큰|로그인/.test(message) ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `프로필 처리 서버 오류: ${message}` });
  }
};
