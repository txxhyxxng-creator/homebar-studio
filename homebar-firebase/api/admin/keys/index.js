const { getDb, getAdmin, requireAdmin, generateAccessKey, hashAccessKey, json } = require('../../_lib/firebaseAdmin');

function statusFor(data) {
  const now = Date.now();
  const from = data.validFrom?.toDate ? data.validFrom.toDate().getTime() : new Date(data.validFrom).getTime();
  const until = data.validUntil?.toDate ? data.validUntil.toDate().getTime() : new Date(data.validUntil).getTime();
  if (data.active !== true) return ['inactive', '비활성'];
  if (from > now) return ['scheduled', '사용 예정'];
  if (until < now) return ['expired', '만료'];
  return ['active', '활성'];
}

module.exports = async function handler(req, res) {
  try {
    const claims = await requireAdmin(req);
    const db = getDb();
    if (req.method === 'GET') {
      const snap = await db.collection('accessKeys').orderBy('createdAt', 'desc').limit(200).get();
      const keys = snap.docs.map(doc => {
        const data = doc.data() || {};
        const usedBy = Array.isArray(data.usedBy) ? data.usedBy : [];
        const [status, statusLabel] = statusFor(data);
        return {
          id: doc.id,
          label: data.label || '',
          maskedKey: data.maskedKey || 'HBS-****-****-****',
          active: data.active === true,
          status,
          statusLabel,
          validFrom: data.validFrom?.toDate ? data.validFrom.toDate().toISOString().slice(0,10) : String(data.validFrom || ''),
          validUntil: data.validUntil?.toDate ? data.validUntil.toDate().toISOString().slice(0,10) : String(data.validUntil || ''),
          maxUsers: Number(data.maxUsers || 1),
          usedCount: usedBy.length
        };
      });
      return json(res, 200, { keys });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const validFrom = new Date(`${String(body.validFrom || '').slice(0,10)}T00:00:00+09:00`);
      const validUntil = new Date(`${String(body.validUntil || '').slice(0,10)}T23:59:59+09:00`);
      const maxUsers = Math.max(1, Math.min(10000, Number(body.maxUsers) || 1));
      if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validUntil < validFrom) return json(res, 400, { error: '유효 기간을 확인해주세요.' });

      let key = generateAccessKey();
      let keyHash = hashAccessKey(key);
      for (let i = 0; i < 3; i += 1) {
        const existing = await db.collection('accessKeys').where('keyHash', '==', keyHash).limit(1).get();
        if (existing.empty) break;
        key = generateAccessKey();
        keyHash = hashAccessKey(key);
      }
      const ref = db.collection('accessKeys').doc();
      await ref.set({
        keyHash,
        maskedKey: `${key.slice(0,7)}-****-****`,
        label: String(body.label || '').trim().slice(0,100),
        active: true,
        validFrom: getAdmin().firestore.Timestamp.fromDate(validFrom),
        validUntil: getAdmin().firestore.Timestamp.fromDate(validUntil),
        maxUsers,
        usedBy: [],
        createdBy: claims.uid,
        createdAt: getAdmin().firestore.FieldValue.serverTimestamp()
      });
      return json(res, 200, { id: ref.id, key });
    }

    return json(res, 405, { error: 'Method Not Allowed' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || '관리자 키 처리에 실패했습니다.' });
  }
};
