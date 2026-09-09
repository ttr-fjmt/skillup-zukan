'use strict';

/**
 * 収穫逓減スロットル（data/discovery-runs.json）の検証。
 *
 * この仕組みは「費用を下げるために実行を減らす」ものなので、減らしすぎる方向の事故が
 * 一番怖い。特に次の3点を固定する:
 *   - 伸びているジャンルの頻度は絶対に下げない
 *   - どれだけ0件が続いても、恒久的に止めない（7日ごとに必ず再挑戦する）
 *   - APIの一時的な失敗を「もう出てこない」と誤解しない
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ZERO_STREAK_THRESHOLD,
  COOLDOWN_DAYS,
  MAX_ROWS_PER_GENRE,
  appendRuns,
  pruneHistory,
  genreStatus,
  selectGenres,
  describeDeferred,
  recordRuns,
  readHistory,
  addDays,
} = require('../lib/genre-cooldown');

/** listed 件数の並びから履歴を組み立てる。日付は1日ずつ遡って振る。 */
function historyFor(genre, listedCounts, { lastDate = '2026-09-09', extra = {} } = {}) {
  return listedCounts.map((listed, i) => ({
    date: addDays(lastDate, i - (listedCounts.length - 1)),
    genre,
    found: listed,
    listed,
    skipped: 0,
    ...extra,
  }));
}

test('genreStatus: 末尾から連続している0件の回数を数える', () => {
  const history = historyFor('programming', [3, 2, 0, 0]);
  assert.deepStrictEqual(genreStatus(history, 'programming').zeroStreak, 2);

  // 途中に0があっても、後で1件でも出ていれば連続は切れている。
  assert.deepStrictEqual(genreStatus(historyFor('programming', [0, 0, 0, 1]), 'programming').zeroStreak, 0);
});

test('新規が出ているジャンルは毎日実行する（頻度を下げない）', () => {
  const history = historyFor('programming', [0, 0, 2]);
  const { run, deferred } = selectGenres(['programming'], { history, date: '2026-09-09' });

  assert.deepStrictEqual(run, ['programming']);
  assert.deepStrictEqual(deferred, []);
});

test(`${ZERO_STREAK_THRESHOLD}回続けて新規0件なら、その日は見送る`, () => {
  const history = historyFor('language', [1, 0, 0, 0], { lastDate: '2026-09-08' });
  const { run, deferred } = selectGenres(['language'], { history, date: '2026-09-09' });

  assert.deepStrictEqual(run, []);
  assert.strictEqual(deferred.length, 1);
  assert.strictEqual(deferred[0].genre, 'language');
  assert.strictEqual(deferred[0].zeroStreak, ZERO_STREAK_THRESHOLD);
  assert.strictEqual(deferred[0].nextEligibleDate, addDays('2026-09-08', COOLDOWN_DAYS));
});

test(`クールダウン中でも${COOLDOWN_DAYS}日経てば必ず再挑戦する（恒久的に止めない）`, () => {
  // 0件が20回続いていても、最後の実行から7日経っていれば実行する。
  const history = historyFor('language', new Array(20).fill(0), { lastDate: '2026-09-02' });

  const sixDaysLater = selectGenres(['language'], { history, date: '2026-09-08' });
  assert.deepStrictEqual(sixDaysLater.run, [], '6日目はまだ見送る');

  const sevenDaysLater = selectGenres(['language'], { history, date: '2026-09-09' });
  assert.deepStrictEqual(sevenDaysLater.run, ['language'], '7日目には必ず再挑戦する');
});

test('1件でも掲載できたらクールダウンは即座に解除される', () => {
  const history = [
    ...historyFor('language', [0, 0, 0], { lastDate: '2026-09-08' }),
    { date: '2026-09-09', genre: 'language', found: 1, listed: 1, skipped: 0 },
  ];

  const { run, deferred } = selectGenres(['language'], { history, date: '2026-09-10' });
  assert.deepStrictEqual(run, ['language']);
  assert.deepStrictEqual(deferred, []);
});

test('API失敗の回（error: true）は判定に使わない', () => {
  // 0件が2回 + 失敗が3回。失敗を0件として数えると閾値を超えてしまうが、超えてはいけない。
  const history = [
    ...historyFor('uiux', [0, 0], { lastDate: '2026-09-05' }),
    ...historyFor('uiux', [0, 0, 0], { lastDate: '2026-09-08', extra: { error: true } }),
  ];

  assert.strictEqual(genreStatus(history, 'uiux').zeroStreak, 2);
  assert.deepStrictEqual(selectGenres(['uiux'], { history, date: '2026-09-09' }).run, ['uiux']);
});

test('一度も実行していないジャンルは必ず実行する', () => {
  const { run } = selectGenres(['certification'], { history: [], date: '2026-09-09' });
  assert.deepStrictEqual(run, ['certification']);
});

test('渡されたジャンルの並び順を保つ（回転の意図を壊さない）', () => {
  const history = historyFor('language', [0, 0, 0], { lastDate: '2026-09-09' });
  const { run } = selectGenres(['webdesign', 'language', 'programming'], { history, date: '2026-09-09' });

  assert.deepStrictEqual(run, ['webdesign', 'programming']);
});

test('appendRuns: perGenre をそのまま履歴に足し、error だけ引き継ぐ', () => {
  const history = appendRuns(
    [
      { genre: 'programming', label: 'プログラミング', found: 4, listed: 2, skipped: 2 },
      { genre: 'language', label: '語学', found: 0, listed: 0, skipped: 0, error: true },
    ],
    { date: '2026-09-09', history: [] }
  );

  assert.deepStrictEqual(history, [
    { date: '2026-09-09', genre: 'programming', found: 4, listed: 2, skipped: 2 },
    { date: '2026-09-09', genre: 'language', found: 0, listed: 0, skipped: 0, error: true },
  ]);
});

test(`pruneHistory: 1ジャンルにつき直近${MAX_ROWS_PER_GENRE}件だけ残す`, () => {
  const many = historyFor('programming', new Array(MAX_ROWS_PER_GENRE + 5).fill(1));
  const pruned = pruneHistory(many);

  assert.strictEqual(pruned.length, MAX_ROWS_PER_GENRE);
  // 新しい方を残す（古い方から捨てる）。
  assert.strictEqual(pruned[pruned.length - 1].date, many[many.length - 1].date);
});

test('describeDeferred: 運営者が読んで分かる説明になっている', () => {
  const history = historyFor('language', [0, 0, 0], { lastDate: '2026-09-08' });
  const { deferred } = selectGenres(['language'], { history, date: '2026-09-09' });
  const [line] = describeDeferred(deferred);

  assert.match(line, /新規0件/);
  assert.match(line, /再挑戦/);
  assert.match(line, /2026-09-15/);
});

test('recordRuns: ファイルに書き出し、読み戻せる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-runs-'));
  const historyPath = path.join(dir, 'discovery-runs.json');
  try {
    recordRuns([{ genre: 'programming', found: 1, listed: 1, skipped: 0 }], {
      date: '2026-09-09',
      historyPath,
    });
    recordRuns([{ genre: 'programming', found: 0, listed: 0, skipped: 0 }], {
      date: '2026-09-10',
      historyPath,
    });

    const history = readHistory(historyPath);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(genreStatus(history, 'programming').zeroStreak, 1);
    assert.strictEqual(genreStatus(history, 'programming').lastRunDate, '2026-09-10');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recordRuns: 履歴が壊れていても発見処理を止めない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-runs-'));
  const historyPath = path.join(dir, 'discovery-runs.json');
  try {
    fs.writeFileSync(historyPath, '{ this is not json', 'utf8');

    // 例外を投げず、全ジャンルを実行する側に倒れること。
    assert.deepStrictEqual(readHistory(historyPath), []);
    assert.doesNotThrow(() =>
      recordRuns([{ genre: 'programming', found: 1, listed: 1, skipped: 0 }], { date: '2026-09-09', historyPath })
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
