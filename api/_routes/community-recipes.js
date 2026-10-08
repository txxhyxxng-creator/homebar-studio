const { admin, getAdminApp, verifyBearer, isAdmin, json, enforceRateLimit } = require('../_lib/firebaseAdmin');

function accessIsActive(data) {
  if (!data || data.active !== true) return false;
  const ms = value => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  };
  const now = Date.now();
  return (!ms(data.validFrom) || ms(data.validFrom) <= now) && (!ms(data.validUntil) || ms(data.validUntil) >= now);
}

async function requireAccess(decoded, db) {
  if (isAdmin(decoded)) return true;
  const snap = await db.doc(`users/${decoded.uid}/access/meta`).get();
  if (!snap.exists || !accessIsActive(snap.data())) throw new Error('활성 이용권이 필요합니다.');
  return true;
}

function cleanText(value, max = 2000) {
  return String(value || '').replace(/\u0000/g, '').replace(/[<>]/g, '').trim().slice(0, max);
}

function cleanRecipe(recipe) {
  const src = recipe && typeof recipe === 'object' ? recipe : {};
  return {
    name: cleanText(src.name, 100),
    category: cleanText(src.category, 60),
    description: cleanText(src.description, 2000),
    ingredients: Array.isArray(src.ingredients) ? src.ingredients.slice(0, 40).map(i => ({
      name: cleanText(i?.name, 100), brand: cleanText(i?.brand, 100), amount: cleanText(i?.amount, 40), abv: Number(i?.abv || 0) || 0
    })).filter(i => i.name) : []
  };
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

function serializeRecipe(doc) {
  const d = doc.data() || {};
  return { id: doc.id, ...d, createdAt: toMillis(d.createdAt), updatedAt: toMillis(d.updatedAt), sharedAt: toMillis(d.sharedAt) };
}

async function profileFor(db, uid, decoded) {
  const snap = await db.doc(`profiles/${uid}`).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    nickname: cleanText(data.nickname || String(decoded.email || '').split('@')[0] || 'BarTail User', 20) || 'BarTail User',
    avatar: typeof data.avatar === 'string' ? data.avatar.slice(0, 600000) : ''
  };
}

module.exports = async (req, res) => {
  try {
    const decoded = await verifyBearer(req);
    if (!enforceRateLimit(req, res, `community-recipes:${decoded.uid}`, 60, 60_000)) return;
    const db = admin.firestore(getAdminApp());
    await requireAccess(decoded, db);

    if (req.method === 'GET') {
      if (String(req.query?.admin || '') === 'reports') {
        if (!isAdmin(decoded)) return json(res, 403, { error: '관리자 권한이 필요합니다.' });
        const reportSnap = await db.collection('recipeReports').limit(100).get();
        const reports = [];
        for (const doc of reportSnap.docs) {
          const d = doc.data() || {};
          const recipeSnap = d.recipeId ? await db.collection('publicRecipes').doc(d.recipeId).get() : null;
          reports.push({ id: doc.id, ...d, createdAt: toMillis(d.createdAt), recipe: recipeSnap?.exists ? serializeRecipe(recipeSnap) : null });
        }
        reports.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
        return json(res, 200, { reports });
      }
      const recipeId = cleanText(req.query?.recipeId, 100);
      if (recipeId) {
        const ref = db.collection('publicRecipes').doc(recipeId);
        const snap = await ref.get();
        if (!snap.exists) return json(res, 404, { error: '공유 레시피를 찾을 수 없습니다.' });
        const recipe = serializeRecipe(snap);
        const commentsSnap = await ref.collection('comments').limit(50).get();
        const comments = commentsSnap.docs.map(doc => {
          const d = doc.data() || {};
          return { id: doc.id, ...d, createdAt: toMillis(d.createdAt) };
        }).sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));
        const liked = (await ref.collection('likes').doc(decoded.uid).get()).exists;
        return json(res, 200, { recipe, comments, liked });
      }

      const snap = await db.collection('publicRecipes').limit(100).get();
      const recipes = snap.docs.map(serializeRecipe).sort((a,b) => {
        const scoreA = Number(a.likeCount || 0) * 1000000000 + (a.sharedAt || a.createdAt || 0);
        const scoreB = Number(b.likeCount || 0) * 1000000000 + (b.sharedAt || b.createdAt || 0);
        return scoreB - scoreA;
      }).slice(0, 60);
      return json(res, 200, { recipes });
    }

    if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
      return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
    }

    if (req.method === 'DELETE') {
      const recipeId = cleanText(req.query?.recipeId, 100);
      if (!recipeId) return json(res, 400, { error: '레시피 ID가 필요합니다.' });
      const ref = db.collection('publicRecipes').doc(recipeId);
      const snap = await ref.get();
      if (!snap.exists) return json(res, 404, { error: '공유 레시피를 찾을 수 없습니다.' });
      if (snap.data()?.ownerId !== decoded.uid && !isAdmin(decoded)) return json(res, 403, { error: '본인이 공유한 레시피만 삭제할 수 있습니다.' });
      await ref.delete();
      return json(res, 200, { ok: true });
    }

    const action = cleanText(req.body?.action, 40);

    if (action === 'share' || action === 'update') {
      const recipeId = cleanText(req.body?.recipeId, 100);
      const recipe = cleanRecipe(req.body?.recipe);
      if (!recipe.name) return json(res, 400, { error: '레시피 이름을 입력해주세요.' });
      const profile = await profileFor(db, decoded.uid, decoded);
      const ref = recipeId ? db.collection('publicRecipes').doc(recipeId) : db.collection('publicRecipes').doc();
      const existing = await ref.get();
      if (action === 'update' && existing.exists && existing.data()?.ownerId !== decoded.uid && !isAdmin(decoded)) return json(res, 403, { error: '본인이 공유한 레시피만 수정할 수 있습니다.' });
      const now = admin.firestore.FieldValue.serverTimestamp();
      const payload = {
        ownerId: existing.exists ? existing.data()?.ownerId : decoded.uid,
        authorNickname: profile.nickname,
        authorAvatar: profile.avatar,
        recipe,
        likeCount: existing.exists ? Number(existing.data()?.likeCount || 0) : 0,
        createdAt: existing.exists ? (existing.data()?.createdAt || now) : now,
        sharedAt: existing.exists ? (existing.data()?.sharedAt || now) : now,
        updatedAt: now
      };
      await ref.set(payload, { merge: true });
      return json(res, 200, { ok: true, id: ref.id, recipe: { id: ref.id, ...payload, createdAt: toMillis(payload.createdAt), sharedAt: toMillis(payload.sharedAt), updatedAt: Date.now() } });
    }

    if (action === 'unshare') {
      const recipeId = cleanText(req.body?.recipeId, 100);
      const ref = db.collection('publicRecipes').doc(recipeId);
      const snap = await ref.get();
      if (!snap.exists) return json(res, 404, { error: '공유 레시피를 찾을 수 없습니다.' });
      if (snap.data()?.ownerId !== decoded.uid && !isAdmin(decoded)) return json(res, 403, { error: '본인이 공유한 레시피만 공유 해제할 수 있습니다.' });
      await ref.delete();
      return json(res, 200, { ok: true });
    }

    if (action === 'like') {
      const recipeId = cleanText(req.body?.recipeId, 100);
      const ref = db.collection('publicRecipes').doc(recipeId);
      const likeRef = ref.collection('likes').doc(decoded.uid);
      const result = await db.runTransaction(async tx => {
        const recipeSnap = await tx.get(ref);
        if (!recipeSnap.exists) throw new Error('공유 레시피를 찾을 수 없습니다.');
        const likeSnap = await tx.get(likeRef);
        const current = Number(recipeSnap.data()?.likeCount || 0);
        if (likeSnap.exists) {
          tx.delete(likeRef);
          tx.update(ref, { likeCount: Math.max(0, current - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          return { liked: false, likeCount: Math.max(0, current - 1) };
        }
        tx.set(likeRef, { uid: decoded.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(ref, { likeCount: current + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return { liked: true, likeCount: current + 1 };
      });
      return json(res, 200, { ok: true, ...result });
    }

    if (action === 'comment') {
      const recipeId = cleanText(req.body?.recipeId, 100);
      const text = cleanText(req.body?.text, 500);
      if (!text) return json(res, 400, { error: '댓글 내용을 입력해주세요.' });
      const ref = db.collection('publicRecipes').doc(recipeId);
      if (!(await ref.get()).exists) return json(res, 404, { error: '공유 레시피를 찾을 수 없습니다.' });
      const profile = await profileFor(db, decoded.uid, decoded);
      const commentRef = await ref.collection('comments').add({ uid: decoded.uid, nickname: profile.nickname, avatar: profile.avatar, text, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return json(res, 200, { ok: true, id: commentRef.id });
    }

    if (action === 'report') {
      const recipeId = cleanText(req.body?.recipeId, 100);
      const reason = cleanText(req.body?.reason || '부적절한 콘텐츠', 300);
      await db.collection('recipeReports').add({ recipeId, reporterId: decoded.uid, reason, createdAt: admin.firestore.FieldValue.serverTimestamp(), status: 'open' });
      return json(res, 200, { ok: true });
    }

    if (action === 'adminResolveReport') {
      if (!isAdmin(decoded)) return json(res, 403, { error: '관리자 권한이 필요합니다.' });
      const reportId = cleanText(req.body?.reportId, 100);
      const mode = cleanText(req.body?.mode, 30);
      const reportRef = db.collection('recipeReports').doc(reportId);
      const reportSnap = await reportRef.get();
      if (!reportSnap.exists) return json(res, 404, { error: '신고 내역을 찾을 수 없습니다.' });
      const data = reportSnap.data() || {};
      if (mode === 'deleteRecipe' && data.recipeId) {
        await db.collection('publicRecipes').doc(data.recipeId).delete();
      }
      await reportRef.set({ status: mode === 'deleteRecipe' ? 'removed' : 'resolved', resolvedAt: admin.firestore.FieldValue.serverTimestamp(), resolvedBy: decoded.uid }, { merge: true });
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: '알 수 없는 작업입니다.' });
  } catch (error) {
    console.error('community-recipes failed:', error);
    const message = error?.message || '공유 레시피 처리에 실패했습니다.';
    const status = ['인증 토큰이 없습니다.', '활성 이용권이 필요합니다.'].includes(message) ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `공유 레시피 서버 오류: ${message}` });
  }
};
