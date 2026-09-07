'use strict';

/**
 * 日次の実行記録（data/discovery-log/YYYY-MM-DD.json）の検証。
 *
 * 承認フェーズを廃止した代わりの唯一の記録なので、「同じ日に2回実行したら前回分が
 * 消える」といった取りこぼしが起きないことを固定しておく。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildLogEntries, mergeLogEntries, writeDiscoveryLog, jstDateString, logPathFor } = require('../lib/discovery-log');

/** テストごとに使い捨てのログディレクトリを作る。 */
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-log-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('buildLogEntries: ジャンルごとに1エントリへまとめる', () => {
  const entries = buildLogEntries(
    [
      { id: 'a', genre: 'programming' },
      { id: 'b', genre: 'webdesign' },
      { id: 'c', genre: 'programming' },
    ],
    '2026-09-07'
  );

  assert.deepStrictEqual(entries, [
    { date: '2026-09-07', genre: 'programming', new_school_ids: ['a', 'c'] },
    { date: '2026-09-07', genre: 'webdesign', new_school_ids: ['b'] },
  ]);
});

test('mergeLogEntries: 同じ日・同じジャンルの行には追記する（前回分を消さない）', () => {
  const existing = [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['a'] }];
  const incoming = [
    { date: '2026-09-07', genre: 'programming', new_school_ids: ['b'] },
    { date: '2026-09-07', genre: 'uiux', new_school_ids: ['c'] },
  ];

  assert.deepStrictEqual(mergeLogEntries(existing, incoming), [
    { date: '2026-09-07', genre: 'programming', new_school_ids: ['a', 'b'] },
    { date: '2026-09-07', genre: 'uiux', new_school_ids: ['c'] },
  ]);
});

test('mergeLogEntries: 同じIDは重複させない', () => {
  const existing = [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['a', 'b'] }];
  const incoming = [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['b', 'c'] }];
  assert.deepStrictEqual(mergeLogEntries(existing, incoming)[0].new_school_ids, ['a', 'b', 'c']);
});

test('mergeLogEntries: 既存の配列を変更しない', () => {
  const existing = [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['a'] }];
  mergeLogEntries(existing, [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['b'] }]);
  assert.deepStrictEqual(existing, [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['a'] }]);
});

test('writeDiscoveryLog: YYYY-MM-DD.json に書き出す', () => {
  withTempDir(dir => {
    const written = writeDiscoveryLog([{ id: 'example', genre: 'programming' }], { date: '2026-09-07', logDir: dir });
    assert.strictEqual(written, logPathFor('2026-09-07', dir));

    const content = JSON.parse(fs.readFileSync(written, 'utf8'));
    assert.deepStrictEqual(content, [{ date: '2026-09-07', genre: 'programming', new_school_ids: ['example'] }]);
  });
});

test('writeDiscoveryLog: 同じ日に2回実行しても1回目の分が残る', () => {
  withTempDir(dir => {
    writeDiscoveryLog([{ id: 'first', genre: 'programming' }], { date: '2026-09-07', logDir: dir });
    const written = writeDiscoveryLog([{ id: 'second', genre: 'webdesign' }], { date: '2026-09-07', logDir: dir });

    assert.deepStrictEqual(JSON.parse(fs.readFileSync(written, 'utf8')), [
      { date: '2026-09-07', genre: 'programming', new_school_ids: ['first'] },
      { date: '2026-09-07', genre: 'webdesign', new_school_ids: ['second'] },
    ]);
  });
});

test('writeDiscoveryLog: 新規が0件ならファイルを作らない（空ファイルを毎日コミットしない）', () => {
  withTempDir(dir => {
    assert.strictEqual(writeDiscoveryLog([], { date: '2026-09-07', logDir: dir }), null);
    assert.strictEqual(fs.existsSync(logPathFor('2026-09-07', dir)), false);
  });
});

test('jstDateString: UTCではなく日本時間の日付になる', () => {
  // 2026-09-07T16:00:00Z は JST では翌日の 01:00。
  assert.strictEqual(jstDateString(new Date('2026-09-07T16:00:00.000Z')), '2026-09-08');
  assert.strictEqual(jstDateString(new Date('2026-09-07T14:59:00.000Z')), '2026-09-07');
});
