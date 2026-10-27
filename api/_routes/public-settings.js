const { getAdminApp, admin, json } = require('../_lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET만 허용됩니다.' });
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const db = admin.firestore(getAdminApp());
    const snap = await db.doc('settings/public').get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const link = data.contactLink || {};
    return json(res, 200, {
      contactLink: {
        label: String(link.label || '이용 문의 · 키 받기').slice(0, 40),
        url: String(link.url || '').trim()
      },
      webIcon: String(data.webIcon || '').trim()
    });
  } catch (error) {
    console.error('GET /api/public-settings failed:', error);
    return json(res, 200, { contactLink: { label: '이용 문의 · 키 받기', url: '' }, webIcon: '' });
  }
};
