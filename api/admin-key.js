const { admin, getAdminApp, requireAdmin, json } = require('./_lib/firebaseAdmin');

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const str = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : str);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function deactivateKeyUsers(db, keyId, userUids) {
  await Promise.all((Array.isArray(userUids) ? userUids : []).map(async uid => {
    const ref = db.doc(`users/${uid}/access/meta`);
    const snap = await ref.get();
    if (!snap.exists) return;
    const current = snap.data() || {};
    if (current.keyId === keyId) {
      await ref.set({ active: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(), revokedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  }));
}

async function syncKeyUsers(db, keyId, userUids, validFrom, validUntil) {
  await Promise.all((Array.isArray(userUids) ? userUids : []).map(async uid => {
    const ref = db.doc(`users/${uid}/access/meta`);
    const snap = await ref.get();
    if (!snap.exists) return;
    const current = snap.data() || {};
    if (current.keyId === keyId) {
      await ref.set({
        active: true,
        keyId,
        validFrom: admin.firestore.Timestamp.fromDate(validFrom),
        validUntil: admin.firestore.Timestamp.fromDate(validUntil),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedAt: admin.firestore.FieldValue.delete()
      }, { merge: true });
    }
  }));
}

module.exports = async (req, res) => {
  try {
    await requireAdmin(req);
    const db = admin.firestore(getAdminApp());
    const keyId = String(req.query?.keyId || '').trim();
    if (!keyId) return json(res, 400, { error: 'keyId가 필요합니다.' });

    const keyRef = db.doc(`accessKeys/${keyId}`);
    const snap = await keyRef.get();
    if (!snap.exists) return json(res, 404, { error: '이용 키를 찾을 수 없습니다.' });
    const data = snap.data() || {};
    const usedBy = Array.isArray(data.usedBy) ? data.usedBy : [];

    if (req.method === 'DELETE') {
      const expiresAt = data.validUntil?.toDate ? data.validUntil.toDate() : parseDate(data.validUntil, true);
      const isExpired = Boolean(expiresAt && expiresAt.getTime() < Date.now());
      if (data.active !== false && !isExpired) return json(res, 400, { error: '활성 이용 키는 삭제할 수 없습니다. 먼저 비활성화해주세요.' });
      await deactivateKeyUsers(db, keyRef.id, usedBy);
      await keyRef.delete();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PATCH') {
      const currentFrom = data.validFrom?.toDate ? data.validFrom.toDate() : parseDate(data.validFrom);
      const currentUntil = data.validUntil?.toDate ? data.validUntil.toDate() : parseDate(data.validUntil, true);
      const validFrom = parseDate(req.body?.validFrom) || currentFrom || new Date();
      const validUntil = parseDate(req.body?.validUntil, true) || currentUntil;
      if (!validUntil || validUntil < validFrom) return json(res, 400, { error: '유효 기간을 확인해주세요.' });
      const maxUsers = Math.max(1, Number(req.body?.maxUsers ?? data.maxUsers ?? 1));
      const label = req.body?.label !== undefined ? String(req.body.label || '').trim() : (data.label || '');
      const active = req.body?.active !== undefined ? Boolean(req.body.active) : true;
      await keyRef.update({
        label,
        active,
        validFrom: admin.firestore.Timestamp.fromDate(validFrom),
        validUntil: admin.firestore.Timestamp.fromDate(validUntil),
        maxUsers,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedAt: active ? admin.firestore.FieldValue.delete() : admin.firestore.FieldValue.serverTimestamp()
      });
      if (active) await syncKeyUsers(db, keyRef.id, usedBy, validFrom, validUntil);
      else await deactivateKeyUsers(db, keyRef.id, usedBy);
      return json(res, 200, { ok: true, active, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString() });
    }

    return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    console.error(`admin-key ${req.method} failed:`, error);
    const message = error?.message || '키 처리에 실패했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `키 처리 서버 오류: ${message}` });
  }
};
