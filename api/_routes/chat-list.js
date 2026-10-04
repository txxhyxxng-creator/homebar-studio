const { admin, getAdminApp, verifyBearer, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isValidAccess(data) {
  if (!data || data.active !== true) return false;
  const now = Date.now();
  const from = toMillis(data.validFrom);
  const until = toMillis(data.validUntil);
  return (!from || from <= now) && (!until || until >= now);
}

function fallbackNickname(email) {
  return String(email || '').split('@')[0] || 'BarTail User';
}

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req);
    if (req.method !== 'GET') return json(res, 405, { error: 'GET만 허용됩니다.' });
    if (!enforceRateLimit(req, res, `chat-list:${decoded.uid}`, 30, 60_000)) return;

    const app = getAdminApp();
    const auth = admin.auth(app);
    const db = admin.firestore(app);
    const ownAccess = await db.doc(`users/${decoded.uid}/access/meta`).get();
    if (!ownAccess.exists || !isValidAccess(ownAccess.data())) {
      return json(res, 403, { error: '이용권이 활성화된 사용자만 채팅을 이용할 수 있습니다.' });
    }

    const snap = await db.collection('chats').where('participantIds', 'array-contains', decoded.uid).get();
    const chats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));

    const otherIds = [...new Set(chats.flatMap(chat => Array.isArray(chat.participantIds) ? chat.participantIds : []).filter(uid => uid && uid !== decoded.uid))];
    const userMap = new Map();
    for (let start = 0; start < otherIds.length; start += 200) {
      const ids = otherIds.slice(start, start + 200);
      const [authUsers, accessSnaps, profileSnaps] = await Promise.all([
        Promise.all(ids.map(uid => auth.getUser(uid).catch(() => null))),
        db.getAll(...ids.map(uid => db.doc(`users/${uid}/access/meta`))),
        db.getAll(...ids.map(uid => db.doc(`profiles/${uid}`)))
      ]);
      ids.forEach((uid, index) => {
        const user = authUsers[index];
        const access = accessSnaps[index];
        if (!user || user.disabled || user.customClaims?.admin === true || !access.exists || !isValidAccess(access.data())) return;
        const profile = profileSnaps[index].exists ? (profileSnaps[index].data() || {}) : {};
        userMap.set(uid, {
          uid,
          nickname: String(profile.nickname || fallbackNickname(user.email)).slice(0, 20),
          avatar: typeof profile.avatar === 'string' ? profile.avatar : ''
        });
      });
    }

    const result = chats.map(chat => {
      const otherUid = (chat.participantIds || []).find(uid => uid !== decoded.uid);
      const other = userMap.get(otherUid);
      if (!other) return null;
      const lastRead = chat.lastReadAt && chat.lastReadAt[decoded.uid];
      const updatedAt = toMillis(chat.updatedAt);
      const readAt = toMillis(lastRead);
      const unread = chat.lastSenderId && chat.lastSenderId !== decoded.uid && (!readAt || readAt < updatedAt);
      return {
        id: chat.id,
        other,
        lastMessage: String(chat.lastMessage || '').slice(0, 160),
        lastSenderId: String(chat.lastSenderId || ''),
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
        unread: Boolean(unread)
      };
    }).filter(Boolean);

    return json(res, 200, { chats: result, unreadCount: result.filter(item => item.unread).length });
  } catch (error) {
    console.error('GET /api/chat-list failed:', error);
    const message = error?.message || '최근 대화를 불러오지 못했습니다.';
    const status = message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `최근 대화 조회 서버 오류: ${message}` });
  }
};
