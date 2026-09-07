'use strict';

/**
 * ANTHROPIC_API_KEY 未設定時に、discover-schools.js が「静かな成功」ではなく
 * 非ゼロ終了で落ちることの検証。
 *
 * 【なぜこのテストが必要か】
 * discoverCandidates() はジャンル単位で例外を握りつぶす設計になっている（1ジャンルの
 * 一時的な失敗で実行全体を落とさないため）。この事前チェックが無いと、APIキー未設定でも
 * 同じ経路を通って found=0, listed=0 の正常終了になり、GitHub Actions 上ではグリーンの
 * まま毎日何も収集されない、という気づきにくい壊れ方をする。
 *
 * 終了コードは実際に子プロセスを起動して確認する（process.exit を伴う挙動なので、
 * 同一プロセス内の関数呼び出しだけでは「本当に1で終わるか」を確かめられないため）。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const { assertApiKeyConfigured, main } = require('../discover-schools');

const SCRIPT = path.join(__dirname, '..', 'discover-schools.js');

/** ANTHROPIC_API_KEY を確実に取り除いた env を作る（実行環境に設定されていても影響させない）。 */
function envWithoutApiKey(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

/** テスト中だけ ANTHROPIC_API_KEY を差し替え、必ず元に戻す。 */
function withApiKey(value, fn) {
  const original = process.env.ANTHROPIC_API_KEY;
  if (value === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
}

test('assertApiKeyConfigured: 未設定なら例外を投げる', () => {
  withApiKey(undefined, () => {
    assert.throws(() => assertApiKeyConfigured(), /ANTHROPIC_API_KEY is not set/);
  });
});

test('assertApiKeyConfigured: 設定されていれば何も起きない', () => {
  withApiKey('sk-ant-dummy-value-for-test', () => {
    assert.doesNotThrow(() => assertApiKeyConfigured());
  });
});

test('assertApiKeyConfigured: 空文字も未設定として扱う', () => {
  withApiKey('', () => {
    assert.throws(() => assertApiKeyConfigured(), /ANTHROPIC_API_KEY is not set/);
  });
});

test('main(): APIキー未設定なら、ファイルを読む前・検索呼び出しの前に reject する', async () => {
  await withApiKey(undefined, async () => {
    await assert.rejects(main(), /Aborting before any per-genre search calls/);
  });
});

test('CLI実行: APIキー未設定なら exit code 1 で終了する（静かな成功にならない）', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: envWithoutApiKey({ DISCOVER_GENRES: 'programming' }),
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 1, `exit code が1ではありません (stdout: ${result.stdout})`);
});

test('CLI実行: APIキー未設定時のメッセージが標準エラー出力に出る', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: envWithoutApiKey({ DISCOVER_GENRES: 'programming' }),
    encoding: 'utf8',
  });

  assert.match(result.stderr, /ANTHROPIC_API_KEY is not set\. Aborting before any per-genre search calls\./);
  // GitHub Actions でエラー注釈として表示させるための前置き。
  assert.match(result.stderr, /::error::/);
  // 事前チェックのメッセージにスタックトレースを重ねない。
  assert.ok(!result.stderr.includes('at assertApiKeyConfigured'), result.stderr);
});

test('CLI実行: APIキー未設定時は「found=0, listed=0 の正常終了」を出力しない', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: envWithoutApiKey({ DISCOVER_GENRES: 'programming' }),
    encoding: 'utf8',
  });

  // かつてはジャンル単位のcatchに握りつぶされ、この行を出して exit 0 していた。
  assert.ok(!result.stdout.includes('Discovery finished'), result.stdout);
  assert.ok(!result.stdout.includes('Genre breakdown'), result.stdout);
});

test('CLI実行: APIキー未設定時は data/ に一切書き込まない', () => {
  const tmpSchools = path.join(__dirname, 'tmp-preflight-schools.json');
  const tmpSkip = path.join(__dirname, 'tmp-preflight-skip.json');
  const tmpLog = path.join(__dirname, 'tmp-preflight-log');
  const fs = require('fs');

  const result = spawnSync(process.execPath, [SCRIPT], {
    env: envWithoutApiKey({
      DISCOVER_GENRES: 'programming',
      SCHOOLS_PATH: tmpSchools,
      SKIP_PATH: tmpSkip,
      DISCOVERY_LOG_DIR: tmpLog,
    }),
    encoding: 'utf8',
  });

  try {
    assert.strictEqual(result.status, 1);
    assert.strictEqual(fs.existsSync(tmpSchools), false, 'schools.json が作られている');
    assert.strictEqual(fs.existsSync(tmpSkip), false, 'skip list が作られている');
    assert.strictEqual(fs.existsSync(tmpLog), false, 'discovery-log が作られている');
  } finally {
    for (const p of [tmpSchools, tmpSkip]) if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(tmpLog)) fs.rmSync(tmpLog, { recursive: true, force: true });
  }
});
