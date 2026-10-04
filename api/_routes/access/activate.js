const { admin, getAdminApp, verifyBearer, json, accessHash, enforceRateLimit, writeAuditLog } = require('../../_lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST만 허용됩니다.' });
  try {
    const decoded = await verifyBearer(req);
    if (!enforceRateLimit(req, res, `access-activate:${decoded.uid}`, 8, 10 * 60_000)) return;
    const key = String(req.body?.key || '').trim().toUpperCase();
    if (!key) return json(res, 400, { error: '이용 키를 입력해주세요.' });
    const db = admin.firestore(getAdminApp());
    const hash = accessHash(key);
    const query = await db.collection('accessKeys').where('keyHash', '==', hash).limit(1).get();
    if (query.empty) return json(res, 400, { error: '유효하지 않은 이용 키입니다.' });
    const ref = query.docs[0].ref;
    let auditLabel = '';
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('유효하지 않은 이용 키입니다.');
      const data = snap.data() || {};
      auditLabel = String(data.label || '');
      const now = new Date();
      const from = data.validFrom?.toDate ? data.validFrom.toDate() : (data.validFrom ? new Date(data.validFrom) : null);
      const until = data.validUntil?.toDate ? data.validUntil.toDate() : (data.validUntil ? new Date(data.validUntil) : null);
      if ((from && Number.isNaN(from.getTime())) || (until && Number.isNaN(until.getTime()))) throw new Error('이용 키의 유효 기간 정보가 올바르지 않습니다.');
      if (from && until && from > until) throw new Error('이용 키의 유효 기간이 올바르지 않습니다.');
      const usedBy = Array.isArray(data.usedBy) ? data.usedBy : [];
      if (!data.active) throw new Error('비활성화된 이용 키입니다.');
      if (from && now < from) throw new Error('아직 사용할 수 없는 이용 키입니다.');
      if (until && now > until) throw new Error('만료된 이용 키입니다.');
      if (!usedBy.includes(decoded.uid) && usedBy.length >= Number(data.maxUsers || 1)) throw new Error('이용 가능한 계정 수를 초과했습니다.');
      if (!usedBy.includes(decoded.uid)) usedBy.push(decoded.uid);
      tx.update(ref, { usedBy });
      tx.set(db.doc(`users/${decoded.uid}/access/meta`), { active: true, keyId: ref.id, label: auditLabel, validFrom: from ? admin.firestore.Timestamp.fromDate(from) : null, validUntil: until ? admin.firestore.Timestamp.fromDate(until) : null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { validFrom: from ? from.toISOString() : null, validUntil: until ? until.toISOString() : null, label: auditLabel, keyId: ref.id };
    });
    await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'access_key_activate', targetId: ref.id, metadata: { label: auditLabel } });
    return json(res, 200, { admin: false, access: { active: true, ...result, reason: '' } });
  } catch (error) {
    return json(res, 400, { error: error.message || '이용 키 활성화에 실패했습니다.' });
  }
};
