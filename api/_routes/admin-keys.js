const { admin, getAdminApp, requireAdmin, json, accessHash, generateAccessKey, enforceRateLimit, writeAuditLog } = require('../_lib/firebaseAdmin');

function toDate(value) { return value?.toDate ? value.toDate() : (value ? new Date(value) : null); }
function statusOf(data) {
  if (!data.active) return ['inactive', '비활성'];
  const until = toDate(data.validUntil);
  if (until && until.getTime() < Date.now()) return ['expired', '만료'];
  return ['active', '활성'];
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
    const db = admin.firestore(app);

    if (req.method === 'GET') {
      const snap = await db.collection('accessKeys').orderBy('createdAt', 'desc').get();
      const allUsers = await listAllUsers(admin.auth(app));
      const userMap = new Map(allUsers.map(user => [user.uid, user]));
      const keys = snap.docs.map(doc => {
        const d = doc.data() || {};
        const [status, statusLabel] = statusOf(d);
        const usedBy = Array.isArray(d.usedBy) ? d.usedBy : [];
        const usedUsers = usedBy.map(uid => {
          const user = userMap.get(uid);
          return { uid, email: user?.email || '(이메일 없음)', disabled: Boolean(user?.disabled) };
        });
        return {
          id: doc.id,
          maskedKey: d.maskedKey || 'HBS-****-****-****-****',
          label: d.label || '',
          active: d.active !== false,
          status,
          statusLabel,
          validFrom: toDate(d.validFrom)?.toISOString().slice(0, 10) || '',
          validUntil: toDate(d.validUntil)?.toISOString().slice(0, 10) || '',
          maxUsers: Number(d.maxUsers || 1),
          usedCount: usedBy.length,
          usedUsers
        };
      });
      return json(res, 200, { keys });
    }

    if (req.method === 'POST') {
      if (!enforceRateLimit(req, res, `admin-keys-create:${decoded.uid}`, 10, 60_000)) return;
      const key = generateAccessKey();
      const validFrom = new Date(`${req.body?.validFrom || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const validUntil = new Date(`${req.body?.validUntil || ''}T23:59:59.999Z`);
      if (Number.isNaN(validUntil.getTime()) || Number.isNaN(validFrom.getTime()) || validUntil < validFrom) {
        return json(res, 400, { error: '유효 기간을 확인해주세요.' });
      }
      const ref = db.collection('accessKeys').doc();
      await ref.set({
        keyHash: accessHash(key),
        maskedKey: key.replace(/^(HBS-[^-]+)-([^-]+)-([^-]+)-([^-]+)$/, 'HBS-$1-****-****-$4'),
        label: String(req.body?.label || '').trim(),
        active: true,
        validFrom: admin.firestore.Timestamp.fromDate(validFrom),
        validUntil: admin.firestore.Timestamp.fromDate(validUntil),
        maxUsers: Math.max(1, Number(req.body?.maxUsers || 1)),
        usedBy: [],
        createdBy: decoded.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await writeAuditLog({ actorUid: decoded.uid, actorEmail: decoded.email, action: 'admin_access_key_create', targetId: ref.id, metadata: { label: String(req.body?.label || '').trim(), validFrom: req.body?.validFrom || '', validUntil: req.body?.validUntil || '', maxUsers: Math.max(1, Number(req.body?.maxUsers || 1)) } });
      return json(res, 200, { key });
    }

    return json(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    console.error(`admin-keys ${req.method} failed:`, error);
    const message = error?.message || '관리자 키 처리에 실패했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `키 목록/발급 서버 오류: ${message}` });
  }
};
