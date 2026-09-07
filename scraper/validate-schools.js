'use strict';

/**
 * data/schools.json（既定）を JSON Schema で検証するCLI。
 * 手動でレコードを編集したあと、コミット前に流すためのもの。
 *
 * 実行例:
 *   node validate-schools.js
 *   node validate-schools.js ../data/mock/schools.mock.json
 */

const fs = require('fs');
const path = require('path');

const { validateSchools } = require('./lib/validate');
const { SCHOOLS_PATH } = require('./lib/schools-store');

function main() {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : SCHOOLS_PATH;

  if (!fs.existsSync(target)) {
    console.error(`ファイルが見つかりません: ${target}`);
    process.exit(1);
  }

  const schools = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!Array.isArray(schools)) {
    console.error(`${target} の中身が配列ではありません。`);
    process.exit(1);
  }

  const { ok, invalid, duplicateIds } = validateSchools(schools);

  for (const item of invalid) {
    console.error(`[invalid] index=${item.index} id=${item.id}`);
    for (const error of item.errors) console.error(`    ${error}`);
  }
  for (const dup of duplicateIds) {
    console.error(`[duplicate id] ${dup.id} (index ${dup.indexes.join(', ')})`);
  }

  const byStatus = schools.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {});
  console.log(
    `${path.basename(target)}: ${schools.length}件 ` +
      `(${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'なし'})`
  );

  if (!ok) {
    console.error(`検証に失敗しました: 不正 ${invalid.length}件・id重複 ${duplicateIds.length}件`);
    process.exit(1);
  }
  console.log('検証に成功しました。');
}

if (require.main === module) {
  main();
}
