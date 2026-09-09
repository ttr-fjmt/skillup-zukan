'use strict';

/**
 * ジャンル別の「収穫逓減」スロットル（data/discovery-runs.json）。
 *
 * 【何のための仕組みか】
 * 日次ディスカバリーは、1ジャンルにつき Sonnet + web_search を1回呼ぶ。掲載件数が
 * 伸びているうちは1件あたりの費用が安く、毎日回す価値がある。しかし日本のスクールの
 * 母集団は有限なので、いずれジャンルごとに「もう新しいものが出てこない」状態になる。
 * そこから先は、同じ費用を払って新規0件を毎日確認するだけになる。
 *
 * そこで、直近の実績（新規掲載が何件出たか）を見て、出なくなったジャンルだけ自動的に
 * 週1回まで落とす。伸びているジャンルの頻度は一切下げない。
 *
 * 【絶対に止めない】
 * どれだけ0件が続いても、7日に1回は必ず再挑戦する（恒久的に無効化しない）。
 * 新しいスクールは後から生まれるため、「二度と見に行かない」は誤りになる。
 * 1件でも掲載できた時点で連続0件はリセットされ、翌日から毎日に戻る。
 *
 * 中身は実行1回・1ジャンルで1行:
 *   [{ "date": "2026-09-09", "genre": "programming", "found": 5, "listed": 2, "skipped": 3 }, ...]
 *
 * listed は「実在照合を通った件数」（discoverCandidates の perGenre と同じ意味）で、
 * 最終的に schools.json に入った件数ではない。照合まで通ったなら、そのジャンルには
 * まだ新しい母集団が残っている、と判断してよい。スキーマ検証で落ちた1件を理由に
 * クールダウンへ入れてしまうのは誤りなので、意図的にこちらを使っている。
 * 検索呼び出し自体が失敗した回は "error": true を立てて記録し、判定には使わない
 * （APIの一時的な失敗を「もう出てこない」と誤解しないため）。
 */

const fs = require('fs');
const path = require('path');

const { GENRE_LABELS } = require('./schema');

const HISTORY_PATH =
  process.env.DISCOVERY_RUNS_PATH || path.join(__dirname, '..', '..', 'data', 'discovery-runs.json');

/** 何回続けて新規0件だったらクールダウンに入れるか。 */
const ZERO_STREAK_THRESHOLD = 3;

/** クールダウン中のジャンルを再挑戦させる間隔（日）。 */
const COOLDOWN_DAYS = 7;

/** 1ジャンルあたり何回分の履歴を残すか（ファイルを無制限に太らせないため）。 */
const MAX_ROWS_PER_GENRE = 20;

/** UTCではなく日本時間の日付で数える（discovery-log / usage-log と揃える）。 */
function jstDateString(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function parseDate(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(fromDate, toDate) {
  return Math.round((parseDate(toDate) - parseDate(fromDate)) / 86400000);
}

function addDays(dateString, days) {
  return new Date(parseDate(dateString) + days * 86400000).toISOString().slice(0, 10);
}

function readHistory(historyPath = HISTORY_PATH) {
  if (!fs.existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // 履歴が壊れていても発見処理は止めない。全ジャンルを実行する側に倒す。
    console.warn(`genre-cooldown: 履歴を読めませんでした（全ジャンルを対象にします）: ${err.message}`);
    return [];
  }
}

/** 1ジャンルあたり直近 MAX_ROWS_PER_GENRE 件だけ残す。並び順（古い→新しい）は保つ。 */
function pruneHistory(history) {
  const countByGenre = new Map();
  const keep = [];

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    const count = countByGenre.get(row.genre) || 0;
    if (count >= MAX_ROWS_PER_GENRE) continue;
    countByGenre.set(row.genre, count + 1);
    keep.push(row);
  }

  return keep.reverse();
}

/**
 * discoverCandidates() の perGenre をそのまま履歴に足す。
 * 上限件数で打ち切られて実行されなかったジャンルは perGenre に入らないので、
 * 「実行していないのに0件」と記録されることはない。
 */
function appendRuns(perGenre, { date = jstDateString(), history = readHistory() } = {}) {
  const rows = (perGenre || []).map(g => ({
    date,
    genre: g.genre,
    found: g.found || 0,
    listed: g.listed || 0,
    skipped: g.skipped || 0,
    ...(g.error ? { error: true } : {}),
  }));

  return pruneHistory([...history, ...rows]);
}

function writeHistory(history, { historyPath = HISTORY_PATH } = {}) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n', 'utf8');
  return historyPath;
}

/** perGenre を履歴に記録して書き出す。記録の失敗で発見処理を落とさない。 */
function recordRuns(perGenre, { date = jstDateString(), historyPath = HISTORY_PATH } = {}) {
  if (!perGenre || perGenre.length === 0) return null;
  try {
    const history = appendRuns(perGenre, { date, history: readHistory(historyPath) });
    return writeHistory(history, { historyPath });
  } catch (err) {
    console.warn(`genre-cooldown: 実行履歴の記録に失敗しました（処理は継続します）: ${err.message}`);
    return null;
  }
}

/**
 * あるジャンルの、末尾から数えた連続0件回数と、最後に実行した日付。
 * error: true の回は「実行しなかった」ものとして無視する。
 */
function genreStatus(history, genre) {
  const rows = (history || []).filter(r => r.genre === genre && !r.error);
  let zeroStreak = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if ((rows[i].listed || 0) > 0) break;
    zeroStreak += 1;
  }
  return {
    zeroStreak,
    lastRunDate: rows.length > 0 ? rows[rows.length - 1].date : null,
    runCount: rows.length,
  };
}

/**
 * 今日実行するジャンルを選ぶ。
 *
 * 戻り値:
 *   run:      今日実行するジャンル（渡された並び順を保つ）
 *   deferred: 今日は見送るジャンルと、その理由・次に実行する日
 */
function selectGenres(genres, { history = readHistory(), date = jstDateString() } = {}) {
  const run = [];
  const deferred = [];

  for (const genre of genres) {
    const { zeroStreak, lastRunDate } = genreStatus(history, genre);

    if (zeroStreak < ZERO_STREAK_THRESHOLD || !lastRunDate) {
      run.push(genre);
      continue;
    }

    const elapsed = daysBetween(lastRunDate, date);
    if (elapsed >= COOLDOWN_DAYS) {
      run.push(genre);
      continue;
    }

    deferred.push({
      genre,
      label: GENRE_LABELS[genre] || genre,
      zeroStreak,
      lastRunDate,
      nextEligibleDate: addDays(lastRunDate, COOLDOWN_DAYS),
    });
  }

  return { run, deferred };
}

/** 見送ったジャンルを、運営者が読んで分かる1行にする。 */
function describeDeferred(deferred) {
  return deferred.map(
    d =>
      `${d.label}: 直近${d.zeroStreak}回続けて新規0件のため今日は見送り（次は${d.nextEligibleDate}に再挑戦）`
  );
}

module.exports = {
  HISTORY_PATH,
  ZERO_STREAK_THRESHOLD,
  COOLDOWN_DAYS,
  MAX_ROWS_PER_GENRE,
  jstDateString,
  daysBetween,
  addDays,
  readHistory,
  pruneHistory,
  appendRuns,
  writeHistory,
  recordRuns,
  genreStatus,
  selectGenres,
  describeDeferred,
};
