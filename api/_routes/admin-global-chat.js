const { admin, getAdminApp, requireAdmin, json, writeAuditLog } = require('../_lib/firebaseAdmin');

function formatDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function chunk(items, size = 400) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

module.exports = async (req, res) => {
  try {
    const decoded = await requireAdmin(req);
    const db = admin.firestore(getAdminApp());

    if (req.method === 'GET') {
      const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 20), 300);
      const [messageSnap, banSnap, pinnedSnap] = await Promise.all([
        db.collection('globalChat').orderBy('createdAt', 'desc').limit(limit).get(),
        db.collection('chatBans').limit(300).get(),
        db.collection('globalChatMeta').doc('pinned').get()
      ]);

      const messages = messageSnap.docs.map(doc => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          senderId: d.senderId || '',
          senderNickname: d.senderNickname || 'BarTail User',
          senderAvatar: typeof d.senderAvatar === 'string' ? d.senderAvatar : '',
          senderIsAdmin: d.senderIsAdmin === true,
          text: d.text || '',
          createdAt: formatDate(d.createdAt)
        };
      });

      const pinnedData = pinnedSnap.exists ? (pinnedSnap.data() || {}) : {};
      const pinned = {
        enabled: pinnedData.enabled === true && String(pinnedData.text || '').trim().length > 0,
        text: String(pinnedData.text || '').slice(0, 500),
        updatedAt: formatDate(pinnedData.updatedAt),
        updatedByUid: pinnedData.updatedByUid || ''
      };

      const now = Date.now();
      const bans = banSnap.docs.map(doc => {
        const d = doc.data() || {};
        const untilMs = d.until?.toMillis ? d.until.toMillis() : new Date(d.until || 0).getTime();
        return {
          uid: doc.id,
          banned: d.banned === true && (!untilMs || untilMs >= now),
          reason: String(d.reason || ''),
          until: formatDate(d.until),
          createdAt: formatDate(d.createdAt),
          updatedAt: formatDate(d.updatedAt),
          bannedByEmail: d.bannedByEmail || '',
          bannedByUid: d.bannedByUid || ''
        };
      }).filter(item => item.banned);

      return json(res, 200, { messages, bans, pinned, viewerUid: decoded.uid });
    }

    if (req.method === 'DELETE') {
      const messageId = String(req.query?.messageId || '').trim();
      if (!messageId) return json(res, 400, { error: '삭제할 메시지 ID가 없습니다.' });

      const ref = db.collection('globalChat').doc(messageId);
      const snap = await ref.get();
      if (!snap.exists) return json(res, 404, { error: '메시지를 찾을 수 없습니다.' });
      const data = snap.data() || {};
      await ref.delete();

      await writeAuditLog({
        actorUid: decoded.uid,
        actorEmail: decoded.email || null,
        action: 'admin_global_chat_delete_message',
        targetUid: data.senderId || null,
        targetId: messageId,
        metadata: { targetEmail: data.senderNickname || null, textPreview: String(data.text || '').slice(0, 120) }
      });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();

      if (action === 'setPinned' || action === 'unpin') {
        const ref = db.collection('globalChatMeta').doc('pinned');
        if (action === 'setPinned') {
          const text = String(req.body?.text || '').replace(/[<>]/g, '').replace(/\r/g, '').trim().slice(0, 500);
          if (!text) return json(res, 400, { error: '고정 메시지를 입력해주세요.' });
          await ref.set({
            enabled: true,
            text,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedByUid: decoded.uid,
            updatedByEmail: decoded.email || ''
          }, { merge: true });
          await writeAuditLog({
            actorUid: decoded.uid,
            actorEmail: decoded.email || null,
            action: 'admin_global_chat_pin_set',
            targetId: 'globalChatMeta/pinned',
            metadata: { textPreview: text.slice(0, 120) }
          });
          return json(res, 200, { ok: true, enabled: true, text });
        }

        await ref.set({
          enabled: false,
          text: '',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedByUid: decoded.uid,
          updatedByEmail: decoded.email || ''
        }, { merge: true });
        await writeAuditLog({
          actorUid: decoded.uid,
          actorEmail: decoded.email || null,
          action: 'admin_global_chat_pin_unset',
          targetId: 'globalChatMeta/pinned'
        });
        return json(res, 200, { ok: true, enabled: false });
      }

      const uid = String(req.body?.uid || '').trim();
      if (!uid) return json(res, 400, { error: '대상 사용자 UID가 없습니다.' });

      let targetUser;
      try { targetUser = await admin.auth(getAdminApp()).getUser(uid); }
      catch (_) { return json(res, 404, { error: '대상 사용자를 찾을 수 없습니다.' }); }

      if (targetUser.customClaims?.admin === true) {
        return json(res, 400, { error: '관리자 계정은 채팅 금지 대상이 될 수 없습니다.' });
      }

      if (action === 'ban' || action === 'unban') {
        const reason = String(req.body?.reason || '').replace(/[<>\n\r\t]/g, ' ').trim().slice(0, 200);
        let until = null;
        const durationMinutes = Number(req.body?.durationMinutes || 0);
        if (action === 'ban' && Number.isFinite(durationMinutes) && durationMinutes > 0) {
          until = admin.firestore.Timestamp.fromMillis(Date.now() + Math.min(durationMinutes, 60 * 24 * 365) * 60_000);
        }

        const ref = db.doc(`chatBans/${uid}`);
        if (action === 'ban') {
          await ref.set({
            uid,
            banned: true,
            reason,
            until,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            bannedByUid: decoded.uid,
            bannedByEmail: decoded.email || ''
          }, { merge: true });
        } else {
          await ref.set({
            uid,
            banned: false,
            reason: '',
            until: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            unbannedByUid: decoded.uid,
            unbannedByEmail: decoded.email || ''
          }, { merge: true });
        }

        await writeAuditLog({
          actorUid: decoded.uid,
          actorEmail: decoded.email || null,
          action: action === 'ban' ? 'admin_global_chat_ban' : 'admin_global_chat_unban',
          targetUid: uid,
          metadata: { targetEmail: targetUser.email || null, reason, durationMinutes: action === 'ban' ? durationMinutes : 0 }
        });
        return json(res, 200, { ok: true, banned: action === 'ban', until: until ? until.toDate().toISOString() : null });
      }

      if (action === 'deleteUserMessages') {
        const snap = await db.collection('globalChat').where('senderId', '==', uid).get();
        let deleted = 0;
        for (const group of chunk(snap.docs)) {
          const batch = db.batch();
          group.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          deleted += group.length;
        }
        await writeAuditLog({
          actorUid: decoded.uid,
          actorEmail: decoded.email || null,
          action: 'admin_global_chat_delete_user_messages',
          targetUid: uid,
          metadata: { targetEmail: targetUser.email || null, deletedCount: deleted }
        });
        return json(res, 200, { ok: true, deletedCount: deleted });
      }

      return json(res, 400, { error: '지원하지 않는 관리자 채팅 작업입니다.' });
    }

    return json(res, 405, { error: 'GET, POST, DELETE만 허용됩니다.' });
  } catch (error) {
    console.error('/api/admin-global-chat failed:', error);
    const message = error?.message || '채팅 관리 처리에 실패했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `채팅 관리 서버 오류: ${message}` });
  }
};
