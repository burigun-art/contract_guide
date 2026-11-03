'use strict';
// data/*.json 을 읽어 오되, 파일이 바뀌면 서버 재시작 없이 다시 읽는다.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const cache = {};

function get(name) {
  const file = path.join(DIR, name + '.json');
  const mtime = fs.statSync(file).mtimeMs;
  if (!cache[name] || cache[name].mtime !== mtime) {
    try {
      cache[name] = { mtime, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      const err = new Error(`data/${name}.json 을 읽을 수 없습니다. JSON 문법(쉼표, 따옴표)을 확인하세요. (${e.message})`);
      err.status = 500;
      throw err;
    }
  }
  return cache[name].value;
}

module.exports = { get };
