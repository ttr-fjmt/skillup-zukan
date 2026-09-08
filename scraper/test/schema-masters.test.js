'use strict';

/**
 * lib/schema.js のマスタと schema/school.schema.json のenumがズレていないことを検証する。
 *
 * 既存2サイトで「掲載用のカテゴリー一覧」と「検索用のカテゴリー一覧」が別々に定義されて
 * いてズレる問題が実際に起きたため、本サイトでは同種のズレをテストで落とす。
 * ズレたまま動くと、そのジャンルだけ静かに収集されない・診断に出ない、という気づきにくい
 * 壊れ方をする。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const {
  GENRE,
  PURPOSE,
  LEVEL,
  FORMAT,
  STATUS,
  CTA_TYPE,
  PREFECTURES,
  GENRE_LABELS,
  PURPOSE_LABELS,
  LEVEL_LABELS,
  GENRE_PURPOSE_ORDER,
} = require('../lib/schema');
const { SCHEMA_PATH } = require('../lib/validate');
const { DISCOVERY_QUERIES, QUERY_WINDOW, rotateQueries } = require('../lib/discovery-queries');

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

test('JSON Schema の skill_genre enum が GENRE と一致する', () => {
  assert.deepStrictEqual(schema.properties.skill_genre.items.enum, GENRE);
});

test('JSON Schema の purpose enum が PURPOSE と一致する', () => {
  assert.deepStrictEqual(schema.properties.purpose.items.enum, PURPOSE);
});

test('JSON Schema の target_level / format / status / cta_type enum がマスタと一致する', () => {
  assert.deepStrictEqual(schema.properties.target_level.enum, LEVEL);
  assert.deepStrictEqual(schema.properties.format.enum, FORMAT);
  assert.deepStrictEqual(schema.properties.status.enum, STATUS);
  assert.deepStrictEqual(schema.properties.cta_type.enum, CTA_TYPE);
});

test('status は active / skipped の2値のみ（承認フェーズは廃止済み）', () => {
  assert.deepStrictEqual(STATUS, ['active', 'skipped']);
  assert.ok(!STATUS.includes('pending_review'));
});

test('JSON Schema の area enum が PREFECTURES と一致する（47件）', () => {
  assert.deepStrictEqual(schema.properties.area.items.enum, PREFECTURES);
  assert.strictEqual(PREFECTURES.length, 47);
});

test('すべての GENRE に日本語ラベルがある', () => {
  for (const genre of GENRE) {
    assert.ok(GENRE_LABELS[genre], `${genre} のラベルが未定義`);
  }
  assert.strictEqual(Object.keys(GENRE_LABELS).length, GENRE.length);
});

test('すべての PURPOSE / LEVEL に日本語ラベルがある', () => {
  for (const purpose of PURPOSE) assert.ok(PURPOSE_LABELS[purpose], `${purpose} のラベルが未定義`);
  for (const level of LEVEL) assert.ok(LEVEL_LABELS[level], `${level} のラベルが未定義`);
});

test('GENRE_PURPOSE_ORDER が全ジャンル分あり、各行が PURPOSE の全要素をちょうど1回ずつ含む', () => {
  assert.deepStrictEqual(Object.keys(GENRE_PURPOSE_ORDER).sort(), [...GENRE].sort());
  for (const genre of GENRE) {
    const order = GENRE_PURPOSE_ORDER[genre];
    assert.strictEqual(order.length, PURPOSE.length, `${genre} の要素数が PURPOSE と違う`);
    assert.deepStrictEqual([...order].sort(), [...PURPOSE].sort(), `${genre} の要素が PURPOSE と違う`);
  }
});

test('発見クエリが全ジャンル分あり、各3件以上ある', () => {
  assert.deepStrictEqual(Object.keys(DISCOVERY_QUERIES).sort(), [...GENRE].sort());
  for (const genre of GENRE) {
    assert.ok(
      DISCOVERY_QUERIES[genre].length >= QUERY_WINDOW,
      `${genre} のクエリが${QUERY_WINDOW}件未満（現在 ${DISCOVERY_QUERIES[genre].length}件）`
    );
    // 同じ切り口が重複していると、その分だけ検索の幅が狭くなる。
    assert.strictEqual(
      new Set(DISCOVERY_QUERIES[genre]).size,
      DISCOVERY_QUERIES[genre].length,
      `${genre} のクエリに重複がある`
    );
  }
});

test('検索の切り口は日付でずれ、日をまたいで全部が使われる', () => {
  // 1回の呼び出しで実際に検索できる回数には上限があるため、切り口を増やしただけでは
  // 上のほうしか使われない。日付でずらして一巡することをここで固定する。
  const list = Array.from({ length: 26 }, (_, i) => 'q' + i);
  const day0 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

  const first = rotateQueries(list, day0);
  assert.strictEqual(first.length, QUERY_WINDOW);
  assert.strictEqual(new Set(first).size, QUERY_WINDOW, '同じ日の窓に重複がある');

  const second = rotateQueries(list, new Date(day0.getTime() + 86400000));
  assert.notDeepStrictEqual(first, second, '日が変わっても切り口が同じ');

  // 何日か回せば、すべての切り口が少なくとも1回は使われる。
  const seen = new Set();
  for (let d = 0; d < 60; d += 1) {
    for (const q of rotateQueries(list, new Date(day0.getTime() + d * 86400000))) seen.add(q);
  }
  assert.strictEqual(seen.size, list.length, '一巡しても使われない切り口がある');
});

test('クエリが窓の数より少ないときは、そのまま全部返す', () => {
  const few = ['a', 'b', 'c'];
  assert.deepStrictEqual(rotateQueries(few), few);
});
