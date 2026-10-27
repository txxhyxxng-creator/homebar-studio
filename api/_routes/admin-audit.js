const { admin, getAdminApp, requireAdmin, json } = require('../_lib/firebaseAdmin');

const actionLabels = {
  admin_impersonate_start: '사용자로 접속 시작',
  admin_delete_user: '가입 사용자 삭제',
  admin_access_key_create: '이용 키 발급',
  admin_access_key_update: '이용 키 수정',
  admin_access_key_revoke: '이용 키 비활성화',
  admin_access_key_delete: '이용 키 삭제',
  admin_web_icon_set: '웹 아이콘 변경',
  admin_web_icon_delete: '웹 아이콘 삭제',
  admin_contact_link_update: '문의 링크 변경',
  catalog_suggestion_approve: '카탈로그 추가 요청 승인',
  catalog_suggestion_reject: '카탈로그 추가 요청 반려',
  catalog_suggestion_create: '카탈로그 추가 요청 등록',
  access_key_activate: '이용 키 활성화'
};

function formatDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = async (req, res) => {
  try {
    const decoded = await requireAdmin(req);
    if (req.method !== 'GET') return json(res, 405, { error: 'GET만 허용됩니다.' });
    const db = admin.firestore(getAdminApp());
    const snap = await db.collection('auditLogs').orderBy('createdAt', 'desc').limit(100).get();
    const logs = snap.docs.map(doc => {
      const d = doc.data() || {};
      const targetEmail = d.metadata?.targetEmail || null;
      return {
        id: doc.id,
        action: d.action || '',
        actionLabel: actionLabels[d.action] || d.action || '관리자 작업',
        actorUid: d.actorUid || null,
        actorEmail: d.actorEmail || null,
        targetUid: d.targetUid || null,
        targetId: d.targetId || null,
        targetEmail,
        createdAt: formatDate(d.createdAt)
      };
    });
    return json(res, 200, { logs, viewerUid: decoded.uid });
  } catch (error) {
    console.error('GET /api/admin-audit failed:', error);
    const message = error?.message || '관리자 작업 기록을 불러오지 못했습니다.';
    const status = message === '관리자 권한이 필요합니다.' || message === '인증 토큰이 없습니다.' ? 403 : 500;
    return json(res, status, { error: status === 403 ? message : `관리자 작업 기록 조회 서버 오류: ${message}` });
  }
};
