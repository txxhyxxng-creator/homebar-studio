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
  if (req.method !== 'GET') return json(res, 405, { error: 'GET만 허용됩니다.' });
  try {
    await requireAdmin(req);
    const app = getAdminApp();
    const auth = admin.auth(app);
    const db = admin.firestore(app);
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
