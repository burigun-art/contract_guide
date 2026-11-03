'use strict';
// 실행: npm test  (또는 node --test test/)
// 법령 금액 기준을 data/rules.json에서 고쳤다면 이 테스트의 기대값도 함께 고치세요.
const test = require('node:test');
const assert = require('node:assert');
const { buildGuide } = require('../lib/engine');
const { answerQuestion } = require('../lib/chat');

const base = { org: 'loc', type: 'goods', sub: 'general', amount: 3000, partner: 'smallbiz', method: 'private', special: 'none' };
const g = over => buildGuide({ ...base, ...over });

test('지방 물품 3천만원 소기업 수의계약 -> 가능', () => {
  const r = g({});
  assert.strictEqual(r.verdict.level, 'ok');
  assert.deepStrictEqual(r.ruleIds, ['L-GS-SMALL']);
  assert.strictEqual(r.paths[0].key, 'private');
});

test('상대방 조건이 없으면 2천만원 초과 수의계약 근거 없음 -> 경쟁입찰 안내', () => {
  const r = g({ partner: 'none' });
  assert.strictEqual(r.verdict.level, 'bad');
  assert.strictEqual(r.paths[0].key, 'compete');
});

test('2천만원 이하 물품은 상대방과 무관하게 수의계약 가능, 1인 견적 안내', () => {
  const r = g({ amount: 2000, partner: 'none' });
  assert.strictEqual(r.verdict.level, 'ok');
  assert.match(r.paths[0].steps[2].detail, /1인/);
});

test('2천만원 초과 소기업은 2인 이상 견적 안내', () => {
  const r = g({});
  assert.match(r.paths[0].steps[2].detail, /2인 이상/);
});

test('국가 전문공사 3억원은 수의계약 불가(2억원 이하만), 일반 건설공사 3억원은 가능', () => {
  assert.strictEqual(g({ org: 'nat', type: 'construction', sub: 'special', amount: 30000, partner: 'none' }).verdict.level, 'bad');
  assert.strictEqual(g({ org: 'nat', type: 'construction', sub: 'general', amount: 30000, partner: 'none' }).verdict.level, 'ok');
});

test('국가 청년창업기업 5천만원 이하 가능, 지방은 2천만원 초과 5천만원 이하 가능', () => {
  assert.strictEqual(g({ org: 'nat', partner: 'youth', amount: 5000 }).verdict.level, 'ok');
  assert.strictEqual(g({ org: 'loc', partner: 'youth', amount: 5000 }).verdict.level, 'ok');
  assert.strictEqual(g({ org: 'loc', partner: 'youth', amount: 5001 }).verdict.level, 'bad');
});

test('희망 방법을 모르면 수의 가능 시 두 가지 절차를 모두 보여 준다', () => {
  const r = g({ method: 'unknown' });
  assert.deepStrictEqual(r.paths.map(p => p.key), ['private', 'compete']);
});

test('긴급 사유는 금액과 무관하게 수의계약 근거로 표시', () => {
  const r = g({ amount: 99999, partner: 'none', special: 'urgent' });
  assert.strictEqual(r.verdict.level, 'ok');
});

test('공공기관은 아직 지원하지 않음', () => {
  assert.strictEqual(g({ org: 'pub' }).verdict.level, 'warn');
});

test('잘못된 금액은 오류', () => {
  assert.throws(() => g({ amount: -1 }), /추정가격/);
});

test('모든 근거 조문이 articles.json에 있고 원문 링크가 있다', () => {
  const r = g({ method: 'unknown' });
  assert.ok(r.laws.length >= 3);
  r.laws.forEach(l => { assert.ok(l.url.startsWith('https://www.law.go.kr/')); assert.ok(l.text.length > 50); });
});

test('챗봇: 버튼 질문은 저장 답변, 견적 질문은 기관별 답변', () => {
  const r = answerQuestion({ question: '수의계약 견적서는 몇 명에게 받아야 하나요?', faqId: 'quote', context: { org: 'nat' } });
  assert.strictEqual(r.type, 'button');
  assert.match(r.answer, /전자조달시스템/);
});

test('챗봇: 키워드 질문은 FAQ, 같은 질문 반복은 캐시', () => {
  const q = { question: '입찰공고 기간이 궁금해요 ', context: { org: 'loc' } };
  assert.strictEqual(answerQuestion(q).type, 'faq');
  assert.strictEqual(answerQuestion(q).type, 'cache');
});

test('챗봇: 조문 검색으로 답하고 출처 원문을 붙인다', () => {
  const r = answerQuestion({ question: '지명입찰대상자는 몇 명 이상 지명하나요', context: { org: 'loc' } });
  assert.ok(['article', 'faq'].includes(r.type));
  assert.ok(r.sources.length >= 1);
});

test('챗봇: 관련 없는 질문은 근거 없음으로 답하고 단정하지 않는다', () => {
  const r = answerQuestion({ question: '오늘 점심 메뉴 추천해줘', context: { org: 'loc' } });
  assert.strictEqual(r.type, 'none');
  assert.deepStrictEqual(r.sources, []);
  assert.ok(r.ai.payload.q);
});

test('지방 수의계약 결과에 실무 매뉴얼 팁이 붙고 국가는 붙지 않는다', () => {
  const loc = g({});
  const all = loc.paths[0].steps.flatMap(s => s.tips);
  assert.ok(all.some(t => /89\.745/.test(t.text)) && all.some(t => /14일/.test(t.text)) && all.some(t => /인지세/.test(t.text)));
  assert.ok(loc.paths[0].docs.length > 5);
  assert.ok(g({ org: 'nat' }).paths[0].steps.every(s => s.tips.length === 0));
});

test('1인견적(2천만원 이하)에는 2인 견적 팁이 없다', () => {
  const r = g({ amount: 1500, partner: 'none' });
  assert.ok(!r.paths[0].steps.flatMap(s => s.tips).some(t => /89\.745/.test(t.text)));
});

test('근거가 없으면 수의계약이 가능한 조건을 함께 안내한다', () => {
  const r = g({ partner: 'none' });
  assert.strictEqual(r.verdict.level, 'bad');
  const c = r.verdict.conditions.join('\n');
  assert.match(c, /소기업/);
  assert.match(c, /추정가격이 2,000만원 이하/);
  assert.match(c, /천재지변/);
  assert.strictEqual(g({}).verdict.conditions, undefined);
});

test('절차 단계마다 카드뉴스용 요약이 있고 핵심 수치가 붙는다', () => {
  const steps = g({}).paths[0].steps;
  assert.ok(steps.every(s => s.brief));
  assert.ok(steps.flatMap(s => s.facts).some(f => /88%/.test(f.text)));
});

test('단계별 감사 지적사례: 조건에 맞는 것만, 국가기관은 없음', () => {
  const steps = g({}).paths[0].steps;
  const ids = steps.flatMap(s => (s.audits || []).map(a => a.id));
  assert.ok(ids.includes('a14') && ids.includes('a15') && ids.includes('a20') === false); // 물품이라 용역 선금 사례는 제외
  assert.ok(g({ type: 'construction', partner: 'none', amount: 150000, method: 'limited' }).paths[0].steps.flatMap(s => s.audits.map(a => a.id)).includes('a2'));
  assert.ok(g({ org: 'nat' }).paths[0].steps.every(s => s.audits.length === 0));
});
