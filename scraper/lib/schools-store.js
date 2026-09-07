'use strict';

/**
 * data/schools.json（掲載データ本体）と data/school-discover-skip.json（スキップリスト）の
 * 読み書き。既存2サイトでは各エントリーポイントが readJson/writeJson を個別に持っていたが、
 * 本サイトは発見・再検証・口コミ要約の3つのパイプラインが同じファイルを触るため、
 * 読み書きと「書く前に必ずJSON Schemaで検証する」という約束を1箇所に集約する。
 */

const fs = require('fs');
const path = require('path');
const { validateSchools } = require('./validate');

const ROOT = path.join(__dirname, '..', '..');
const SCHOOLS_PATH = process.env.SCHOOLS_PATH || path.join(ROOT, 'data', 'schools.json');
const SKIP_PATH = process.env.SKIP_PATH || path.join(ROOT, 'data', 'school-discover-skip.json');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readSchools(filePath = SCHOOLS_PATH) {
  return readJson(filePath, []);
}

function readSkipList(filePath = SKIP_PATH) {
  return readJson(filePath, {});
}

function writeSkipList(skipList, filePath = SKIP_PATH) {
  writeJson(filePath, skipList);
}

/**
 * schools.json を書き出す。書く前に必ず全件をJSON Schemaで検証し、1件でも不正なら
 * 例外を投げて書き込みを行わない（壊れたレコードが本番データに混ざるくらいなら、
 * その実行を失敗させる方がよい。CIのログに全件分のエラーが出るので原因も追える）。
 */
function writeSchools(schools, filePath = SCHOOLS_PATH) {
  const { ok, invalid, duplicateIds } = validateSchools(schools);
  if (!ok) {
    for (const item of invalid) {
      console.error(`  [invalid] index=${item.index} id=${item.id}: ${item.errors.join(' / ')}`);
    }
    for (const dup of duplicateIds) {
      console.error(`  [duplicate id] ${dup.id} (index ${dup.indexes.join(', ')})`);
    }
    throw new Error(
      `schools.json のスキーマ検証に失敗しました（不正 ${invalid.length}件・id重複 ${duplicateIds.length}件）。書き込みを中止します。`
    );
  }
  writeJson(filePath, schools);
}

module.exports = {
  SCHOOLS_PATH,
  SKIP_PATH,
  readJson,
  writeJson,
  readSchools,
  readSkipList,
  writeSkipList,
  writeSchools,
};
