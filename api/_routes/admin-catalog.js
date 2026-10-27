const { admin, getAdminApp, requireAdmin, json, enforceRateLimit, writeAuditLog } = require('../_lib/firebaseAdmin');

function normalizeCatalogItem(body = {}) {
  const id = String(body.id || '').trim().slice(0, 180);
  const name = String(body.name || '').trim().slice(0, 160);
  const brand = String(body.brand || '').trim().slice(0, 160);
  const category = String(body.category || '기타').trim().slice(0, 60);
  const abv = Math.min(100, Math.max(0, Number(body.abv) || 0));
  const image = String(body.image || '').trim();
  const imageSource = String(body.imageSource || '').trim().slice(0, 500);
  const imageSourcePage = String(body.imageSourcePage || '').trim().slice(0, 2000);
  if (!id || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) throw new Error('주류 ID가 올바르지 않습니다.');
  if (!name) throw new Error('제품명을 입력하세요.');
  if (image && !/^https?:\/\//i.test(image) && !/^data:image\/(jpeg|png|webp);base64,/i.test(image)) {
    throw new Error('이미지는 http(s) 주소 또는 JPEG/PNG/WebP 이미지여야 합니다.');
  }
  const item = { name, brand, category, abv, image, imageSource, imageSourcePage };
  // Firestore 문서 최대 크기(1 MiB)에 여유를 두고 거부하여 조용한 저장 실패를 방지합니다.
  if (Buffer.byteLength(JSON.stringify(item), 'utf8') > 850000) {
    throw new Error('이미지 용량이 너무 큽니다. 더 작은 이미지로 다시 업로드해주세요.');
  }
  return { id, item };
}

module.exports = async (req, res) => {
  try {
    const decoded = await requireAdmin(req);
    if (!enforceRateLimit(req, res, `admin-catalog:${decoded.uid}`, 60, 60_000)) return;
    const db = admin.firestore(getAdminApp());

    if (req.method === 'POST') {
      const action = String(req.body?.action || 'save');
      if (action === 'sync') {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        if (items.length > 250) return json(res, 413, { error: '한 번에 동기화할 수 있는 주류는 최대 250개입니다.' });
        const normalized = items.map(normalizeCatalogItem);
        // 동기화는 upsert만 수행합니다. 누락된 항목을 일괄 삭제하지 않아 데이터 유실을 방지합니다.
        for (let i = 0; i < normalized.length; i += 400) {
          const batch = db.batch();
          normalized.slice(i, i + 400).forEach(({ id, item }) => {
            batch.set(db.collection('catalog').doc(id), { ...item, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          });
          await batch.commit();
        }
        return json(res, 200, { ok: true, count: normalized.length });
      }
      const { id, item } = normalizeCatalogItem(req.body);
      const ref = db.collection('catalog').doc(id);
      const existing = await ref.get();
      await ref.set({ ...item, ...(existing.exists ? {} : { status: 'none', createdAt: admin.firestore.FieldValue.serverTimestamp() }), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: existing.exists ? 'catalog_update' : 'catalog_create', targetId: id, metadata: { name: item.name, brand: item.brand } });
      return json(res, 200, { ok: true, id, action: existing.exists ? 'updated' : 'created' });
    }

    if (req.method === 'DELETE') {
      const id = String(req.body?.id || '').trim();
      if (!id || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) return json(res, 400, { error: '삭제할 주류 ID가 올바르지 않습니다.' });
      const ref = db.collection('catalog').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return json(res, 404, { error: '삭제할 주류를 찾을 수 없습니다.' });
      const d = snap.data() || {};
      await ref.delete();
      await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'catalog_delete', targetId: id, metadata: { name: d.name || '', brand: d.brand || '' } });
      return json(res, 200, { ok: true, id });
    }

    return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    console.error(`${req.method} /api/catalog-admin failed:`, error);
    const message = error?.message || '주류 저장에 실패했습니다.';
    const status = ['관리자 권한이 필요합니다.', '인증 토큰이 없습니다.'].includes(message) ? 403 : 500;
    return json(res, status, { error: message });
  }
};
