const { admin, getAdminApp, requireAdmin, json } = require('./_lib/firebaseAdmin');

function normalizeLink(value) {
  const label = String(value?.label || '이용 문의 · 키 받기').trim().slice(0, 40) || '이용 문의 · 키 받기';
  const url = String(value?.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error('링크는 http:// 또는 https://로 시작해야 합니다.');
  return { label, url };
}

module.exports = async (req, res) => {
  try {
    await requireAdmin(req);
    const db = admin.firestore(getAdminApp());
    const ref = db.doc('settings/public');

    if (req.method === 'GET') {
      const snap = await ref.get();
      const data = snap.exists ? (snap.data() || {}) : {};
      return json(res, 200, { contactLink: normalizeLink(data.contactLink) });
    }

    if (req.method === 'PATCH') {
      const contactLink = normalizeLink(req.body?.contactLink);
      await ref.set({ contactLink, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return json(res, 200, { ok: true, contactLink });
    }

    return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    console.error(`${req.method} /api/admin-settings failed:`, error);
    const message = error?.message || '설정 처리에 실패했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: message });
  }
};
