'use strict';

/**
 * 料金の後追い補完（enrich-prices.js）が選ぶ対象のガード。
 *
 * 2026-10-02、料金が「要問い合わせ」のまま止まっている160件を埋めようとしたところ、
 * 5件試して0件しか取れなかった。原因は、そのうち108件がすでに料金ページを巡回して
 * 失敗済みのレコードで、同じコードで同じページを読み直していたこと。
 * 既定では巡回済みを選ばないこと、ENRICH_FORCE=1 のときだけ選び直すことを固定する。
 */

const test = require('node:test');
const assert = require('node:assert');

const { alreadyCrawled, selectTargets } = require('../enrich-prices');

function school(over) {
  return Object.assign(
    { id: 'x', status: 'active', price: null, plans: [], review_flags: [] },
    over || {}
  );
}

const withEnv = (env, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('料金ページを巡回済みのレコードは、巡回済みと判定する', () => {
  assert.strictEqual(alreadyCrawled(school({ review_flags: ['detail_page_crawled'] })), true);
  assert.strictEqual(alreadyCrawled(school({ review_flags: ['area_unconfirmed'] })), false);
  assert.strictEqual(alreadyCrawled(school({ review_flags: undefined })), false);
});

test('既定では、巡回して失敗済みのレコードを選び直さない', () => {
  const list = [
    school({ id: 'crawled', review_flags: ['detail_page_crawled'] }),
    school({ id: 'fresh' }),
  ];
  const ids = withEnv({ ENRICH_FORCE: undefined, ENRICH_ONLY_SCHOOL_ID: undefined }, () =>
    selectTargets(list).map(s => s.id)
  );
  assert.deepStrictEqual(ids, ['fresh']);
});

test('ENRICH_FORCE=1 のときは、巡回済みのレコードも選び直す', () => {
  const list = [
    school({ id: 'crawled', review_flags: ['detail_page_crawled'] }),
    school({ id: 'fresh' }),
  ];
  const ids = withEnv({ ENRICH_FORCE: '1', ENRICH_ONLY_SCHOOL_ID: undefined }, () =>
    selectTargets(list).map(s => s.id)
  );
  assert.deepStrictEqual(ids, ['crawled', 'fresh']);
});

test('1校だけ指定したときは、巡回済みでもその1校を選ぶ', () => {
  const list = [school({ id: 'crawled', review_flags: ['detail_page_crawled'] }), school({ id: 'fresh' })];
  const ids = withEnv({ ENRICH_FORCE: undefined, ENRICH_ONLY_SCHOOL_ID: 'crawled' }, () =>
    selectTargets(list).map(s => s.id)
  );
  assert.deepStrictEqual(ids, ['crawled']);
});

test('掲載をやめたレコードは選ばない', () => {
  const ids = withEnv({ ENRICH_FORCE: undefined, ENRICH_ONLY_SCHOOL_ID: undefined }, () =>
    selectTargets([school({ id: 'gone', status: 'skipped' })]).map(s => s.id)
  );
  assert.deepStrictEqual(ids, []);
});
