const { admin, getAdminApp, verifyBearer, json, accessHash } = require('../_lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST만 허용됩니다.' });
  try {
    const decoded = await verifyBearer(req);
    const key = String(req.body?.key || '').trim().toUpperCase();
    if (!key) return json(res, 400, { error: '이용 키를 입력해주세요.' });
    const db = admin.firestore(getAdminApp());
    const hash = accessHash(key);
    const query = await db.collection('accessKeys').where('keyHash', '==', hash).limit(1).get();
    if (query.empty) return json(res, 400, { error: '유효하지 않은 이용 키입니다.' });
    const ref = query.docs[0].ref;
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data() || {};
      const now = new Date();
      const from = data.validFrom?.toDate ? data.validFrom.toDate() : new Date(data.validFrom);
      const until = data.validUntil?.toDate ? data.validUntil.toDate() : new Date(data.validUntil);
      const usedBy = Array.isArray(data.usedBy) ? data.usedBy : [];
      if (!data.active) throw new Error('비활성화된 이용 키입니다.');
      if (from && now < from) throw new Error('아직 사용할 수 없는 이용 키입니다.');
      if (until && now > until) throw new Error('만료된 이용 키입니다.');
      if (!usedBy.includes(decoded.uid) && usedBy.length >= Number(data.maxUsers || 1)) throw new Error('이용 가능한 계정 수를 초과했습니다.');
      if (!usedBy.includes(decoded.uid)) usedBy.push(decoded.uid);
      tx.update(ref, { usedBy });
      tx.set(db.doc(`users/${decoded.uid}/access/meta`), { active: true, keyId: ref.id, label: data.label || '', validFrom: admin.firestore.Timestamp.fromDate(from), validUntil: admin.firestore.Timestamp.fromDate(until), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { validFrom: from.toISOString(), validUntil: until.toISOString(), label: data.label || '', keyId: ref.id };
    });
    return json(res, 200, { admin: false, access: { active: true, ...result, reason: '' } });
  } catch (error) {
    return json(res, 400, { error: error.message || '이용 키 활성화에 실패했습니다.' });
  }
};
