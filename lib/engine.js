'use strict';
// 계약가이드 엔진: 입력 조건 -> 규칙(rules.json) + 조문(articles.json) -> 절차·근거·주의사항.
// AI를 호출하지 않으며 같은 입력에는 항상 같은 결과를 돌려준다.
const { get } = require('./data');

const fmtMan = m => {
  if (m >= 10000) {
    const eok = Math.floor(m / 10000);
    const rest = m % 10000;
    return `${eok.toLocaleString('ko-KR')}억원${rest ? ` ${rest.toLocaleString('ko-KR')}만원` : ''}`;
  }
  return `${m.toLocaleString('ko-KR')}만원`;
};

function httpError(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function normalize(input, options) {
  const pick = (key, def) => (options[key].some(o => o.value === input?.[key]) ? input[key] : def);
  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount < 0) throw httpError('추정가격을 0 이상의 숫자(만원 단위)로 입력하세요.');
  return {
    org: pick('org', 'loc'),
    type: pick('type', 'goods'),
    sub: pick('sub', 'general'),
    amount: Math.round(amount),
    partner: pick('partner', 'none'),
    method: pick('method', 'unknown'),
    special: pick('special', 'none'),
  };
}

const labelOf = (options, key, value) => options[key].find(o => o.value === value)?.label ?? value;

function whenOk(when, i) {
  return !when || Object.entries(when).every(([k, v]) => (String(v).startsWith('!') ? i[k] !== v.slice(1) : i[k] === v));
}

function matchRules(i, rules) {
  return rules.rules.filter(r =>
    r.org === i.org && r.types.includes(i.type) &&
    (!r.sub || r.sub === i.sub) && (!r.partner || r.partner === i.partner) &&
    (r.minAmount === undefined || i.amount > r.minAmount) && i.amount <= r.maxAmount);
}

// 수의계약 근거가 없을 때 '어떤 조건이면 가능한지'를 안내한다 (상대방 변경, 금액 기준, 금액과 무관한 사유).
function conditionsFor(i, rules, options) {
  const sameKind = r => r.org === i.org && r.types.includes(i.type) && (!r.sub || r.sub === i.sub);
  const out = [];
  rules.rules.filter(r => sameKind(r) && r.partner && r.partner !== i.partner &&
    (r.minAmount === undefined || i.amount > r.minAmount) && i.amount <= r.maxAmount)
    .forEach(r => out.push(`상대방이 [${labelOf(options, 'partner', r.partner)}]이면 가능할 수 있습니다 (${r.ref}: ${r.text})`));
  const lower = rules.rules.filter(r => sameKind(r) && !r.partner && r.maxAmount < i.amount).sort((a, b) => b.maxAmount - a.maxAmount)[0];
  if (lower) out.push(`추정가격이 ${fmtMan(lower.maxAmount)} 이하인 사업이면 상대방과 관계없이 가능합니다 (${lower.ref}). 금액을 맞추려고 계약을 나누는 분할계약은 금지되므로, 실제 사업 규모가 그 이하일 때만 해당합니다.`);
  rules.reasons.filter(r => r.org === i.org && r.special !== i.special)
    .forEach(r => out.push(`금액과 관계없이 다음에 해당하면 가능할 수 있습니다 (${r.ref}): ${r.text}`));
  return out;
}

// ---------- 수의계약: 견적서 ----------
function quoteStep(i, matched, reasons) {
  const nat = i.org === 'nat';
  const vulnerable = matched.some(r => r.id.endsWith('VULN'));
  const youth = matched.some(r => r.id.endsWith('YOUTH'));
  const one = reasons.length > 0 || i.amount <= 2000 || youth || (vulnerable && i.amount <= 5000);
  const lines = [];
  if (one) lines.push('입력하신 조건에서는 1인으로부터 받은 견적서로 할 수 있는 경우에 해당할 수 있습니다 (제30조제1항 각 호 요건 확인).');
  else lines.push('2인 이상으로부터 견적서를 받아야 합니다 (제30조제1항).');
  if (nat) {
    const needElectronic = matched.length > 0 && i.amount > (vulnerable ? 5000 : 2000);
    if (needElectronic) lines.push('추정가격 2천만원(여성·장애인·사회적기업 등과 체결하면 5천만원)을 초과하는 제26조제1항제5호가목 수의계약은 전자조달시스템으로 견적서를 제출받고 안내공고를 해야 합니다 (제30조제2항·제3항).');
  } else if (!one) {
    lines.push('2인 이상 견적서를 받을 때는 지정정보처리장치를 이용해야 합니다 (행정안전부장관이 정한 경우 예외, 제30조제2항).');
  }
  return {
    key: 'quote',
    title: '견적서 제출 받기',
    detail: lines.join('\n'),
    refs: [nat ? 'NAT-ENF-30' : 'LOC-ENF-30'],
    verified: true,
  };
}

function decideStep(i) {
  const nat = i.org === 'nat';
  return {
    key: 'decide',
    title: '계약상대자 결정',
    detail: nat
      ? '제출받은 견적가격이 예정가격의 범위에 포함되지 않는 등 계약상대자를 결정할 수 없으면 다시 견적서를 제출받아 계약금액을 결정합니다 (제30조제6항).'
      : '견적가격과 계약이행능력 등 행정안전부장관이 정하는 기준에 따라 수의계약대상자를 결정합니다. 견적가격이 예정가격 범위에 들지 않아 결정할 수 없으면 다시 견적서를 제출받습니다 (제30조제3항·제5항).',
    refs: [nat ? 'NAT-ENF-30' : 'LOC-ENF-30'],
    verified: true,
  };
}

// ---------- 경쟁입찰: 입찰공고 ----------
function announceStep(i) {
  const nat = i.org === 'nat';
  const lines = ['입찰서 제출 마감일의 전날부터 기산하여 7일 전에 공고합니다 (제35조제1항).'];
  if (i.type === 'construction') {
    lines.push('공사 + 현장설명 실시: 현장설명일 전날부터 7일 전 (입찰참가자격 사전심사 대상 공사는 30일 전).');
    let days;
    if (i.amount < 100000) days = '7일';
    else if (i.amount < 500000) days = '15일';
    else days = nat ? '40일' : '30일 (고시금액 이상이면 40일)';
    lines.push(`공사 + 현장설명 없음: 입력하신 추정가격 ${fmtMan(i.amount)} 기준 ${days} 전 (제35조제3항).`);
  }
  lines.push('재공고입찰, 예산 조기집행, 일정조정, 긴급한 행사·재해 예방·복구 등에는 5일 전까지 공고할 수 있습니다 (제35조제4항).');
  if (nat) lines.push('입찰공고는 원칙적으로 전자조달시스템을 이용합니다 (제33조제1항).');
  return {
    key: 'announce',
    title: '입찰공고',
    detail: lines.join('\n'),
    refs: nat ? ['NAT-ENF-35', 'NAT-ENF-33'] : ['LOC-ENF-35'],
    verified: true,
  };
}

function methodStep(i, method) {
  const nat = i.org === 'nat';
  const base = nat ? 'NAT-LAW-7' : 'LOC-LAW-9';
  if (method === 'limited') {
    return {
      key: 'method',
      title: '제한경쟁 사유 확인',
      detail: '계약의 목적·성질·규모 등을 고려해 필요하면 참가자의 자격을 제한해 경쟁에 부칠 수 있습니다. 제한할 수 있는 경우와 제한사항은 시행령 조문에서 정하므로 해당 여부와 제한기준을 확인하세요.',
      refs: [base, nat ? 'NAT-ENF-21' : 'LOC-ENF-20', ...(nat ? [] : ['LOC-ENF-21'])],
      verified: true,
    };
  }
  if (method === 'designated') {
    return {
      key: 'method',
      title: '지명경쟁 사유 확인',
      detail: nat
        ? '지명경쟁입찰에 부칠 수 있는 경우는 시행령 제23조에서 정합니다. 해당 사유(예: 특수한 설비·기술·실적이 필요하고 입찰대상자가 10인 이내인 경우 등)를 원문에서 확인하세요.'
        : '지명입찰에 부칠 수 있는 경우는 시행령 제22조에서 정하고, 지명할 때는 5인 이상의 입찰대상자를 지명하는 것이 원칙입니다(제23조). 해당 사유와 예외를 원문에서 확인하세요.',
      refs: [base, nat ? 'NAT-ENF-23' : 'LOC-ENF-22', ...(nat ? [] : ['LOC-ENF-23'])],
      verified: true,
    };
  }
  return {
    key: 'method',
    title: '일반경쟁 방식으로 진행',
    detail: nat
      ? '계약을 체결하려면 일반경쟁에 부쳐야 하는 것이 원칙입니다. 제한경쟁·지명경쟁·수의계약은 예외입니다 (국가계약법 제7조제1항).'
      : '계약을 체결하려면 공고하여 일반입찰에 부쳐야 하는 것이 원칙입니다. 지명입찰·수의계약은 예외입니다 (지방계약법 제9조제1항).',
    refs: [base],
    verified: true,
  };
}

function qualificationStep(i) {
  const nat = i.org === 'nat';
  return {
    key: 'qualification',
    title: '입찰 참가자격 확인',
    detail: nat
      ? '필요한 경우 계약이행의 난이도, 이행실적, 기술능력, 재무상태 등을 심사해 적격자만 입찰에 참가하게 할 수 있습니다 (제7조제2항).'
      : '필요한 경우 입찰 참가자격을 미리 심사해 적격자만 입찰에 참가하게 할 수 있습니다. 낙찰자 결정 방식에 따라 사전심사가 필수인 공사계약도 있습니다 (제14조).',
    refs: nat ? ['NAT-LAW-7'] : ['LOC-ENF-14'],
    verified: true,
  };
}

// 실무 매뉴얼(data/manual.json) 중 이 조건·단계에 맞는 항목. 지방계약 매뉴얼이므로 지방자치단체만 해당.
function tipsFor(i, step, tips) {
  if (i.org !== 'loc') return [];
  return tips.filter(t => [].concat(t.step).includes(step) &&
    (!t.types || t.types.includes(i.type)) &&
    (t.min === undefined || i.amount > t.min) && (t.max === undefined || i.amount <= t.max) &&
    whenOk(t.when, i));
}

// 카드뉴스용 단계 한 줄 요약
const BRIEF = {
  budget: '사업 목적과 예산을 확인하고, 필요한 사전 심의와 발주계획 등록을 마칩니다.',
  estimate: '추정가격을 산정해 계약 방법을 정하는 기준 금액을 확정합니다.',
  private: '입력 조건에 해당하는 수의계약 근거를 확인하고 상대방 증빙을 준비합니다.',
  quote: '견적서를 몇 명에게, 어떤 방식으로 받을지 정해 제출받습니다.',
  decide: '견적가격과 이행능력 기준으로 계약상대자를 정합니다.',
  method: '선택한 경쟁 방식의 사유와 요건을 원문으로 확인합니다.',
  announce: '정해진 기간 전에 입찰공고를 냅니다.',
  qualification: '입찰 참가자격을 확인하고 필요하면 사전심사를 합니다.',
  award: '개찰 후 낙찰자 결정 방법에 따라 낙찰자를 정합니다.',
  contract: '계약서를 작성하고 보증금·인지세를 받은 뒤 체결합니다.',
  perform: '이행 결과를 검사하고 대금을 지급합니다.',
};

const general = (proc, key) => ({ key, ...proc.common[key], refs: [], verified: false });

function buildGuide(rawInput) {
  const options = get('options');
  const rules = get('rules');
  const articles = get('articles');
  const proc = get('procedures');
  const notesDef = get('notes');
  const manual = get('manual');
  const audit = get('audit');
  const byId = Object.fromEntries(articles.map(a => [a.id, a]));

  const i = normalize(rawInput, options);
  const summary = [
    labelOf(options, 'org', i.org).replace(/ \(.*$/, ''),
    labelOf(options, 'type', i.type).replace(/ \(.*$/, '') + (i.type === 'construction' ? ` · ${labelOf(options, 'sub', i.sub).replace(/ \(.*$/, '')}` : ''),
    `추정가격 ${fmtMan(i.amount)}`,
    labelOf(options, 'partner', i.partner),
    labelOf(options, 'method', i.method).replace(/ \(.*$/, ''),
    `긴급·특수 사유: ${labelOf(options, 'special', i.special)}`,
  ];

  const base = { input: i, summary, baseDate: rules.baseDate };

  if (i.org === 'pub') {
    return {
      ...base,
      verdict: { level: 'warn', title: '공공기관은 아직 지원하지 않습니다', lines: ['공공기관은 기관별 계약 규정이 적용될 수 있어 소속 기관 규정을 확인해야 합니다. 국가기관 또는 지방자치단체를 선택해 주세요.'] },
      paths: [], laws: [], notes: ['공공기관 기준은 후속 단계에서 추가할 예정입니다.'], ruleIds: [],
    };
  }

  const matched = matchRules(i, rules);
  const reasons = rules.reasons.filter(r => r.org === i.org && r.special === i.special);
  const basis = [...matched, ...reasons];
  const hasBasis = basis.length > 0;
  const nat = i.org === 'nat';
  const principle = nat
    ? '국가계약법 제7조제1항: 계약을 체결하려면 일반경쟁에 부쳐야 하며, 필요하다고 인정되면 제한·지명경쟁 또는 수의계약을 할 수 있습니다.'
    : '지방계약법 제9조제1항: 계약을 체결하려면 공고하여 일반입찰에 부쳐야 하며, 필요하다고 인정되면 지명입찰 또는 수의계약을 할 수 있습니다.';

  const conditions = !hasBasis && i.special !== 'single' && ['private', 'unknown'].includes(i.method) ? conditionsFor(i, rules, options) : [];

  // ---- 판정 ----
  const basisLines = basis.map(r => `${r.ref}: ${r.text}`);
  let verdict;
  if (i.method === 'private') {
    if (hasBasis) verdict = { level: 'ok', title: '입력하신 조건으로 수의계약 근거에 해당할 수 있습니다', lines: [...basisLines, principle] };
    else if (i.special === 'etc') verdict = { level: 'warn', title: '금액·상대방 조건으로는 근거를 찾지 못했습니다. 시행령 각 호의 다른 사유를 확인해야 합니다', lines: ['선택하신 "기타 사유"는 이 서비스가 판정하지 못합니다. 시행령 수의계약 조문의 각 호를 원문에서 확인하세요.', principle] };
    else verdict = { level: 'bad', title: '입력하신 조건으로는 수의계약 근거를 찾지 못했습니다', conditions, lines: ['경쟁입찰(일반·제한·지명경쟁) 절차를 안내합니다. 긴급·경쟁 불가 등 다른 사유가 있다면 "긴급·특수 사유"를 선택해 다시 확인하세요.', principle] };
  } else if (i.method === 'unknown') {
    if (hasBasis) verdict = { level: 'ok', title: '수의계약이 가능할 수 있지만, 경쟁이 원칙입니다', lines: [...basisLines, principle] };
    else verdict = { level: 'info', title: '수의계약 근거를 찾지 못해 경쟁입찰 절차를 안내합니다', conditions, lines: [principle] };
  } else {
    const name = labelOf(options, 'method', i.method);
    verdict = { level: 'info', title: `${name} 절차를 안내합니다`, lines: [...(hasBasis ? [`참고: 입력 조건으로 수의계약 근거에도 해당할 수 있습니다 (${basis.map(r => r.ref).join(', ')}).`] : []), principle] };
  }

  // ---- 절차 ----
  const paths = [];
  const privateSteps = () => [
    general(proc, 'budget'),
    { key: 'private', title: '추정가격 산정과 수의계약 근거 확인', detail: `${basisLines.map(l => `- ${l}`).join('\n')}\n근거 요건(상대방 확인서류 등)을 충족하는지 확인합니다.`, refs: [...new Set(basis.map(r => r.law))], verified: true },
    quoteStep(i, matched, reasons),
    decideStep(i),
    general(proc, 'contract'),
    general(proc, 'perform'),
  ];
  const competeSteps = method => [
    general(proc, 'budget'),
    general(proc, 'estimate'),
    methodStep(i, method),
    announceStep(i),
    qualificationStep(i),
    general(proc, 'award'),
    general(proc, 'contract'),
    general(proc, 'perform'),
  ];
  const competeMethod = ['limited', 'designated'].includes(i.method) ? i.method : 'open';
  const competeTitle = { open: '일반경쟁 절차', limited: '제한경쟁 절차', designated: '지명경쟁 절차' }[competeMethod];

  if (i.method === 'private' && hasBasis) paths.push({ key: 'private', title: '수의계약 절차', steps: privateSteps(), docs: proc.docs.private });
  else if (i.method === 'unknown' && hasBasis) {
    paths.push({ key: 'private', title: '수의계약 절차', steps: privateSteps(), docs: proc.docs.private });
    paths.push({ key: 'compete', title: '경쟁입찰 절차', steps: competeSteps('open'), docs: proc.docs.compete });
  } else {
    paths.push({ key: 'compete', title: competeTitle, steps: competeSteps(competeMethod), docs: proc.docs.compete });
  }
  paths.forEach(p => {
    if (i.org === 'loc') p.docs = manual.docs[p.key];
    p.steps.forEach((s, n) => {
      s.no = n + 1;
      const tips = tipsFor(i, s.key, manual.tips);
      s.tips = tips.map(t => ({ id: t.id, title: t.title, text: t.text, page: t.page, seoul: !!t.seoul }));
      s.audits = tipsFor(i, s.key, audit.cases).map(c => ({ id: c.id, title: c.title, source: c.source, page: c.page, issue: c.issue, lesson: c.lesson }));
      s.brief = BRIEF[s.key] || '';
      s.facts = tips.filter(t => t.fact).map(t => ({ id: t.id, text: t.fact }));
    });
  });

  // ---- 근거 조문 ----
  const lawMap = new Map();
  const touch = id => {
    if (!byId[id]) return null;
    if (!lawMap.has(id)) lawMap.set(id, { ...byId[id], applied: [] });
    return lawMap.get(id);
  };
  basis.forEach(r => touch(r.law)?.applied.push(`${r.ref}: ${r.text}`));
  paths.forEach(p => p.steps.forEach(s => s.refs.forEach(touch)));
  const laws = [...lawMap.values()].map(a => ({
    id: a.id, law: a.law, title: a.title, effective: a.effective, verified: a.verified, url: a.url, applied: a.applied, text: a.text,
  }));

  // ---- 주의사항 ----
  const notes = notesDef.notes.filter(n => whenOk(n.when, i)).map(n => n.text);
  reasons.forEach(r => r.note && notes.push(r.note));

  return { ...base, verdict, paths, laws, notes, ruleIds: basis.map(r => r.id), manual: i.org === 'loc' ? manual.source : null };
}

module.exports = { buildGuide, normalize };
