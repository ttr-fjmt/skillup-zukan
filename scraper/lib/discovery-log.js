'use strict';

/**
 * 日次ディスカバリーの実行記録（data/discovery-log/YYYY-MM-DD.json）。
 *
 * 承認フェーズを設けない（二段階検証を通った時点で active として保存する）代わりに、
 * 「その日に何が新しく掲載されたか」だけは後から追えるようにしておくための記録。
 * 承認UI・通知は持たない。あとで「この日から表示が変わったのはなぜか」を追う、
 * あるいは特定の実行で入った分だけをまとめて見直す、といった用途を想定している。
 *
 * 中身はジャンルごとに1エントリの配列:
 *   [{ "date": "2026-09-07", "genre": "programming", "new_school_ids": ["example", ...] }, ...]
 *
 * 同じ日に複数回実行された場合は、既存ファイルを読んで同じジャンルの行に
 * 追記する（実行のたびに前回分を消さない。id は重複させない）。
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.DISCOVERY_LOG_DIR || path.join(__dirname, '..', '..', 'data', 'discovery-log');

/** UTCではなく日本時間の日付でファイルを分ける（運用者が見る「その日」と一致させるため）。 */
function jstDateString(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function logPathFor(date, logDir = LOG_DIR) {
  return path.join(logDir, `${date}.json`);
}

/**
 * 新規 active 化されたレコードのIDを、ジャンル別にまとめた配列に変換する。
 * entries: [{ id, genre }, ...]（掲載順のまま渡してよい）
 */
function buildLogEntries(entries, date) {
  const byGenre = new Map();
  for (const { id, genre } of entries) {
    if (!byGenre.has(genre)) byGenre.set(genre, []);
    byGenre.get(genre).push(id);
  }
  return [...byGenre].map(([genre, ids]) => ({ date, genre, new_school_ids: ids }));
}

/**
 * 既存のログ（同日・複数回実行）に新しい分をマージする。
 * 同じ (date, genre) の行があれば new_school_ids を追記し、無ければ行を足す。
 */
function mergeLogEntries(existing, incoming) {
  const merged = existing.map(row => ({ ...row, new_school_ids: [...row.new_school_ids] }));

  for (const row of incoming) {
    const target = merged.find(r => r.date === row.date && r.genre === row.genre);
    if (target) {
      for (const id of row.new_school_ids) {
        if (!target.new_school_ids.includes(id)) target.new_school_ids.push(id);
      }
    } else {
      merged.push({ ...row, new_school_ids: [...row.new_school_ids] });
    }
  }

  return merged;
}

/**
 * 実行結果を書き出す。新規が0件のときはファイルを作らない
 * （何も起きなかった日の空ファイルが毎日コミットされるのを避けるため）。
 * 戻り値: 書き出したファイルパス、または null。
 */
function writeDiscoveryLog(entries, { date = jstDateString(), logDir = LOG_DIR } = {}) {
  if (!entries || entries.length === 0) return null;

  const filePath = logPathFor(date, logDir);
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
  const merged = mergeLogEntries(Array.isArray(existing) ? existing : [], buildLogEntries(entries, date));

  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return filePath;
}

module.exports = { LOG_DIR, jstDateString, logPathFor, buildLogEntries, mergeLogEntries, writeDiscoveryLog };
