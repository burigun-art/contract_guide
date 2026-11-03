'use strict';
// Vercel 서버리스 함수: /api/meta, /api/guide, /api/chat, /api/feedback, /api/admin
const { handle } = require('../lib/api');

module.exports = async (req, res) => {
  try {
    const { name, ...query } = req.query || {};
    const r = await handle({ method: req.method, pathname: `/api/${name}`, query, body: req.body && typeof req.body === 'object' ? req.body : {} });
    res.status(r.status).json(r.json);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '서버 오류' });
  }
};
