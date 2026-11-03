'use strict';
// 실행 중 쌓이는 기록(통계, 질문 로그, 피드백)을 runtime 폴더에 저장한다.
const fs = require('fs');
const path = require('path');

// Vercel에서는 /tmp만 쓸 수 있고 인스턴스가 바뀌면 사라진다 (shortcut: 기록을 오래 보관해야 하면 DB로 교체).
const DIR = process.env.VERCEL ? path.join(require('os').tmpdir(), 'cg-runtime') : path.join(__dirname, '..', 'runtime');
try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* 기록 불가 환경이면 무시 */ }

const STATS_FILE = path.join(DIR, 'stats.json');
const QUESTIONS_FILE = path.join(DIR, 'questions.jsonl');
const FEEDBACK_FILE = path.join(DIR, 'feedback.jsonl');

let stats = {};
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { stats = {}; }

function saveStats() {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 1)); } catch { /* 기록 실패는 무시 */ }
}

function incr(key) {
  stats[key] = (stats[key] || 0) + 1;
  saveStats();
}

function append(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n'); } catch { /* 무시 */ }
}

function readLines(file, limit) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map(l => JSON.parse(l));
  } catch { return []; }
}

module.exports = {
  incr,
  getStats: () => ({ ...stats }),
  logQuestion: obj => append(QUESTIONS_FILE, obj),
  addFeedback: obj => append(FEEDBACK_FILE, obj),
  recentQuestions: (n = 50) => readLines(QUESTIONS_FILE, n),
  recentFeedback: (n = 50) => readLines(FEEDBACK_FILE, n),
};
