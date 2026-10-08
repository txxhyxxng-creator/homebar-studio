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

// Vercel 함수 인스턴스 단위의 경량 요청 제한입니다. 서버리스 환경에서는 인스턴스가
// 교체될 수 있으므로 이것만으로 보안을 보장하지 않고, Firebase 권한 검증과 함께 사용합니다.
const rateBuckets = new Map();
function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
}
function rateLimit(req, key, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const bucketKey = `${key}:${getClientIp(req)}`;
  const current = rateBuckets.get(bucketKey);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count <= max) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}
function enforceRateLimit(req, res, key, max = 20, windowMs = 60_000) {
  const result = rateLimit(req, key, max, windowMs);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfter));
  json(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', retryAfter: result.retryAfter });
  return false;
}
async function writeAuditLog({ actorUid, actorEmail, action, targetUid = null, targetId = null, metadata = {} }) {
  try {
    const db = admin.firestore(getAdminApp());
    await db.collection('auditLogs').add({
      actorUid: actorUid || null,
      actorEmail: actorEmail || null,
      action: String(action || '').slice(0, 120),
      targetUid: targetUid || null,
      targetId: targetId || null,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('audit log write failed:', error);
  }
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

module.exports = { admin, getAdminApp, verifyBearer, requireAdmin, isAdmin, json, accessHash, generateAccessKey, getClientIp, rateLimit, enforceRateLimit, writeAuditLog };
