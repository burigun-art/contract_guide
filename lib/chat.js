'use strict';
// 추가 질문 처리. AI를 호출하지 않고 아래 순서로 답한다.
//  1) 질문 버튼/FAQ(저장 답변) -> 2) 캐시 -> 3) 저장된 조문 검색 -> 4) 유권해석 검색 -> 5) 근거 없음 안내
//  조문·FAQ 답변에는 관련 유권해석(지방계약 매뉴얼 제7장 제1절)을 함께 붙인다.
// 4)의 payload는 나중에 AI를 연결할 때 모델에 전달할 압축 맥락이다.
const { get } = require('./data');
const store = require('./store');

const norm = s => String(s).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
// 한국어 조사·질문 어미를 떼고, 의미 없는 단어를 빼고, 단어 안에서만 두 글자씩 끊어 비교한다.
const STOP = new Set(['어떻게', '무엇', '뭐예요', '뭔가요', '얼마', '얼마인가요', '있으면', '있나요', '되나요', '하나요', '인가요', '가능한가', '가능한가요', '가능해요', '알려줘', '알려주세요', '궁금해요', '궁금합니다', '대해', '관련', '경우', '이상', '이하', '해도', '해야', '하나', '어떤']);
const ENDINGS = /(에서|으로|이란|란|은|는|이|가|을|를|에|의|도|로|과|와|요)$/;
function tokens(s) {
  return String(s).toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean)
    .map(t => (STOP.has(t) ? '' : t.length > 2 ? t.replace(ENDINGS, '') : t))
    .filter(t => t.length >= 2 && !STOP.has(t));
}
function bigrams(s) {
  const set = new Set();
  for (const t of tokens(s)) for (let k = 0; k < t.length - 1; k++) set.add(t.slice(k, k + 2));
  return set;
}

// 검색 색인 (data가 바뀌면 다시 만든다). 조문과 유권해석이 같은 방식으로 검색한다.
const indexes = new WeakMap();
function getIndex(list, head, body) {
  let ix = indexes.get(list);
  if (!ix) {
    const docs = list.map(a => ({ a, head: bigrams(head(a)), body: bigrams(body(a)) }));
    const df = new Map();
    docs.forEach(d => new Set([...d.head, ...d.body]).forEach(b => df.set(b, (df.get(b) || 0) + 1)));
    ix = { docs, df, n: docs.length };
    indexes.set(list, ix);
  }
  return ix;
}
const articleIndex = () => getIndex(get('articles'), a => `${a.title} ${a.keywords.join(' ')}`, a => a.text);
const interpIndex = () => getIndex(get('interpretations').items, a => `${a.title} ${a.category}`, a => `${a.q.join(' ')} ${a.a.join(' ')}`);
const idf = (ix, b) => Math.log(1 + ix.n / (ix.df.get(b) || 0.5));

function rank(ix, question, keep = () => true, scale = 1) {
  const q = [...bigrams(question)];
  if (q.length === 0) return [];
  const total = scale * q.reduce((s, b) => s + idf(ix, b), 0);
  return ix.docs
    .filter(d => keep(d.a))
    .map(d => {
      let hit = 0;
      for (const b of q) {
        if (d.head.has(b)) hit += 3 * idf(ix, b);
        else if (d.body.has(b)) hit += idf(ix, b);
      }
      return { a: d.a, score: Math.min(1, hit / total) };
    })
    .sort((x, y) => y.score - x.score);
}
const search = (question, org) => rank(articleIndex(), question, a => !org || org === 'pub' || a.org === org);
// 유권해석은 지방계약 매뉴얼에서 옮긴 것이라 국가기관 질문에는 쓰지 않는다.
const searchInterps = (question, org) => (org === 'nat' ? [] : rank(interpIndex(), question, () => true, 3)); // 질문 단어가 모두 제목에 있으면 1, 본문에만 있으면 1/3

// 조문 안에서 질문과 가장 관련 있는 문단 1~2개를 고른다
function excerpt(article, question) {
  const q = bigrams(question);
  const ix = articleIndex();
  const paras = article.text.split(/\n+/).map(t => t.trim()).filter(Boolean);
  const scored = paras.map((t, k) => {
    let s = 0;
    bigrams(t).forEach(b => { if (q.has(b)) s += idf(ix, b); });
    return { t, k, s };
  });
  const top = scored.filter(p => p.s > 0).sort((a, b) => b.s - a.s).slice(0, 2).sort((a, b) => a.k - b.k);
  const picked = top.length ? top : scored.slice(0, 1);
  return picked.map(p => (p.t.length > 600 ? p.t.slice(0, 600) + ' ...' : p.t));
}

const cache = new Map();
const THRESHOLD = 0.3;
const INTERP_THRESHOLD = 0.5;

function srcCard(a, q) {
  return { id: a.id, title: `${a.law} ${a.title}`, url: a.url, effective: a.effective, verified: a.verified, excerpt: q ? excerpt(a, q) : [] };
}

const interpCard = a => ({ id: a.id, title: a.title, agency: a.agency, date: a.date, page: a.page, category: a.category, compare: !!a.compare, q: a.q, a: a.a });

function answerQuestion({ question, faqId, interpId, category, context }) {
  const org = ['nat', 'loc'].includes(context?.org) ? context.org : null;
  const text = String(question || '').trim().slice(0, 300);
  if (!text) { const e = new Error('질문을 입력하세요.'); e.status = 400; throw e; }
  const articles = get('articles');
  const byId = Object.fromEntries(articles.map(a => [a.id, a]));
  const faq = get('faq').faq;
  const pickAnswer = (f) => (typeof f.a === 'string' ? f.a : f.a[org || 'loc']);
  const pickSrc = (f) => (Array.isArray(f.src) ? f.src : (f.src?.[org || 'loc'] || []));
  const fromFaq = f => ({
    type: 'faq',
    answer: org || typeof f.a === 'string' ? pickAnswer(f) : `[지방자치단체 기준] ${pickAnswer(f)}\n\n※ 국가기관 기준은 조건에서 기관 구분을 선택하면 해당 답변이 표시됩니다.`,
    sources: pickSrc(f).map(id => byId[id]).filter(Boolean).map(a => srcCard(a)),
  });
  const done = (res, kind) => { store.incr(`chat_${kind}`); store.logQuestion({ q: text, type: kind, org }); return { ...res, type: kind }; };

  const items = get('interpretations').items;
  const withInterps = (res, hits) => (hits.length ? { ...res, interps: hits.map(r => interpCard(r.a)) } : res);
  // 0) 유권해석 목록·상세 (질문 버튼)
  if (category) {
    const list = items.filter(i => i.category === category).map(i => ({ id: i.id, title: i.title, agency: i.agency, date: i.date }));
    if (list.length) return done({ answer: `'${category}' 분야 유권해석 ${list.length}건입니다. 제목을 누르면 질의와 회신 원문을 볼 수 있습니다.`, sources: [], list }, 'interp');
  }
  if (interpId) {
    const i = items.find(x => x.id === interpId);
    if (i) return done({ answer: '『2026년 지방계약 실무 매뉴얼』에 실린 질의회신입니다. 이 서비스의 해석이 아니며, 사안이 다르면 결론도 달라질 수 있습니다.', sources: [], interps: [interpCard(i)] }, 'interp');
  }
  // 1) 질문 버튼
  if (faqId) {
    const f = faq.find(x => x.id === faqId);
    if (f) return done(fromFaq(f), 'button');
  }
  // 2) 캐시
  const key = `${org}|${norm(text)}`;
  if (cache.has(key)) return done(cache.get(key), 'cache');
  // 3) FAQ 키워드 (긴 단어일수록 우선)
  let best = null;
  for (const f of faq) {
    const s = f.kw.filter(k => text.includes(k)).reduce((sum, k) => sum + k.length, 0);
    if (s > 0 && (!best || s > best.s)) best = { f, s };
  }
  const interps = searchInterps(text, org).filter(r => r.score >= INTERP_THRESHOLD).slice(0, 2);
  if (best && best.s >= 2) {
    const res = withInterps(fromFaq(best.f), interps);
    cache.set(key, res);
    return done(res, 'faq');
  }
  // 4) 조문 검색
  const ranked = search(text, org);
  const top = ranked.filter(r => r.score >= THRESHOLD).slice(0, 2);
  if (top.length) {
    const res = withInterps({
      answer: '질문과 관련된 조문을 찾았습니다. 아래 원문을 확인하세요. 이 서비스는 조문을 그대로 보여 주며 해석을 덧붙이지 않습니다.',
      sources: top.map(r => srcCard(r.a, text)),
    }, interps);
    cache.set(key, res);
    return done(res, 'article');
  }
  if (interps.length) {
    const res = withInterps({ answer: '관련 유권해석(질의회신)을 찾았습니다. 이 서비스의 해석이 아니라 매뉴얼에 실린 원문입니다.', sources: [] }, interps);
    cache.set(key, res);
    return done(res, 'interp');
  }
  // 5) 근거 없음
  const payload = {
    ctx: context ? [context.org, context.type, context.amount && `${context.amount}만원`, context.partner, context.method].filter(Boolean).join('|') : null,
    ruleIds: context?.ruleIds || [],
    candidates: ranked.slice(0, 3).map(r => r.a.id),
    q: text,
  };
  return done({
    answer: '저장된 조문에서 이 질문의 근거를 찾지 못했습니다. 근거 없이 단정하지 않겠습니다. 소속 기관 계약 담당자에게 문의하거나 국가법령정보센터(law.go.kr)에서 원문을 확인해 주세요.',
    sources: [],
    ai: { connected: false, note: 'AI 연계 시 모델에 전달할 압축 맥락 (결과 전문 대신 코드와 조문 ID만 전달)', payload },
  }, 'none');
}

module.exports = { answerQuestion, search, searchInterps };
