'use strict';
// 서버 없이 파일 하나로 동작하는 HTML을 만든다.
// 사용: node tools/build-artifact.js <출력 파일 경로> [<추가 출력 경로> ...]
// data/*.json, lib/engine.js, lib/chat.js, public/* 를 한 파일에 합친다. (/api 호출은 브라우저 안에서 처리)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const DATA = {};
for (const n of ['options', 'rules', 'articles', 'procedures', 'notes', 'manual', 'audit', 'faq']) DATA[n] = JSON.parse(read('data', n + '.json'));

const bundle = `
const __DATA = ${safe(JSON.stringify(DATA))};
const __defs = {
  './data': function (module) { module.exports = { get: n => { if (!(n in __DATA)) throw new Error(n + ' 데이터가 없습니다'); return __DATA[n]; } }; },
  './store': function (module) {
    const KEY = 'cg_runtime_v1';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { stats: {}, questions: [], feedback: [] }; } catch { return { stats: {}, questions: [], feedback: [] }; } };
    const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
    const at = () => new Date().toISOString();
    module.exports = {
      incr: k => { const s = load(); s.stats[k] = (s.stats[k] || 0) + 1; save(s); },
      logQuestion: o => { const s = load(); s.questions.push({ at: at(), ...o }); s.questions = s.questions.slice(-200); save(s); },
      addFeedback: o => { const s = load(); s.feedback.push({ at: at(), ...o }); s.feedback = s.feedback.slice(-200); save(s); },
    };
  },
  './engine': function (module, exports, require) {
${safe(read('lib', 'engine.js'))}
  },
  './chat': function (module, exports, require) {
${safe(read('lib', 'chat.js'))}
  },
};
const __mods = {};
function __require(name) {
  if (__mods[name]) return __mods[name].exports;
  const m = { exports: {} };
  __mods[name] = m;
  __defs[name](m, m.exports, __require);
  return m.exports;
}
(function () {
  const dataApi = __require('./data'), store = __require('./store'), engine = __require('./engine'), chat = __require('./chat');
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (url, opts = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      const respond = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
      try {
        const body = opts.body ? JSON.parse(opts.body) : {};
        if (url === '/api/meta') return respond(200, { options: dataApi.get('options'), baseDate: dataApi.get('rules').baseDate, faq: dataApi.get('faq').faq.map(f => ({ id: f.id, q: f.q })), lawCount: dataApi.get('articles').length });
        if (url === '/api/guide') { const g = engine.buildGuide(body); store.incr('guide'); return respond(200, g); }
        if (url === '/api/chat') return respond(200, chat.answerQuestion(body));
        if (url === '/api/feedback') {
          const rating = ['up', 'down'].includes(body.rating) ? body.rating : null;
          store.addFeedback({ kind: body.kind === 'answer' ? 'answer' : 'general', rating, comment: String(body.comment || '').slice(0, 1000), question: String(body.question || '').slice(0, 300) });
          store.incr('feedback_' + (rating || 'comment'));
          return respond(200, { ok: true });
        }
        return respond(404, { error: '없는 API입니다.' });
      } catch (e) { return respond(e.status || 500, { error: e.message }); }
    }
    return realFetch ? realFetch(url, opts) : Promise.reject(new Error('fetch 불가'));
  };
})();
`;

let html = read('public', 'index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${read('public', 'style.css')}\n</style>`);
html = html.replace(/ 관리자 화면: <a href="admin.html">admin.html<\/a>/, ' · 이 버전은 서버 없이 이 파일만으로 동작하며, 의견과 질문 기록은 이 브라우저에만 저장됩니다.');
html = html.replace('<script src="app.js"></script>', () => `<script>\n${bundle}\n</script>\n<script>\n${safe(read('public', 'app.js'))}\n</script>`);

const outs = process.argv.slice(2);
if (!outs.length) { console.error('출력 경로를 지정하세요.'); process.exit(1); }
for (const o of outs) { fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, html, 'utf8'); console.log('생성:', o, `${(html.length / 1024).toFixed(0)}KB`); }
