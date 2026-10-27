const { admin, getAdminApp, requireAdmin, verifyBearer, json, enforceRateLimit, writeAuditLog } = require('../_lib/firebaseAdmin');

function formatDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeSuggestion(body = {}) {
  const name = String(body.name || '').trim().slice(0, 120);
  const brand = String(body.brand || '').trim().slice(0, 120);
  const category = String(body.category || '기타').trim().slice(0, 40);
  const abv = Math.min(100, Math.max(0, Number(body.abv) || 0));
  const image = String(body.image || '').trim().slice(0, 1000);
  const note = String(body.note || '').trim().slice(0, 500);
  if (!name) throw new Error('제품명을 입력해주세요.');
  if (image && !/^https?:\/\//i.test(image)) throw new Error('이미지 주소는 http:// 또는 https://로 시작해야 합니다.');
  return { name, brand, category, abv, image, note };
}

async function requireActiveUser(req) {
  const decoded = await verifyBearer(req);
  const db = admin.firestore(getAdminApp());
  const snap = await db.doc(`users/${decoded.uid}/access/meta`).get();
  const access = snap.exists ? (snap.data() || {}) : {};
  const until = access.validUntil?.toDate ? access.validUntil.toDate() : (access.validUntil ? new Date(access.validUntil) : null);
  const active = decoded.admin === true || (access.active === true && (!until || until.getTime() >= Date.now()));
  if (!active) throw new Error('유효한 이용 키가 필요합니다.');
  return decoded;
}

module.exports = async (req, res) => {
  try {
    const db = admin.firestore(getAdminApp());

    if (req.method === 'POST') {
      const decoded = await requireActiveUser(req);
      if (!enforceRateLimit(req, res, `catalog-suggestion:${decoded.uid}`, 10, 10 * 60_000)) return;
      const item = normalizeSuggestion(req.body);

      const catalogSnap = await db.collection('catalog').get();
      const duplicate = catalogSnap.docs.some(doc => {
        const d = doc.data() || {};
        return String(d.name || '').trim().toLowerCase() === item.name.toLowerCase()
          && String(d.brand || '').trim().toLowerCase() === item.brand.toLowerCase();
      });
      if (duplicate) return json(res, 409, { error: '이미 전체 술 도감에 등록된 주류입니다.' });

      const pendingSnap = await db.collection('catalogSuggestions').where('status', '==', 'pending').get();
      const duplicatePending = pendingSnap.docs.some(doc => {
        const d = doc.data() || {};
        return String(d.name || '').trim().toLowerCase() === item.name.toLowerCase()
          && String(d.brand || '').trim().toLowerCase() === item.brand.toLowerCase();
      });
      if (duplicatePending) return json(res, 409, { error: '이미 같은 주류에 대한 건의가 검토 대기 중입니다.' });

      const ref = db.collection('catalogSuggestions').doc();
      await ref.set({
        ...item,
        status: 'pending',
        suggestedBy: decoded.uid,
        suggestedEmail: decoded.email || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'catalog_suggestion_create', targetId: ref.id, metadata: { name: item.name, brand: item.brand } });
      return json(res, 201, { ok: true, id: ref.id });
    }

    const decoded = await requireAdmin(req);
    if (req.method !== 'GET' && !enforceRateLimit(req, res, `catalog-suggestion-admin:${decoded.uid}`, 30, 60_000)) return;

    if (req.method === 'GET') {
      const snap = await db.collection('catalogSuggestions').where('status', '==', 'pending').get();
      const suggestions = snap.docs.map(doc => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          name: d.name || '',
          brand: d.brand || '',
          category: d.category || '기타',
          abv: Number(d.abv || 0),
          image: d.image || '',
          note: d.note || '',
          uid: d.suggestedBy || '',
          email: d.suggestedEmail || '',
          createdAt: formatDate(d.createdAt)
        };
      }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return json(res, 200, { suggestions });
    }

    if (req.method === 'PATCH') {
      const suggestionId = String(req.body?.suggestionId || '').trim();
      const action = String(req.body?.action || '').trim();
      if (!suggestionId || !['approve', 'reject'].includes(action)) return json(res, 400, { error: '처리할 건의와 작업을 확인해주세요.' });
      const ref = db.doc(`catalogSuggestions/${suggestionId}`);
      const snap = await ref.get();
      if (!snap.exists) return json(res, 404, { error: '건의를 찾을 수 없습니다.' });
      const d = snap.data() || {};
      if (d.status !== 'pending') return json(res, 409, { error: '이미 처리된 건의입니다.' });

      if (action === 'reject') {
        await ref.update({ status: 'rejected', reviewedBy: decoded.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp() });
        await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'catalog_suggestion_reject', targetId: suggestionId, metadata: { name: d.name || '', brand: d.brand || '' } });
        return json(res, 200, { ok: true, action });
      }

      const item = normalizeSuggestion(d);
      const catalogSnap = await db.collection('catalog').get();
      const duplicate = catalogSnap.docs.some(doc => {
        const c = doc.data() || {};
        return String(c.name || '').trim().toLowerCase() === item.name.toLowerCase()
          && String(c.brand || '').trim().toLowerCase() === item.brand.toLowerCase();
      });
      if (duplicate) {
        await ref.update({ status: 'rejected', reviewReason: '이미 도감에 존재함', reviewedAt: admin.firestore.FieldValue.serverTimestamp() });
        return json(res, 409, { error: '이미 전체 술 도감에 등록된 주류입니다.' });
      }

      const catalogRef = db.collection('catalog').doc(`suggested_${Date.now()}_${suggestionId.slice(0, 8)}`);
      await catalogRef.set({
        name: item.name,
        brand: item.brand,
        category: item.category,
        abv: item.abv,
        status: 'none',
        image: item.image || '',
        imageSource: '',
        imageSourcePage: '',
        suggestionId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await ref.update({ status: 'approved', catalogId: catalogRef.id, reviewedBy: decoded.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp() });
      await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'catalog_suggestion_approve', targetId: suggestionId, metadata: { catalogId: catalogRef.id, name: item.name, brand: item.brand } });
      return json(res, 200, { ok: true, action, catalogId: catalogRef.id });
    }

    return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    console.error(`${req.method} /api/catalog-suggestions failed:`, error);
    const message = error?.message || '술 추가 건의 처리에 실패했습니다.';
    const status = ['관리자 권한이 필요합니다.', '인증 토큰이 없습니다.', '유효한 이용 키가 필요합니다.'].includes(message) ? 403 : 500;
    return json(res, status, { error: message });
  }
};
