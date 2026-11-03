'use strict';
// 계약가이드 MVP 서버 (외부 패키지 없음, Node.js 18 이상)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handle } = require('./lib/api');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 50_000) { reject(Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('JSON 형식이 올바르지 않습니다.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  const r = await handle({ method: req.method, pathname: url.pathname, query: Object.fromEntries(url.searchParams), body });
  return send(res, r.status, r.json);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    send(res, e.status || 500, { error: e.message || '서버 오류' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('\n계약가이드 MVP 서버가 실행 중입니다.');
  console.log(`  이 PC에서:   http://localhost:${PORT}`);
  const nets = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal);
  nets.forEach(n => console.log(`  같은 네트워크 팀원: http://${n.address}:${PORT}`));
  console.log(`  관리자 화면: http://localhost:${PORT}/admin.html${ADMIN_KEY ? '?key=(ADMIN_KEY)' : ''}`);
  console.log('  종료: Ctrl + C\n');
});
