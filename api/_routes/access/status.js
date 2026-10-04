const { admin, getAdminApp, verifyBearer, isAdmin, json } = require('../../_lib/firebaseAdmin');

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req, false);
    const auth = admin.auth(getAdminApp());
    const email = String(decoded.email || '').trim().toLowerCase();

    const bootstrapAdmin = Boolean(process.env.ADMIN_BOOTSTRAP_EMAIL && email && email === String(process.env.ADMIN_BOOTSTRAP_EMAIL).trim().toLowerCase());
    if (bootstrapAdmin && !isAdmin(decoded)) {
      const current = await auth.getUser(decoded.uid);
      const claims = { ...(current.customClaims || {}), admin: true };
      await auth.setCustomUserClaims(decoded.uid, claims);
      return json(res, 200, { admin: true, bootstrapAdmin: true, access: { active: true, validFrom: null, validUntil: null, keyId: null, label: '관리자', reason: '' } });
    }

    if (isAdmin(decoded)) {
      return json(res, 200, { admin: true, access: { active: true, validFrom: null, validUntil: null, keyId: null, label: '관리자', reason: '' } });
    }

    const db = admin.firestore(getAdminApp());
    const snap = await db.doc(`users/${decoded.uid}/access/meta`).get();
    if (!snap.exists) return json(res, 200, { admin: false, access: { active: false, validFrom: null, validUntil: null, keyId: null, label: '', reason: '이용 키가 없습니다.' } });
    const data = snap.data() || {};
    const now = Date.now();
    const from = data.validFrom?.toDate ? data.validFrom.toDate().getTime() : (data.validFrom ? new Date(data.validFrom).getTime() : null);
    const until = data.validUntil?.toDate ? data.validUntil.toDate().getTime() : (data.validUntil ? new Date(data.validUntil).getTime() : null);
    const active = data.active === true && (!from || now >= from) && (!until || now <= until);
    return json(res, 200, { admin: false, access: { active, validFrom: from ? new Date(from).toISOString() : null, validUntil: until ? new Date(until).toISOString() : null, keyId: data.keyId || null, label: data.label || '', reason: active ? '' : (data.active === false ? '이용 키가 비활성화되었습니다.' : '이용 키가 만료되었거나 아직 시작되지 않았습니다.') } });
  } catch (error) {
    return json(res, 401, { error: error.message || '인증에 실패했습니다.' });
  }
};
