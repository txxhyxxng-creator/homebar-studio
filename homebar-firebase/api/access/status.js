const { getDb, getAuth, requireUser, json } = require('../_lib/firebaseAdmin');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });
    const claims = await requireUser(req);
    const bootstrapEmail = String(process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
    const isBootstrapAdmin = bootstrapEmail && String(claims.email || '').toLowerCase() === bootstrapEmail;
    let adminClaim = claims.admin === true;
    if (isBootstrapAdmin && !adminClaim) {
      await getAuth().setCustomUserClaims(claims.uid, { admin: true });
      adminClaim = true;
    }

    if (adminClaim) {
      return json(res, 200, { admin: true, access: { active: true, reason: '관리자 계정' } });
    }

    const db = getDb();
    const snap = await db.collection('users').doc(claims.uid).collection('access').doc('meta').get();
    if (!snap.exists) return json(res, 200, { admin: false, access: { active: false, reason: '유효한 이용 키가 없습니다.' } });

    const data = snap.data() || {};
    const now = Date.now();
    const from = data.validFrom?.toDate ? data.validFrom.toDate().getTime() : 0;
    const until = data.validUntil?.toDate ? data.validUntil.toDate().getTime() : 0;
    const active = data.active === true && from <= now && until >= now;
    return json(res, 200, {
      admin: false,
      access: {
        active,
        keyId: data.keyId || null,
        label: data.label || '',
        validFrom: from ? new Date(from).toISOString() : null,
        validUntil: until ? new Date(until).toISOString() : null,
        reason: active ? '' : (data.active === false ? '이용 키가 비활성화되었습니다.' : '이용 키가 만료되었거나 아직 유효하지 않습니다.')
      }
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || '상태 확인에 실패했습니다.' });
  }
};
