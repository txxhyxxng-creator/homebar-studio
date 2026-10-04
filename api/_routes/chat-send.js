const { admin, getAdminApp, verifyBearer, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function isValidAccess(data) {
  if (!data || data.active !== true) return false;
  const now = Date.now();
  const from = data.validFrom?.toDate ? data.validFrom.toDate().getTime() : (data.validFrom ? new Date(data.validFrom).getTime() : null);
  const until = data.validUntil?.toDate ? data.validUntil.toDate().getTime() : (data.validUntil ? new Date(data.validUntil).getTime() : null);
  return (!from || from <= now) && (!until || until >= now);
}

function chatIdFor(uidA, uidB) {
  return [String(uidA), String(uidB)].sort().join('__');
}

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req);
    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 허용됩니다.' });
    if (!enforceRateLimit(req, res, `chat-send:${decoded.uid}`, 30, 60_000)) return;

    const otherUid = String(req.body?.otherUid || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!otherUid) return json(res, 400, { error: '대화 상대가 필요합니다.' });
    if (otherUid === decoded.uid) return json(res, 400, { error: '자기 자신에게는 메시지를 보낼 수 없습니다.' });
    if (!text) return json(res, 400, { error: '메시지를 입력해주세요.' });
    if (text.length > 2000) return json(res, 400, { error: '메시지는 2000자 이하로 입력해주세요.' });

    const app = getAdminApp();
    const auth = admin.auth(app);
    const db = admin.firestore(app);
    const target = await auth.getUser(otherUid);
    if (target.disabled) return json(res, 403, { error: '현재 대화할 수 없는 사용자입니다.' });
    if (target.customClaims?.admin === true) return json(res, 403, { error: '관리자 계정과는 일반 사용자 채팅을 할 수 없습니다.' });

    const accessRefs = [db.doc(`users/${decoded.uid}/access/meta`), db.doc(`users/${otherUid}/access/meta`)];
    const [senderAccess, targetAccess] = await db.getAll(...accessRefs);
    if (!senderAccess.exists || !targetAccess.exists || !isValidAccess(senderAccess.data()) || !isValidAccess(targetAccess.data())) {
      return json(res, 403, { error: '현재 이용권이 활성화된 사용자끼리만 채팅할 수 있습니다.' });
    }

    const chatId = chatIdFor(decoded.uid, otherUid);
    const chatRef = db.collection('chats').doc(chatId);
    const messageRef = chatRef.collection('messages').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async tx => {
      const chatSnap = await tx.get(chatRef);
      const participants = [decoded.uid, otherUid];
      if (chatSnap.exists) {
        const existing = chatSnap.data() || {};
        const existingParticipants = Array.isArray(existing.participantIds) ? existing.participantIds : [];
        if (existingParticipants.length !== 2 || !existingParticipants.includes(decoded.uid) || !existingParticipants.includes(otherUid)) {
          throw new Error('대화 정보가 올바르지 않습니다.');
        }
      } else {
        tx.set(chatRef, { participantIds: participants, createdAt: now, updatedAt: now, lastMessage: text.slice(0, 160), lastSenderId: decoded.uid });
      }
      if (chatSnap.exists) {
        tx.update(chatRef, { updatedAt: now, lastMessage: text.slice(0, 160), lastSenderId: decoded.uid });
      }
      tx.set(messageRef, { senderId: decoded.uid, text, createdAt: now });
    });

    return json(res, 200, { ok: true, chatId, messageId: messageRef.id });
  } catch (error) {
    console.error('POST /api/chat-send failed:', error);
    const message = error?.message || '메시지를 전송하지 못했습니다.';
    const status = message.includes('대화 정보가 올바르지 않습니다') ? 409 : 500;
    return json(res, status, { error: status === 409 ? message : `메시지 전송 서버 오류: ${message}` });
  }
};
