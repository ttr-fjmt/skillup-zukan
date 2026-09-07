'use strict';

/**
 * ワークフロー定義の不変条件。
 *
 * 【背景】運用中に、パイプで終了コードが隠れて失敗が握りつぶされる事故が起きた
 * （`git push | tail -2` で push の失敗が tail の成功(0)に化け、古いコードのまま
 * ワークフローを実行してしまった）。この事故自体はリポジトリ外の対話コマンドで
 * 起きたものだが、ワークフロー側は既定シェルが "bash -e {0}" で pipefail が無効なため、
 * 同じ書き方をした瞬間に同じ穴が開く状態だった。
 *
 * ここでは「今後パイプを書いても失敗が握りつぶされない」ことを構成として固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');
const workflows = fs.readdirSync(WORKFLOW_DIR).filter(f => f.endsWith('.yml'));

test('ワークフローが1つ以上ある', () => {
  assert.ok(workflows.length >= 5, `見つかったワークフロー: ${workflows.length}件`);
});

for (const file of workflows) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');

  test(`${file}: 既定シェルに bash を指定している（pipefail を有効にするため）`, () => {
    // GitHub Actions の既定は "bash -e {0}" で pipefail が無い。
    // "shell: bash" と書くと "bash --noprofile --norc -eo pipefail {0}" になる。
    assert.match(
      source,
      /defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/,
      'defaults.run.shell: bash が無いため、パイプの左側の失敗が握りつぶされる'
    );
  });

  test(`${file}: git push の終了コードを握りつぶしていない`, () => {
    for (const line of source.split(/\r?\n/)) {
      if (!/git push/.test(line)) continue;
      // パイプに通すと終了コードがパイプ右側のものになる（pipefail が無ければ特に危険）。
      assert.ok(!/git push[^|]*\|[^|]/.test(line), `push をパイプに通している: ${line.trim()}`);
      // "|| true" 等で明示的に握りつぶしていないこと。
      assert.ok(!/\|\|\s*(true|:)/.test(line), `push の失敗を無視している: ${line.trim()}`);
    }
  });

  test(`${file}: エラーを無条件に握りつぶすパターンが無い`, () => {
    assert.ok(!/\|\|\s*true\b/.test(source), '|| true でコマンドの失敗を無視している');
    assert.ok(!/continue-on-error:\s*true/.test(source), 'continue-on-error: true が付いている');
  });
}
