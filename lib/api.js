'use strict';
// API 처리 (로컬 server.js와 Vercel api/[name].js가 함께 사용). HTTP와 무관하게 {status, json}을 돌려준다.
const { get } = require('./data');
const { buildGuide } = require('./engine');
const { answerQuestion } = require('./chat');
const store = require('./store');

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ok = json => ({ status: 200, json });

async function handle({ method, pathname, query = {}, body = {} }) {
  const route = `${method} ${pathname}`;
  if (route === 'GET /api/meta') {
    return ok({
      options: get('options'),
      baseDate: get('rules').baseDate,
      faq: get('faq').faq.map(f => ({ id: f.id, q: f.q })),
      lawCount: get('articles').length,
    });
  }
  if (route === 'POST /api/guide') {
    const guide = buildGuide(body);
    store.incr('guide');
    return ok(guide);
  }
  if (route === 'POST /api/chat') return ok(answerQuestion(body));
  if (route === 'POST /api/feedback') {
    const rating = ['up', 'down'].includes(body.rating) ? body.rating : null;
    store.addFeedback({
      kind: body.kind === 'answer' ? 'answer' : 'general',
      rating,
      comment: String(body.comment || '').slice(0, 1000),
      question: String(body.question || '').slice(0, 300),
      context: body.context && typeof body.context === 'object' ? body.context : null,
    });
    store.incr(`feedback_${rating || 'comment'}`);
    return ok({ ok: true });
  }
  if (route === 'GET /api/admin') {
    if (ADMIN_KEY && query.key !== ADMIN_KEY) return { status: 403, json: { error: '관리자 키가 필요합니다.' } };
    return ok({ stats: store.getStats(), questions: store.recentQuestions(100), feedback: store.recentFeedback(100) });
  }
  return { status: 404, json: { error: '없는 API입니다.' } };
}

module.exports = { handle };
