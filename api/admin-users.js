const { admin, getAdminApp, requireAdmin, json } = require('./_lib/firebaseAdmin');

function formatDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function listAllUsers(auth) {
  const all = [];
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    all.push(...page.users);
    token = page.pageToken;
  } while (token);
  return all;
}

module.exports = async (req, res) => {
  try {
    const decoded = await requireAdmin(req);
    const app = getAdminApp();
    const auth = admin.auth(app);
    const db = admin.firestore(app);

    if (req.method === 'DELETE') {
      const uid = String(req.query?.uid || req.body?.uid || '').trim();
      if (!uid) return json(res, 400, { error: '삭제할 사용자 UID가 필요합니다.' });
      if (uid === decoded.uid) return json(res, 400, { error: '현재 로그인한 관리자 계정은 삭제할 수 없습니다.' });

      const target = await auth.getUser(uid);
      if (target.customClaims?.admin === true) {
        return json(res, 403, { error: '관리자 계정은 이 기능으로 삭제할 수 없습니다.' });
      }

      // Firebase Authentication 계정을 먼저 삭제합니다.
      await auth.deleteUser(uid);

      // 삭제된 계정의 개인 Firestore 데이터도 함께 정리합니다.
      try {
        await db.recursiveDelete(db.doc(`users/${uid}`));
      } catch (cleanupError) {
        console.error('deleted user Firestore cleanup failed:', cleanupError);
      }

      // 이용 키의 사용 이력에서도 삭제된 UID를 제거합니다.
      try {
        const keySnap = await db.collection('accessKeys').where('usedBy', 'array-contains', uid).get();
        if (!keySnap.empty) {
          const batch = db.batch();
          keySnap.docs.forEach(doc => {
            const usedBy = Array.isArray(doc.data()?.usedBy) ? doc.data().usedBy : [];
            batch.update(doc.ref, { usedBy: usedBy.filter(id => id !== uid) });
          });
          await batch.commit();
        }
      } catch (cleanupError) {
        console.error('deleted user access-key cleanup failed:', cleanupError);
      }

      return json(res, 200, { ok: true, uid });
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'GET 또는 DELETE만 허용됩니다.' });
    const users = await listAllUsers(auth);

    const accessMap = new Map();
    for (let start = 0; start < users.length; start += 200) {
      const chunk = users.slice(start, start + 200);
      const refs = chunk.map(user => db.doc(`users/${user.uid}/access/meta`));
      if (!refs.length) continue;
      try {
        const snaps = await db.getAll(...refs);
        snaps.forEach((snap, index) => {
          if (snap.exists) accessMap.set(chunk[index].uid, snap.data() || {});
        });
      } catch (error) {
        console.error('admin-users access lookup failed:', error);
      }
    }

    const result = users.map(user => {
      const access = accessMap.get(user.uid) || {};
      const until = formatDate(access.validUntil);
      const active = access.active === true && (!until || new Date(until).getTime() >= Date.now());
      return {
        uid: user.uid,
        email: user.email || null,
        provider: user.providerData?.map(p => p.providerId).filter(Boolean).join(', ') || 'password',
        createdAt: formatDate(user.metadata?.creationTime),
        lastSignInAt: formatDate(user.metadata?.lastSignInTime),
        disabled: Boolean(user.disabled),
        isAdmin: user.customClaims?.admin === true,
        accessActive: active,
        validFrom: formatDate(access.validFrom),
        validUntil: until,
        accessLabel: access.label || '',
        keyId: access.keyId || null
      };
    });

    result.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return json(res, 200, { users: result });
  } catch (error) {
    console.error('GET /api/admin-users failed:', error);
    const message = error?.message || '사용자 목록을 불러오지 못했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `사용자 목록 조회 서버 오류: ${message}` });
  }
};
