const admin = require('firebase-admin');

let initialized = false;

function getAdminApp() {
  if (!initialized) {
    if (!admin.apps.length) {
      const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
      if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
        throw new Error('Firebase Admin 환경변수가 설정되지 않았습니다.');
      }
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey
        })
      });
    }
    initialized = true;
  }
  return admin.app();
}

async function verifyBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new Error('인증 토큰이 없습니다.');
  const token = header.slice(7).trim();
  if (!token) throw new Error('인증 토큰이 없습니다.');
  return admin.auth(getAdminApp()).verifyIdToken(token, true);
}

function isAdmin(decoded) {
  return decoded?.admin === true;
}

async function requireAdmin(req) {
  const decoded = await verifyBearer(req);
  const bootstrapEmail = String(process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const decodedEmail = String(decoded?.email || '').trim().toLowerCase();
  const bootstrapAdmin = Boolean(bootstrapEmail && decodedEmail && decodedEmail === bootstrapEmail);

  // 최초 관리자 로그인 직후에는 Custom Claims가 아직 브라우저의 기존 ID 토큰에
  // 반영되지 않을 수 있습니다. 이 경우에도 지정된 bootstrap 계정은 서버에서
  // 관리자 API를 사용할 수 있도록 하고, 이후 새 토큰에서 admin claim이 적용됩니다.
  if (!isAdmin(decoded) && !bootstrapAdmin) {
    throw new Error('관리자 권한이 필요합니다.');
  }

  if (bootstrapAdmin && !isAdmin(decoded)) {
    await admin.auth(getAdminApp()).setCustomUserClaims(decoded.uid, { admin: true });
  }
  return decoded;
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

function accessHash(value) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(`${process.env.ACCESS_KEY_PEPPER || ''}:${String(value || '').trim().toUpperCase()}`).digest('hex');
}

function generateAccessKey() {
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `HBS-${bytes.slice(0,4)}-${bytes.slice(4,8)}-${bytes.slice(8,12)}-${bytes.slice(12,16)}`;
}

module.exports = { admin, getAdminApp, verifyBearer, requireAdmin, isAdmin, json, accessHash, generateAccessKey };
