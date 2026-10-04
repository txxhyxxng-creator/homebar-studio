const handlers = {
  'admin-audit': require('./_routes/admin-audit'),
  'admin-impersonate': require('./_routes/admin-impersonate'),
  'admin-key': require('./_routes/admin-key'),
  'admin-keys': require('./_routes/admin-keys'),
  'admin-settings': require('./_routes/admin-settings'),
  'admin-users': require('./_routes/admin-users'),
  'catalog-suggestions': require('./_routes/catalog-suggestions'),
  'chat-open': require('./_routes/chat-open'),
  'chat-send': require('./_routes/chat-send'),
  'chat-users': require('./_routes/chat-users'),
  'config': require('./_routes/config'),
  'public-settings': require('./_routes/public-settings'),
  'access/activate': require('./_routes/access/activate'),
  'access/status': require('./_routes/access/status')
};

module.exports = async (req, res) => {
  const route = String(req.query?.route || '').replace(/^\/+|\/+$/g, '');
  const handler = handlers[route];
  if (!handler) {
    return res.status(404).json({ error: 'API 경로를 찾을 수 없습니다.' });
  }
  return handler(req, res);
};
