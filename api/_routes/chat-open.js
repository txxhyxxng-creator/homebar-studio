const { admin, getAdminApp, verifyBearer, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function isValidAccess(data) {
  if (!data || data.active !== true) return false;
  const now = Date.now();
  const from = data.validFrom?.toDate ? data.validFrom.toDate().getTime() : (data.validFrom ? new Date(data.validFrom).getTime() : null);
  const until = data.validUntil?.toDate ? data.validUntil.toDate().getTime() : (data.validUntil ? new Date(data.validUntil).getTime() : null);
  return (!from || from <= now) && (!until || until >= now);
}

function chatIdFor(uidA, uidB) { return [String(uidA), String(uidB)].sort().join('__'); }

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req);
    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 허용됩니다.' });
    if (!enforceRateLimit(req, res, `chat-open:${decoded.uid}`, 40, 60_000)) return;
    const otherUid = String(req.body?.otherUid || '').trim();
    if (!otherUid || otherUid === decoded.uid) return json(res, 400, { error: '올바른 대화 상대가 필요합니다.' });

    const app = getAdminApp();
    const auth = admin.auth(app);
    const db = admin.firestore(app);
    const target = await auth.getUser(otherUid);
    if (target.disabled || target.customClaims?.admin === true) return json(res, 403, { error: '현재 대화할 수 없는 사용자입니다.' });

    const [senderAccess, targetAccess] = await db.getAll(db.doc(`users/${decoded.uid}/access/meta`), db.doc(`users/${otherUid}/access/meta`));
    if (!senderAccess.exists || !targetAccess.exists || !isValidAccess(senderAccess.data()) || !isValidAccess(targetAccess.data())) {
      return json(res, 403, { error: '현재 이용권이 활성화된 사용자끼리만 채팅할 수 있습니다.' });
    }

    const chatId = chatIdFor(decoded.uid, otherUid);
    const ref = db.collection('chats').doc(chatId);
    const snap = await ref.get();
    const participants = [decoded.uid, otherUid];
    const now = admin.firestore.Timestamp.now();
    if (snap.exists) {
      const existing = snap.data() || {};
      const ids = Array.isArray(existing.participantIds) ? existing.participantIds : [];
      if (ids.length !== 2 || !ids.includes(decoded.uid) || !ids.includes(otherUid)) return json(res, 409, { error: '대화 정보가 올바르지 않습니다.' });
      await ref.update({ [`lastReadAt.${decoded.uid}`]: now });
    } else {
      await ref.create({ participantIds: participants, createdAt: now, updatedAt: now, lastMessage: '', lastSenderId: '', lastReadAt: { [decoded.uid]: now } });
    }
    return json(res, 200, { ok: true, chatId });
  } catch (error) {
    console.error('POST /api/chat-open failed:', error);
    const message = error?.message || '대화를 열지 못했습니다.';
    return json(res, 500, { error: `대화 열기 서버 오류: ${message}` });
  }
};
