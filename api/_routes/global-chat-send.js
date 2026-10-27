const { admin, getAdminApp, verifyBearer, isAdmin, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function accessIsActive(data) {
  if (!data || data.active !== true) return false;
  const now = Date.now();
  const ts = value => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  };
  const from = ts(data.validFrom);
  const until = ts(data.validUntil);
  return (!from || from <= now) && (!until || until >= now);
}

function sanitizeText(value) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, 2000);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 허용됩니다.' });
    const decoded = await verifyBearer(req);
    if (!enforceRateLimit(req, res, `global-chat:${decoded.uid}`, 30, 60_000)) return;

    const db = admin.firestore(getAdminApp());
    if (!isAdmin(decoded)) {
      const access = await db.doc(`users/${decoded.uid}/access/meta`).get();
      if (!access.exists || !accessIsActive(access.data())) {
        return json(res, 403, { error: '이용권이 활성화된 사용자만 채팅을 이용할 수 있습니다.' });
      }
    }

    if (!isAdmin(decoded)) {
      const banSnap = await db.doc(`chatBans/${decoded.uid}`).get();
      if (banSnap.exists) {
        const ban = banSnap.data() || {};
        const until = ban.until?.toMillis ? ban.until.toMillis() : new Date(ban.until || 0).getTime();
        const stillBanned = ban.banned === true && (!until || until >= Date.now());
        if (stillBanned) {
          const untilText = until ? new Date(until).toLocaleString('ko-KR') : '관리자 해제 시까지';
          return json(res, 403, { error: `현재 전체 채팅 이용이 제한되어 있습니다. (${untilText})`, chatBanned: true });
        }
      }
    }

    const text = sanitizeText(req.body?.text);
    if (!text) return json(res, 400, { error: '메시지를 입력해주세요.' });

    const profileSnap = await db.doc(`profiles/${decoded.uid}`).get();
    const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
    const emailName = String(decoded.email || '').split('@')[0] || 'BarTail User';
    const nickname = String(profile.nickname || emailName).replace(/[<>\n\r\t]/g, '').trim().slice(0, 20) || 'BarTail User';
    const avatar = typeof profile.avatar === 'string' ? profile.avatar.slice(0, 600000) : '';

    const ref = await db.collection('globalChat').add({
      senderId: decoded.uid,
      senderNickname: nickname,
      senderAvatar: avatar,
      senderIsAdmin: isAdmin(decoded),
      text,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return json(res, 200, { ok: true, id: ref.id });
  } catch (error) {
    console.error('POST /api/global-chat-send failed:', error);
    const message = error?.message || '메시지 전송에 실패했습니다.';
    const status = message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `채팅 서버 오류: ${message}` });
  }
};
