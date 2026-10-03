const { getDb, getAdmin, requireAdmin, json } = require('../../_lib/firebaseAdmin');

module.exports = async function handler(req, res) {
  try {
    const claims = await requireAdmin(req);
    if (req.method !== 'DELETE') return json(res, 405, { error: 'Method Not Allowed' });
    const keyId = String(req.query.keyId || '').trim();
    if (!keyId) return json(res, 400, { error: '키 ID가 필요합니다.' });
    const db = getDb();
    const ref = db.collection('accessKeys').doc(keyId);
    const snap = await ref.get();
    if (!snap.exists) return json(res, 404, { error: '이용 키를 찾을 수 없습니다.' });
    const data = snap.data() || {};
    const usedBy = Array.isArray(data.usedBy) ? data.usedBy : [];
    const batch = db.batch();
    batch.set(ref, { active: false, revokedAt: getAdmin().firestore.FieldValue.serverTimestamp(), revokedBy: claims.uid }, { merge: true });
    for (const uid of usedBy) {
      const accessRef = db.collection('users').doc(uid).collection('access').doc('meta');
      const accessSnap = await accessRef.get();
      if (accessSnap.exists && accessSnap.data()?.keyId === keyId) {
        batch.set(accessRef, { active: false, revokedAt: getAdmin().firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }
    await batch.commit();
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || '이용 키 비활성화에 실패했습니다.' });
  }
};
