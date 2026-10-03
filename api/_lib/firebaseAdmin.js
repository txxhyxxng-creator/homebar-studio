const admin = require('firebase-admin');

function getAdmin() {
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
  return admin;
}

function getDb() {
  return getAdmin().firestore();
}

function getAuth() {
  return getAdmin().auth();
}

async function requireUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const error = new Error('로그인이 필요합니다.');
    error.status = 401;
    throw error;
  }
  const token = header.slice(7).trim();
  try {
    return await getAuth().verifyIdToken(token);
  } catch (_) {
    const error = new Error('인증 토큰이 유효하지 않습니다.');
    error.status = 401;
    throw error;
  }
}

async function requireAdmin(req) {
  const claims = await requireUser(req);
  const bootstrapEmail = String(process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const isBootstrapAdmin = bootstrapEmail && String(claims.email || '').toLowerCase() === bootstrapEmail;
  if (isBootstrapAdmin && claims.admin !== true) {
    await getAuth().setCustomUserClaims(claims.uid, { admin: true });
    claims.admin = true;
  }
  if (claims.admin !== true) {
    const error = new Error('관리자 권한이 필요합니다.');
    error.status = 403;
    throw error;
  }
  return claims;
}

function hashAccessKey(key) {
  const crypto = require('crypto');
  const normalized = String(key || '').trim().toUpperCase();
  const pepper = String(process.env.ACCESS_KEY_PEPPER || '');
  if (!pepper) throw new Error('ACCESS_KEY_PEPPER 환경변수가 없습니다.');
  return crypto.createHash('sha256').update(`${pepper}:${normalized}`).digest('hex');
}

function generateAccessKey() {
  const crypto = require('crypto');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i += 1) raw += alphabet[bytes[i] % alphabet.length];
  return `HBS-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
}

function json(res, status, body) {
  res.status(status).json(body);
}

module.exports = { getAdmin, getDb, getAuth, requireUser, requireAdmin, hashAccessKey, generateAccessKey, json };
