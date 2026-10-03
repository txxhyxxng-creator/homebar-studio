const { getDb, requireUser, hashAccessKey, json } = require('../_lib/firebaseAdmin');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });
    const claims = await requireUser(req);
    const key = String(req.body?.key || '').trim().toUpperCase();
    if (!key) return json(res, 400, { error: '이용 키를 입력해주세요.' });

    const db = getDb();
    const keyHash = hashAccessKey(key);
    const query = await db.collection('accessKeys').where('keyHash', '==', keyHash).limit(1).get();
    if (query.empty) return json(res, 400, { error: '존재하지 않는 이용 키입니다.' });

    const keyRef = query.docs[0].ref;
    const userAccessRef = db.collection('users').doc(claims.uid).collection('access').doc('meta');
    let result;

    await db.runTransaction(async tx => {
      const keySnap = await tx.get(keyRef);
      if (!keySnap.exists) throw Object.assign(new Error('이용 키를 찾을 수 없습니다.'), { status: 400 });
      const data = keySnap.data() || {};
      const now = new Date();
      const from = data.validFrom?.toDate ? data.validFrom.toDate() : new Date(data.validFrom);
      const until = data.validUntil?.toDate ? data.validUntil.toDate() : new Date(data.validUntil);
      const usedBy = Array.isArray(data.usedBy) ? data.usedBy : [];

      if (data.active !== true) throw Object.assign(new Error('비활성화된 이용 키입니다.'), { status: 400 });
      if (from.getTime() > now.getTime()) throw Object.assign(new Error('아직 사용 기간이 시작되지 않은 이용 키입니다.'), { status: 400 });
      if (until.getTime() < now.getTime()) throw Object.assign(new Error('만료된 이용 키입니다.'), { status: 400 });
      if (!usedBy.includes(claims.uid) && usedBy.length >= Number(data.maxUsers || 1)) throw Object.assign(new Error('이 이용 키의 사용 가능 계정 수가 모두 소진되었습니다.'), { status: 400 });

      const nextUsedBy = usedBy.includes(claims.uid) ? usedBy : [...usedBy, claims.uid];
      tx.set(keyRef, { usedBy: nextUsedBy, updatedAt: require('../_lib/firebaseAdmin').getAdmin().firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(userAccessRef, {
        active: true,
        keyId: keyRef.id,
        label: data.label || '',
        validFrom: require('../_lib/firebaseAdmin').getAdmin().firestore.Timestamp.fromDate(from),
        validUntil: require('../_lib/firebaseAdmin').getAdmin().firestore.Timestamp.fromDate(until),
        updatedAt: require('../_lib/firebaseAdmin').getAdmin().firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      result = { from, until, keyId: keyRef.id, label: data.label || '' };
    });

    return json(res, 200, { access: { active: true, keyId: result.keyId, label: result.label, validFrom: result.from.toISOString(), validUntil: result.until.toISOString(), reason: '' } });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || '이용 키 활성화에 실패했습니다.' });
  }
};
