'use strict';

/**
 * lib/recommend.js（おすすめ枠の選び方）の検証。
 *
 * この枠は提携（アフィリエイト）している講座だけを出す商業的な枠なので、
 * 「提携していない講座が紛れ込まないこと」と「広告であることの表示が消えないこと」を
 * ここで固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { isRecommendable, pickRecommended, shuffle } = require('../lib/recommend');

const ROOT = path.join(__dirname, '..', '..');
const affiliate = { id: 'a', status: 'active', cta_type: 'affiliate' };
const direct = { id: 'b', status: 'active', cta_type: 'direct' };

/** 毎回同じ順序になる擬似乱数（テストを安定させるため）。 */
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('提携していない講座は選ばれない', () => {
  const picked = pickRecommended([affiliate, direct], { rng: seededRng(1) });
  assert.deepStrictEqual(picked.map(s => s.id), ['a']);
});

test('掲載していない（status!==active）講座は選ばれない', () => {
  const hidden = { id: 'c', status: 'skipped', cta_type: 'affiliate' };
  assert.strictEqual(isRecommendable(hidden), false);
  assert.deepStrictEqual(pickRecommended([hidden], { rng: seededRng(1) }), []);
});

test('提携が1件も無ければ空を返す（他の講座で埋めない）', () => {
  // ここで情報が充実した講座などを代わりに出すと、「PR」表示と実態が食い違う。
  assert.deepStrictEqual(pickRecommended([direct, { ...direct, id: 'd' }]), []);
});

test('欠けた入力でも例外にならない', () => {
  assert.strictEqual(isRecommendable(null), false);
  assert.strictEqual(isRecommendable({}), false);
  assert.deepStrictEqual(pickRecommended(null), []);
  assert.deepStrictEqual(pickRecommended(undefined), []);
});

test('limit を超えて返さない', () => {
  const list = [];
  for (let i = 0; i < 20; i += 1) list.push({ ...affiliate, id: 'id' + i });
  assert.strictEqual(pickRecommended(list, { limit: 5, rng: seededRng(3) }).length, 5);
  assert.strictEqual(pickRecommended(list, { rng: seededRng(3) }).length, 10);
});

test('表示順はランダム（特定の1社が常に先頭にならない）', () => {
  const list = [];
  for (let i = 0; i < 10; i += 1) list.push({ ...affiliate, id: 'id' + i });
  const a = pickRecommended(list, { rng: seededRng(1) }).map(s => s.id).join(',');
  const b = pickRecommended(list, { rng: seededRng(99) }).map(s => s.id).join(',');
  assert.notStrictEqual(a, b);
});

test('shuffle は要素を失わない・元の配列を書き換えない', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, seededRng(5));
  assert.deepStrictEqual(out.slice().sort(), src.slice().sort());
  assert.deepStrictEqual(src, [1, 2, 3, 4, 5]);
});

test('実データで、提携していない講座が混ざっていない', () => {
  const schools = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'schools.json'), 'utf8'));
  const picked = pickRecommended(schools);
  assert.ok(picked.every(s => s.cta_type === 'affiliate' && s.status === 'active'));
});

test('おすすめ枠に「PR」の表示が付いている', () => {
  // 提携している講座を選んで見せる枠なので、広告であることを隠すと景品表示法に触れる。
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /pr-label[^>]*">PR</, 'index.html に PR 表示が無い');
  // 薄くしすぎて読めないと表示した意味が無い。背景の不透明度は 0.4 以上を保つ。
  const alpha = html.match(/\.pr-label\{[^}]*rgba\([^)]*?,\s*([0-9.]+)\)/);
  assert.ok(alpha && Number(alpha[1]) >= 0.4,
    `PR表示の背景が薄すぎる（${alpha ? alpha[1] : '不明'}）`);
  assert.match(html, /isRecommendable|cta_type === 'affiliate'/,
    'PR表示の出し分けが提携の有無に結びついていない');
});

test('おすすめ枠の説明が faq.html と privacy.html にある', () => {
  const faq = fs.readFileSync(path.join(ROOT, 'faq.html'), 'utf8');
  assert.match(faq, /おすすめ講座/, 'faq.html におすすめ枠の説明がない');
  assert.match(faq, /提携/, 'faq.html に提携であることの説明がない');
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assert.match(privacy, /おすすめ講座/, 'privacy.html におすすめ枠の説明がない');
});
