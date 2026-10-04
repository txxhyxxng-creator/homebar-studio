const { admin, getAdminApp, requireAdmin, json } = require('./_lib/firebaseAdmin');

module.exports = async (req, res) => {
  try {
    const decoded = await requireAdmin(req);
    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 허용됩니다.' });

    const uid = String(req.body?.uid || '').trim();
    if (!uid) return json(res, 400, { error: '접속할 사용자 UID가 필요합니다.' });
    if (uid === decoded.uid) return json(res, 400, { error: '현재 관리자 계정으로는 사용자 접속 기능을 사용할 수 없습니다.' });

    const auth = admin.auth(getAdminApp());
    const target = await auth.getUser(uid);
    if (target.customClaims?.admin === true) return json(res, 403, { error: '관리자 계정으로는 사용자 접속을 할 수 없습니다.' });
    if (target.disabled) return json(res, 400, { error: '비활성화된 계정에는 접속할 수 없습니다.' });

    const token = await auth.createCustomToken(uid, { impersonation: true, impersonatedBy: decoded.uid });
    return json(res, 200, { ok: true, token, uid: target.uid, email: target.email || null });
  } catch (error) {
    console.error('POST /api/admin-impersonate failed:', error);
    const message = error?.message || '사용자 접속을 시작하지 못했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `사용자 접속 서버 오류: ${message}` });
  }
};
