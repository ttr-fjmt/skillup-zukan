'use strict';

/**
 * lib/recommend.js（おすすめ枠の選び方）の検証。
 *
 * 「おすすめ」は掲載情報の充実度で決めており、広告費や恣意的な順位付けは入れない。
 * その前提が崩れていないことをここで固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { recommendScore, pickRecommended, shuffle } = require('../lib/recommend');

const base = {
  id: 'x', status: 'active', description: 'あ'.repeat(80),
  price: { min_yen: 100000, kind: 'total' }, plans: [{}, {}],
  features: ['a', 'b', 'c'], career_paths: ['Webエンジニア'], area: ['東京都'],
  subsidy_eligible: true, career_support: true, review_flags: [],
};

/** 毎回同じ順序になる擬似乱数（テストを安定させるため）。 */
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('料金が分かる講座は、分からない講座より高いスコアになる', () => {
  const withPrice = recommendScore(base);
  const without = recommendScore({ ...base, price: { min_yen: null, kind: 'total' } });
  assert.ok(withPrice > without, `${withPrice} > ${without} であるべき`);
});

test('確認しきれなかった項目があると差し引かれる', () => {
  const clean = recommendScore(base);
  const flagged = recommendScore({ ...base, review_flags: ['price_scope_limited', 'area_unconfirmed'] });
  assert.strictEqual(flagged, clean - 2);
});

test('空のレコードでも例外にならない', () => {
  assert.strictEqual(recommendScore(null), 0);
  assert.strictEqual(typeof recommendScore({}), 'number');
});

test('掲載していない（status!==active）講座は選ばれない', () => {
  const list = [
    { ...base, id: 'a' },
    { ...base, id: 'b', status: 'skipped' },
  ];
  const picked = pickRecommended(list, { rng: seededRng(1) });
  assert.deepStrictEqual(picked.map(s => s.id), ['a']);
});

test('候補はスコア上位に限られ、同点は id 順で安定する', () => {
  const list = [];
  for (let i = 0; i < 20; i += 1) {
    list.push({ ...base, id: 'id' + String(i).padStart(2, '0'), features: [] });
  }
  // 全員同点なので、poolSize=3 なら id の小さい3件が候補になる。
  const picked = pickRecommended(list, { poolSize: 3, limit: 3, rng: seededRng(7) });
  assert.deepStrictEqual(picked.map(s => s.id).sort(), ['id00', 'id01', 'id02']);
});

test('limit を超えて返さない', () => {
  const list = [];
  for (let i = 0; i < 20; i += 1) list.push({ ...base, id: 'id' + i });
  assert.strictEqual(pickRecommended(list, { limit: 5, rng: seededRng(3) }).length, 5);
});

test('表示順はランダム（同じ顔ぶれでも並びが変わりうる）', () => {
  const list = [];
  for (let i = 0; i < 10; i += 1) list.push({ ...base, id: 'id' + i });
  const a = pickRecommended(list, { rng: seededRng(1) }).map(s => s.id).join(',');
  const b = pickRecommended(list, { rng: seededRng(99) }).map(s => s.id).join(',');
  assert.notStrictEqual(a, b);
});

test('shuffle は要素を失わない・増やさない', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, seededRng(5));
  assert.deepStrictEqual(out.slice().sort(), src.slice().sort());
  assert.deepStrictEqual(src, [1, 2, 3, 4, 5], '元の配列を書き換えてはいけない');
});

test('実データでも掲載中の件数を超えない', () => {
  const schools = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'schools.json'), 'utf8'));
  const active = schools.filter(s => s.status === 'active');
  const picked = pickRecommended(schools);
  assert.ok(picked.length <= Math.min(10, active.length));
  assert.ok(picked.every(s => s.status === 'active'));
});

test('おすすめの選び方の説明が faq.html に書かれている', () => {
  // 「おすすめ」の基準を説明しないまま出すと、広告順だと誤解される。
  const faq = fs.readFileSync(path.join(__dirname, '..', '..', 'faq.html'), 'utf8');
  assert.match(faq, /おすすめ講座/, 'faq.html におすすめ枠の説明がない');
});
