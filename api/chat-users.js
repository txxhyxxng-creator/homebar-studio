const { admin, getAdminApp, verifyBearer, json, enforceRateLimit } = require('./_lib/firebaseAdmin');

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
    const decoded = await verifyBearer(req);
    if (req.method !== 'GET') return json(res, 405, { error: 'GET만 허용됩니다.' });
    if (!enforceRateLimit(req, res, `chat-users:${decoded.uid}`, 30, 60_000)) return;

    const app = getAdminApp();
    const auth = admin.auth(app);
    const db = admin.firestore(app);
    const users = await listAllUsers(auth);

    const accessMap = new Map();
    for (let start = 0; start < users.length; start += 200) {
      const chunk = users.slice(start, start + 200);
      const refs = chunk.map(user => db.doc(`users/${user.uid}/access/meta`));
      if (!refs.length) continue;
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, index) => {
        if (snap.exists) accessMap.set(chunk[index].uid, snap.data() || {});
      });
    }

    const eligible = users.filter(user => {
      if (user.uid === decoded.uid) return false;
      if (user.disabled) return false;
      if (user.customClaims?.admin === true) return false;
      const access = accessMap.get(user.uid) || {};
      const until = formatDate(access.validUntil);
      const from = formatDate(access.validFrom);
      const now = Date.now();
      const active = access.active === true && (!from || new Date(from).getTime() <= now) && (!until || new Date(until).getTime() >= now);
      return active;
    });

    const profileMap = new Map();
    for (let start = 0; start < eligible.length; start += 200) {
      const chunk = eligible.slice(start, start + 200);
      const refs = chunk.map(user => db.doc(`profiles/${user.uid}`));
      if (!refs.length) continue;
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, index) => {
        profileMap.set(chunk[index].uid, snap.exists ? (snap.data() || {}) : {});
      });
    }

    const result = eligible.map(user => {
      const profile = profileMap.get(user.uid) || {};
      const fallback = String(user.email || '').split('@')[0] || 'BarTail User';
      return {
        uid: user.uid,
        nickname: String(profile.nickname || fallback).slice(0, 20),
        avatar: typeof profile.avatar === 'string' ? profile.avatar : '',
        createdAt: formatDate(user.metadata?.creationTime)
      };
    }).sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));

    return json(res, 200, { users: result });
  } catch (error) {
    console.error('GET /api/chat-users failed:', error);
    const message = error?.message || '사용자 목록을 불러오지 못했습니다.';
    const status = message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `채팅 사용자 목록 조회 서버 오류: ${message}` });
  }
};
