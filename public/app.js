'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let meta = null;
let guide = null;
const QUICK = ['quote', 'announce', 'docs']; // 팝업에 보여 줄 대표 질문 3개 (data/faq.json의 id)
let activePath = 0;

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function fillSelect(id, items) {
  $(id).innerHTML = items.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
}

function formValues() {
  const f = new FormData($('form'));
  return Object.fromEntries(f.entries());
}

function setForm(values) {
  for (const [k, v] of Object.entries(values)) { if ($(k)) $(k).value = v; }
  syncForm();
}

function syncForm() {
  $('subWrap').hidden = $('type').value !== 'construction';
  const v = Number($('amount').value) || 0;
  $('amountHint').textContent = v >= 10000 ? `= ${(v / 10000).toLocaleString('ko-KR')}억원` : '';
}

// ---------- 결과 렌더링 ----------
function badge(verified) {
  return verified ? '<span class="badge ok">조문 확인</span>' : '<span class="badge gen">일반 안내</span>';
}

function renderGuide(g) {
  guide = g;
  $('empty').hidden = true;
  $('result').hidden = false;
  $('chips').innerHTML = g.summary.map(s => `<span class="chip">${esc(s)}</span>`).join('');
  $('verdict').innerHTML = `<div class="verdict ${esc(g.verdict.level)}"><b>${esc(g.verdict.title)}</b><ul>${g.verdict.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>${(g.verdict.conditions || []).length ? `<div class="cond"><b>이런 조건이면 수의계약이 가능할 수 있습니다</b><ul>${g.verdict.conditions.map(l => `<li>${esc(l)}</li>`).join('')}</ul><small>조건을 바꿔 다시 확인하거나, 각 호의 세부 요건은 법령 원문에서 확인하세요.</small></div>` : ''}</div>`;
  activePath = 0;
  renderPath();
  renderManual(g);
  $('laws').innerHTML = g.laws.length ? g.laws.map(lawHtml).join('') : '<p class="muted">표시할 조문이 없습니다.</p>';
  $('notes').innerHTML = g.notes.map(n => `<li>${esc(n)}</li>`).join('');
  $('chatCtx').textContent = `현재 조건 기준: ${g.summary.slice(0, 3).join(' · ')}`;
  if ($('chatPop').hidden) $('chatFab').classList.add('dot');
  try { history.replaceState(null, '', '#' + new URLSearchParams(g.input).toString()); } catch { /* 미리보기 창에서는 주소 변경이 막힐 수 있음 */ }
}

function renderPath() {
  const g = guide;
  $('tabs').innerHTML = g.paths.length > 1
    ? g.paths.map((p, n) => `<button type="button" class="tab" role="tab" aria-selected="${n === activePath}" data-tab="${n}">${esc(p.title)}</button>`).join('')
    : '';
  const p = g.paths[activePath];
  if (!p) { $('steps').innerHTML = '<li><div class="d">안내할 절차가 없습니다.</div></li>'; $('docs').innerHTML = ''; return; }
  $('steps').innerHTML = p.steps.map(s => `
    <li id="step-${s.no}">
      <div class="t">${esc(s.title)}${badge(s.verified)}</div>
      <div class="d">${esc(s.detail)}</div>
      ${(s.tips || []).length ? `<div class="tips"><div class="tipt">실무 매뉴얼</div><ul>${s.tips.map(t => `<li>${esc(t.text)}<button type="button" class="pg" data-tip="${esc(t.id)}">${t.seoul ? '서울시 기준 · ' : ''}매뉴얼 ${t.page}쪽 · 원문 보기</button></li>`).join('')}</ul></div>` : ''}
      ${(s.audits || []).length ? `<details class="audit"><summary>감사 지적사례 ${s.audits.length}건 · 이 단계에서 주의하세요</summary>${s.audits.map(a => `
        <div class="acase">
          <b>${esc(a.title)}</b>
          <span class="small muted">${esc(a.source)} · 매뉴얼 ${a.page}쪽</span>
          <p><em>지적 내용</em> ${esc(a.issue)}</p>
          <p class="alesson"><em>주의할 점</em> ${esc(a.lesson)}</p>
          ${pdfLink(a.page, `원문 보기 (${a.page}쪽)`)}
        </div>`).join('')}</details>` : ''}
      <button type="button" class="back" data-card="${s.no}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="12" height="11" rx="2"/><path d="M7 5h12a2 2 0 0 1 2 2v9"/><path d="M6.5 16l2.5-2.5 2.5 2.5"/></svg>요약 카드로 돌아가기</button>
      ${s.refs.length ? `<div class="refs">근거: ${s.refs.map(id => { const l = g.laws.find(x => x.id === id); return l ? `<a href="#law-${esc(id)}" data-law="${esc(id)}">${esc(l.law)} ${esc(l.title.replace(/\(.*$/, ''))}</a>` : ''; }).join('')}</div>` : ''}
    </li>`).join('');
  renderDeck(p);
  $('docs').innerHTML = p.docs.map((d, n) => {
    const text = typeof d === 'string' ? d : d.text;
    const form = typeof d === 'object' && d.form ? `<a class="formlink" href="${SEOUL_FORMS}" target="_blank" rel="noopener" title="서울계약마당 서식자료실에서 내려받습니다">서식 받기 &#8599;</a>` : '';
    return `<li><label><input type="checkbox" id="doc-${n}"><span>${esc(text)}</span></label>${form}</li>`;
  }).join('') + (p.docs.some(d => d.form) ? `<li class="formnote small muted">'서식 받기'는 서울계약마당 공지사항 › 서식자료실로 이동합니다. 목록에서 해당 서식을 찾아 내려받고, 최신본인지 확인하세요.</li>` : '');
}

function renderDeck(p) {
  const n = p.steps.length;
  $('deck').innerHTML = p.steps.map(s => `
    <article class="card">
      <div class="cno">${s.no}<small> / ${n}</small></div>
      <h4>${esc(s.title)}</h4>
      <p class="brief">${esc(s.brief || s.detail)}</p>
      ${(s.facts || []).length ? `<ul class="facts">${s.facts.map(f => `<li><button type="button" class="fact" data-tip="${esc(f.id)}">${esc(f.text)}</button></li>`).join('')}</ul>` : ''}
      <div class="cfoot">${badge(s.verified)}${(s.audits || []).length ? `<a href="#step-${s.no}" class="achip" data-step="${s.no}">감사 지적 ${s.audits.length}건</a>` : ''}<a href="#step-${s.no}" class="go" data-step="${s.no}">상세 가이드 보기 &rarr;</a></div>
    </article>`).join('');
  $('deck').scrollLeft = 0;
  updatePos();
}
function updatePos() {
  const d = $('deck'), cards = d.children;
  if (!cards.length) return;
  const w = cards[0].offsetWidth + 12;
  $('bPos').textContent = `${Math.min(cards.length, Math.round(d.scrollLeft / w) + 1)} / ${cards.length}`;
}
$('deck').addEventListener('scroll', updatePos);
const nudge = dir => { const d = $('deck'); d.scrollBy({ left: dir * (d.children[0].offsetWidth + 12), behavior: 'smooth' }); };
$('deck').addEventListener('click', e => {
  const t = e.target.closest('[data-tip]');
  if (t) { openTip(t.dataset.tip, t); return; }
  const a = e.target.closest('[data-step]');
  if (!a) return;
  e.preventDefault();
  const li = $('step-' + a.dataset.step);
  if (!li) return;
  li.scrollIntoView({ behavior: 'smooth', block: 'start' });
  li.classList.remove('flash');
  void li.offsetWidth; // 애니메이션 재시작
  li.classList.add('flash');
});
$('bPrev').addEventListener('click', () => nudge(-1));
$('bNext').addEventListener('click', () => nudge(1));

// 관련 법령 패널의 '실무 매뉴얼' 뷰어: 이 결과에 적용되는 매뉴얼 항목을 단계별로 모아 보여 준다.
function renderManual(g) {
  const seen = new Map();
  g.paths.forEach(p => p.steps.forEach(s => (s.tips || []).forEach(t => {
    if (!seen.has(t.id)) seen.set(t.id, { t, step: s.title });
  })));
  const groups = new Map();
  seen.forEach(({ t, step }) => { if (!groups.has(step)) groups.set(step, []); groups.get(step).push(t); });
  $('vcLaw').textContent = `(${g.laws.length})`;
  $('vcMan').textContent = `(${seen.size})`;
  $('manual').innerHTML = seen.size
    ? `<p class="small muted">${esc(g.manual)}에서 이 조건에 해당하는 실무 안내입니다. 법령 조문이 아니며, 서울시 기준 항목은 다른 지방자치단체에서 다를 수 있습니다.</p><p class="mlinks">${seoulLink()} ${pdfLink(105, '인용 쪽 미리보기')}</p><p class="small muted">실무 매뉴얼 전문은 서울계약마당 공지사항 › 문서자료실에서 내려받을 수 있습니다.</p>` +
      [...groups].map(([step, tips]) => `<h4 class="mg">${esc(step)}</h4>` + tips.map(t => `
        <details class="law">
          <summary>${esc(t.title)}<span class="meta">${t.seoul ? '서울시 기준 · ' : ''}매뉴얼 ${t.page}쪽</span></summary>
          <div class="body"><p class="tipbody">${esc(t.text)}</p>${pdfLink(t.page)}</div>
        </details>`).join('')).join('')
    : '<p class="muted">이 조건에 표시할 실무 매뉴얼이 없습니다. 실무 매뉴얼은 지방자치단체 결과에만 제공됩니다.</p>';
  showViewer('law');
}
function showViewer(which) {
  const man = which === 'man';
  $('laws').hidden = man;
  $('manual').hidden = !man;
  $('vtLaw').classList.toggle('on', !man);
  $('vtMan').classList.toggle('on', man);
  $('vtLaw').setAttribute('aria-selected', String(!man));
  $('vtMan').setAttribute('aria-selected', String(man));
}
$('vtLaw').addEventListener('click', () => showViewer('law'));
$('vtMan').addEventListener('click', () => showViewer('man'));

function lawHtml(l) {
  return `
    <details class="law" id="law-${esc(l.id)}">
      <summary>${esc(l.law)} ${esc(l.title)}
        <span class="meta">시행 ${esc(l.effective || '-')} · 원문 확인 ${esc(l.verified)} · <a href="${esc(l.url)}" target="_blank" rel="noopener">법제처 원문 열기</a></span>
      </summary>
      <div class="body">
        ${l.applied.length ? `<div class="applied"><b>입력 조건에 적용된 부분</b><ul>${l.applied.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
        <pre>${esc(l.text)}</pre>
      </div>
    </details>`;
}

// ---------- 챗봇 ----------
const VIA = { button: '저장된 답변', faq: '저장된 답변', cache: '캐시(이전 답변 재사용)', article: '조문 검색 결과', interp: '유권해석 검색 결과', none: '근거 없음', intro: '' };

function addUser(text) {
  const d = document.createElement('div');
  d.className = 'msg user';
  d.textContent = text;
  $('log').appendChild(d);
  $('log').scrollTop = $('log').scrollHeight;
}

// 유권해석(질의회신) 카드: 질의·회신 문단을 그대로 보여 준다. '–'로 시작하는 문단은 하위 항목.
const paras = list => list.map(t => `<p class="${/^[–-]/.test(t) ? 'sub' : ''}">${esc(t)}</p>`).join('');
function interpHtml(i, open) {
  return `<details class="interp"${open ? ' open' : ''}>
    <summary>${esc(i.title)}${i.compare ? '<span class="tag-cmp">비교 사례</span>' : ''}<span class="meta">${esc(i.agency)} ${esc(i.date)} · ${esc(i.category)} · 매뉴얼 ${i.page}쪽</span></summary>
    <div class="ibody"><span class="lab">질의</span>${paras(i.q)}<span class="lab ans">회신</span>${paras(i.a)}${pdfLink(i.page, `매뉴얼 원문 보기 (${i.page}쪽)`)}</div>
  </details>`;
}

function addBot(res, question) {
  const d = document.createElement('div');
  d.className = 'msg bot';
  const src = (res.sources || []).map(s => `
    <div class="src">
      <div class="h">${esc(s.title)} <a href="${esc(s.url)}" target="_blank" rel="noopener">원문</a></div>
      <div class="meta">시행 ${esc(s.effective || '-')} · 원문 확인 ${esc(s.verified)}</div>
      ${(s.excerpt || []).map(x => `<div class="x">${esc(x)}</div>`).join('')}
    </div>`).join('');
  const interps = (res.interps || []).length
    ? `<div class="ih">관련 유권해석 ${res.interps.length}건 <span class="muted">(지방계약 실무 매뉴얼 제7장)</span></div>${res.interps.map((i, n) => interpHtml(i, res.type === 'interp' && res.interps.length === 1 && n === 0)).join('')}` : '';
  const list = (res.list || []).length
    ? `<ul class="ilist">${res.list.map(i => `<li><button type="button" data-interp="${esc(i.id)}">${esc(i.title)}<span class="meta">${esc(i.agency)} ${esc(i.date)}</span></button></li>`).join('')}</ul>` : '';
  const dev = res.ai ? `<details class="dev"><summary>AI 연계 시 전달될 맥락 (개발자용)</summary><pre>${esc(JSON.stringify(res.ai.payload, null, 1))}</pre></details>` : '';
  const rate = res.type && res.type !== 'intro' && !res.list
    ? `<div class="rate">도움이 되었나요? <button type="button" data-rate="up">예</button><button type="button" data-rate="down">아니오</button></div>` : '';
  d.innerHTML = `<span class="av" aria-hidden="true">챗봇</span><div class="bd"><div class="a">${esc(res.answer)}</div>${src}${interps}${list}${VIA[res.type] ? `<div class="via">${esc(VIA[res.type])}</div>` : ''}${dev}${rate}</div>`;
  if (question !== undefined) d.dataset.q = question;
  $('log').appendChild(d);
  $('log').scrollTop = $('log').scrollHeight;
}

async function ask(question, faqId, extra) {
  addUser(question);
  try {
    const res = await api('/api/chat', { question, faqId, ...extra, context: guide ? { ...guide.input, ruleIds: guide.ruleIds } : {} });
    addBot(res, question);
  } catch (e) {
    const d = document.createElement('div');
    d.className = 'msg bot';
    d.innerHTML = '<span class="av" aria-hidden="true">챗봇</span><div class="bd"></div>';
    d.lastChild.textContent = e.message;
    $('log').appendChild(d);
  }
}

// 실무 매뉴얼 원문 쪽 이미지(manual/m<인쇄 쪽수>.jpg). 아티팩트 화면에서는 PDF 파일을 링크로 여는 것이 막혀, 인용한 쪽(105~135쪽)을 이미지로 담아 팝업에서 보여 준다.
const SEOUL_FORMS = 'https://contract.seoul.go.kr/new1/bbs/searchNoticeList.do?ID=1'; // 서식자료실
// 매뉴얼 전문은 서울계약마당 공지사항 > 문서자료실에 게시되어 있다.
const SEOUL_DOCS = 'https://contract.seoul.go.kr/new1/bbs/searchNoticeList.do?ID=2';
const seoulLink = () => `<a class="btn small pdf" href="${SEOUL_DOCS}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>서울계약마당 문서자료실에서 원문 보기</a>`;
// 인용한 쪽: 발주·계약 매뉴얼 105~135쪽, 유권해석 313~371쪽, 감사 지적사례 372~386쪽
const MAN_PAGES = [...Array(31).keys()].map(k => 105 + k).concat([...Array(59).keys()].map(k => 313 + k), [...Array(15).keys()].map(k => 372 + k));
let manPage = 105;
const pdfLink = (page, label) => `<button type="button" class="btn small pdf" data-pdf="${Number(page)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>${esc(label || `매뉴얼 원문 보기 (${page}쪽)`)}</button>`;

function showManPage(n) {
  manPage = MAN_PAGES.includes(n) ? n : MAN_PAGES.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), MAN_PAGES[0]);
  const at = MAN_PAGES.indexOf(manPage);
  $('manImg').src = `manual/m${manPage}.jpg`;
  $('manImg').alt = `2026년 지방계약 실무 매뉴얼 ${manPage}쪽`;
  $('manPos').textContent = `매뉴얼 ${manPage}쪽 (인용 쪽 ${at + 1}/${MAN_PAGES.length})`;
  document.querySelector('[data-mannav="-1"]').disabled = at <= 0;
  document.querySelector('[data-mannav="1"]').disabled = at >= MAN_PAGES.length - 1;
  $('manStage').scrollTop = 0;
}
function openPdf(printed, from) {
  openModal('2026년 지방계약 실무 매뉴얼', `
    <div class="pdfbar">
      <button type="button" class="btn small" data-mannav="-1" aria-label="이전 쪽">&lsaquo; 이전</button>
      <span class="small muted" id="manPos"></span>
      <button type="button" class="btn small" data-mannav="1" aria-label="다음 쪽">다음 &rsaquo;</button>
    </div>
    <div class="pdfstage" id="manStage"><img id="manImg" alt=""></div>
    <p class="small muted">인용한 쪽을 발췌한 이미지입니다. 전체 내용은 서울계약마당 공지사항 › 문서자료실의 매뉴얼 원본에서 확인하세요.</p>
    ${seoulLink()}`, from);
  $('modal').classList.add('wide');
  showManPage(Number(printed));
}

// ---------- 출처 팝업 (조문 원문 / 실무 매뉴얼) ----------
let lastFocus = null;
function openModal(title, html, from) {
  lastFocus = from || null;
  $('mTitle').textContent = title;
  $('mBody').innerHTML = html;
  $('modal').hidden = false;
  $('mBody').scrollTop = 0;
  $('mClose').focus();
}
function closeModal() { $('modal').hidden = true; $('modal').classList.remove('wide'); if (lastFocus) lastFocus.focus(); }
function openLaw(id, from) {
  const l = guide?.laws.find(x => x.id === id);
  if (!l) return;
  openModal(`${l.law} ${l.title}`, `
    <p class="small muted">시행 ${esc(l.effective || '-')} · 원문 확인 ${esc(l.verified)} · <a href="${esc(l.url)}" target="_blank" rel="noopener">법제처 원문 열기</a></p>
    ${l.applied.length ? `<div class="applied"><b>입력 조건에 적용된 부분</b><ul>${l.applied.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
    <pre>${esc(l.text)}</pre>`, from);
}
function openTip(id, from) {
  const t = guide?.paths.flatMap(p => p.steps).flatMap(s => s.tips || []).find(x => x.id === id);
  if (!t) return;
  openModal(`실무 매뉴얼 · ${t.title}`, `
    <p class="small muted">${esc(guide.manual || '지방계약 실무 매뉴얼')} · ${t.seoul ? '서울시 기준' : '일반'} · 매뉴얼 ${t.page}쪽</p>
    <p class="tipbody">${esc(t.text)}</p>
    <p class="small muted">법령 조문이 아닌 실무 안내입니다. 정확한 내용은 매뉴얼 ${t.page}쪽 원문과 소속 기관 규정을 확인하세요.</p>
    ${pdfLink(t.page)}`, from);
}
$('mClose').addEventListener('click', closeModal);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pdf]');
  if (b) openPdf(b.dataset.pdf, b);
  const n = e.target.closest('[data-mannav]');
  if (n) showManPage(MAN_PAGES[MAN_PAGES.indexOf(manPage) + Number(n.dataset.mannav)]);
});
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

// ---------- 메신저 팝업 ----------
function toggleChat(open) {
  $('chatPop').hidden = !open;
  $('chatFab').setAttribute('aria-expanded', String(open));
  $('chatFab').classList.toggle('on', open);
  if (open) { $('chatFab').classList.remove('dot'); $('q').focus(); $('log').scrollTop = $('log').scrollHeight; }
}
$('chatFab').addEventListener('click', () => toggleChat($('chatPop').hidden));
$('chatClose').addEventListener('click', () => { toggleChat(false); $('chatFab').focus(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('modal').hidden) closeModal();
  else if (!$('chatPop').hidden) toggleChat(false);
});

// ---------- 이벤트 ----------
async function runGuide(values) {
  try {
    renderGuide(await api('/api/guide', values));
  } catch (e) {
    $('empty').hidden = false;
    $('result').hidden = true;
    $('empty').innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

$('form').addEventListener('submit', e => { e.preventDefault(); runGuide(formValues()); });
$('form').addEventListener('input', syncForm);
$('example').addEventListener('click', () => {
  const v = { org: 'loc', type: 'goods', amount: 3000, partner: 'smallbiz', method: 'private', special: 'none' };
  setForm(v);
  runGuide(formValues());
});
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('share').textContent = '복사됨'; }
  catch { prompt('이 주소를 복사하세요', location.href); }
  setTimeout(() => { $('share').textContent = '링크 복사'; }, 1500);
});
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) { activePath = Number(b.dataset.tab); renderPath(); }
});
$('steps').addEventListener('click', e => {
  const a = e.target.closest('[data-law]');
  if (a) { e.preventDefault(); openLaw(a.dataset.law, a); }
  const t = e.target.closest('[data-tip]');
  if (t) openTip(t.dataset.tip, t);
  const b = e.target.closest('[data-card]');
  if (b) {
    $('boardPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const c = $('deck').children[Number(b.dataset.card) - 1];
    if (c) $('deck').scrollTo({ left: c.offsetLeft - $('deck').offsetLeft, behavior: 'smooth' });
  }
});
$('quick').addEventListener('click', e => {
  const b = e.target.closest('[data-faq],[data-cat]');
  if (!b) return;
  if (b.dataset.cat) ask(`${b.dataset.cat} 유권해석 보기`, undefined, { category: b.dataset.cat });
  else ask(b.textContent, b.dataset.faq);
});
const goto = (id, open) => { if (open) toggleChat(true); else $(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('navCond').addEventListener('click', () => goto('conditions'));
$('navResult').addEventListener('click', () => goto($('result').hidden ? 'empty' : 'boardPanel'));
$('navChat').addEventListener('click', () => goto(null, true));
$('navInterp').addEventListener('click', () => { toggleChat(true); $('quick').scrollTop = 0; $('quick').querySelector('[data-cat]')?.focus(); });
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (q) { $('q').value = ''; ask(q); }
});
$('log').addEventListener('click', async e => {
  const i = e.target.closest('[data-interp]');
  if (i) { ask(i.firstChild.textContent, undefined, { interpId: i.dataset.interp }); return; }
  const b = e.target.closest('[data-rate]');
  if (!b) return;
  const msg = b.closest('.msg');
  msg.querySelectorAll('[data-rate]').forEach(x => { x.disabled = true; });
  await api('/api/feedback', { kind: 'answer', rating: b.dataset.rate, question: msg.dataset.q || '', context: guide?.input }).catch(() => {});
  b.closest('.rate').textContent = '의견이 전달되었습니다.';
});
$('fbForm').addEventListener('submit', async e => {
  e.preventDefault();
  const comment = $('fbText').value.trim();
  if (!comment) return;
  await api('/api/feedback', { kind: 'general', comment, context: guide?.input }).catch(() => {});
  $('fbText').value = '';
  $('fbMsg').textContent = '의견이 전달되었습니다. 감사합니다.';
});

// ---------- 시작 ----------
(async function init() {
  try {
    meta = await api('/api/meta');
  } catch (e) {
    $('empty').innerHTML = `<div class="error">서버에 연결하지 못했습니다. (${esc(e.message)})</div>`;
    return;
  }
  for (const k of ['org', 'type', 'sub', 'partner', 'method', 'special']) fillSelect(k, meta.options[k]);
  $('org').value = 'loc';
  $('method').value = 'private';
  $('baseInfo').textContent = `저장된 조문 ${meta.lawCount}개 · 법령 확인 기준일 ${meta.baseDate}`;
  $('quick').innerHTML = `<div class="qh">자주 묻는 질문</div><div class="qs">${QUICK.map(id => meta.faq.find(f => f.id === id)).filter(Boolean).map(f => `<button type="button" class="qf" data-faq="${esc(f.id)}">${esc(f.q)}</button>`).join('')}</div>
    <div class="qh">유권해석 ${meta.interpCount}건 · 분야별 보기</div><div class="qs">${meta.interpCategories.map(c => `<button type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
  addBot({ answer: `안녕하세요. 계약 절차와 법령에 대해 궁금한 점을 물어보세요. 질문하면 저장된 조문과 함께 『2026년 지방계약 실무 매뉴얼』의 유권해석(질의회신) ${meta.interpCount}건 중 관련 사례를 찾아 원문 그대로 보여 드립니다. 아래 버튼으로 분야별 유권해석을 둘러볼 수도 있습니다.`, sources: [], type: 'intro' });
  syncForm();
  if (location.hash.length > 1) {
    const v = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    setForm(v);
    runGuide(formValues());
  }
})();
