const { admin, getAdminApp, requireAdmin, json, enforceRateLimit, writeAuditLog } = require('./_lib/firebaseAdmin');

function normalizeLink(value) {
  const label = String(value?.label || '이용 문의 · 키 받기').trim().slice(0, 40) || '이용 문의 · 키 받기';
  const url = String(value?.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error('링크는 http:// 또는 https://로 시작해야 합니다.');
  return { label, url };
}

module.exports = async (req, res) => {
  try {
    const decoded = await requireAdmin(req);
    if (req.method !== 'GET' && !enforceRateLimit(req, res, `admin-settings:${decoded.uid}`, 20, 60_000)) return;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const db = admin.firestore(getAdminApp());
    const ref = db.doc('settings/public');

    if (req.method === 'GET') {
      const snap = await ref.get();
      const data = snap.exists ? (snap.data() || {}) : {};
      return json(res, 200, { contactLink: normalizeLink(data.contactLink), webIcon: String(data.webIcon || '').trim() });
    }

    if (req.method === 'PATCH') {
      const action = String(req.body?.action || '').trim();

      // 아이콘은 문의 링크와 완전히 분리해 저장합니다. 이제 '삭제' 상태와
      // '새 아이콘 저장' 상태가 서로 섞일 수 없습니다.
      if (action === 'setWebIcon') {
        const webIcon = String(req.body?.webIcon || '').trim();
        if (!/^data:image\/(webp|png|jpeg|jpg);base64,/i.test(webIcon)) {
          throw new Error('웹 아이콘 이미지 데이터가 올바르지 않습니다.');
        }
        if (webIcon.length > 700000) throw new Error('웹 아이콘 파일이 너무 큽니다.');
        await ref.set({ webIcon, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const verify = await ref.get();
        const saved = String((verify.data() || {}).webIcon || '').trim();
        if (!saved) throw new Error('웹 아이콘 저장 후 데이터를 확인하지 못했습니다.');
        await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'admin_web_icon_set' });
        return json(res, 200, { ok: true, webIcon: saved });
      }

      if (action === 'deleteWebIcon') {
        await ref.set({ webIcon: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const verify = await ref.get();
        const saved = String((verify.data() || {}).webIcon || '').trim();
        if (saved) throw new Error('웹 아이콘 삭제 후에도 기존 아이콘이 남아 있습니다.');
        await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'admin_web_icon_delete' });
        return json(res, 200, { ok: true, webIcon: '' });
      }

      // 기존 문의 링크 저장 API와의 호환성 유지
      const contactLink = normalizeLink(req.body?.contactLink);
      await ref.set({ contactLink, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      const verify = await ref.get();
      const data = verify.exists ? (verify.data() || {}) : {};
      await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'admin_contact_link_update', metadata: { label: contactLink.label, url: contactLink.url ? '[configured]' : '' } });
      return json(res, 200, { ok: true, contactLink: normalizeLink(data.contactLink), webIcon: String(data.webIcon || '').trim() });
    }

    return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    console.error(`${req.method} /api/admin-settings failed:`, error);
    const message = error?.message || '설정 처리에 실패했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: message });
  }
};
