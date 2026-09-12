'use strict';

/**
 * 検索対象（インデックス）の線引きのガード。
 * 中身が確認できていない講座のページを検索対象として送らないこと、
 * 静的ページとサイトマップで同じ線引きになっていることを固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { ROBOTS_NOINDEX, isIndexableSchool, isIndexableGenre, withRobotsNoindex } = require('../lib/indexing');
const { NOT_DISCLOSED_TEXT } = require('../lib/schema');
const { buildSitemap } = require('../generate-sitemap');
const { readSchools } = require('../lib/schools-store');

const SCRAPER = path.join(__dirname, '..');

function school(over) {
  return Object.assign({ id: 'x', status: 'active', description: '説明文', skill_genre: ['programming'] }, over || {});
}

test('説明文を確認できなかった講座は検索対象にしない', () => {
  assert.strictEqual(isIndexableSchool(school({ description: NOT_DISCLOSED_TEXT })), false);
});

test('説明文を確認できた講座は検索対象にする', () => {
  assert.strictEqual(isIndexableSchool(school()), true);
});

test('掲載をやめた講座は検索対象にしない', () => {
  assert.strictEqual(isIndexableSchool(school({ status: 'skipped' })), false);
});

test('中身のある講座が1件も無いジャンルは検索対象にしない', () => {
  const list = [school({ id: 'a', skill_genre: ['uiux'], description: NOT_DISCLOSED_TEXT }), school({ id: 'b' })];
  assert.strictEqual(isIndexableGenre(list, 'uiux'), false);
  assert.strictEqual(isIndexableGenre(list, 'programming'), true);
});

test('noindex は文字コード指定の直後に1つだけ入る', () => {
  const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>x</title></head><body></body></html>';
  const once = withRobotsNoindex(html);
  assert.ok(once.includes(`<meta charset="UTF-8">\n${ROBOTS_NOINDEX}`));
  assert.strictEqual(withRobotsNoindex(once), once);
});

test('静的ページの生成で、同じ線引きを使っている', () => {
  const src = fs.readFileSync(path.join(SCRAPER, 'prerender.js'), 'utf8');
  assert.match(src, /noindex: !isIndexableSchool\(school\)/, '講座ページが線引きを使っていない');
  assert.match(src, /noindex: !isIndexableGenre\(schools, genre\)/, 'ジャンル別ページが線引きを使っていない');
  assert.match(src, /withRobotsNoindex\(html\)/, 'noindex を入れる箇所が無い');
});

test('サイトマップに、検索対象外の講座を載せない', () => {
  const src = fs.readFileSync(path.join(SCRAPER, 'generate-sitemap.js'), 'utf8');
  assert.match(src, /schools\.filter\(isIndexableSchool\)/, 'サイトマップが線引きを使っていない');

  const schools = readSchools().filter(s => s.status === 'active');
  const xml = buildSitemap(schools.filter(isIndexableSchool), []);
  const hidden = schools.filter(s => !isIndexableSchool(s));
  for (const s of hidden) {
    assert.ok(!xml.includes(`/school/${s.id}/`), `${s.id} がサイトマップに載っている`);
  }
});
