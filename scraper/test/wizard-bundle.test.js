'use strict';

/**
 * assets/wizard.js（ブラウザ用バンドル）の検証。
 *
 * 診断ロジックは scraper/lib/ が唯一のソースで、バンドルはそこから自動生成する。
 * サイトで動くコードとテスト済みのコードが食い違わないことを、ここで担保する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildBundle, OUT_PATH, EXPORTS } = require('../build-wizard-bundle');
const { matchSchools } = require('../lib/match');

/** バンドルを評価して、ブラウザと同じ window.SkillupZukan を得る。 */
function loadBundle(source) {
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('window', source)(sandbox);
  return sandbox.SkillupZukan;
}

test('バンドルが評価でき、公開APIがすべて揃っている', () => {
  const api = loadBundle(buildBundle());
  for (const key of EXPORTS) {
    assert.notStrictEqual(api[key], undefined, `${key} が公開されていない`);
  }
});

test('コミット済みの assets/wizard.js が、今のソースから生成したものと一致する', () => {
  // lib/ を直したのにバンドルを作り直し忘れると、サイトだけ古いロジックで動いてしまう。
  assert.ok(fs.existsSync(OUT_PATH), 'assets/wizard.js が存在しない。npm run build-wizard を実行すること');
  assert.strictEqual(
    fs.readFileSync(OUT_PATH, 'utf8'),
    buildBundle(),
    'assets/wizard.js が古い。scraper で npm run build-wizard を実行すること'
  );
});

test('バンドル経由の診断結果が、Node側の matchSchools と完全に一致する', () => {
  const api = loadBundle(buildBundle());
  const schools = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'schools.json'), 'utf8'));

  const patterns = [
    { purpose: 'career_change', genres: ['programming'], level: 'beginner', format: 'online', subsidy_preference: 'want_subsidy' },
    { purpose: 'hobby', genres: ['language'], level: 'novice', format: 'either', subsidy_preference: 'no_preference' },
    { purpose: 'certification_itself', genres: ['certification'], level: 'beginner', format: 'either', subsidy_preference: 'want_subsidy' },
    { purpose: 'side_job', genres: ['video_editing', 'webdesign'], level: 'beginner', format: 'online', subsidy_preference: 'no_preference' },
  ];

  for (const answers of patterns) {
    const fromBundle = api.matchSchools(answers, schools).map(s => [s.id, s.match_score]);
    const fromNode = matchSchools(answers, schools).map(s => [s.id, s.match_score]);
    assert.deepStrictEqual(fromBundle, fromNode, `結果が食い違う: ${JSON.stringify(answers)}`);
  }
});

test('バンドルは Node 依存（require/module）をブラウザに漏らさない', () => {
  const source = buildBundle();
  // モジュールを繋ぐシムは内部に閉じており、外に出すのは window.SkillupZukan だけ。
  assert.match(source, /global\.SkillupZukan = api;/);
  assert.ok(!/module\.exports\s*=\s*[^{]/.test(source.split('register(')[0]), 'シム部分に module.exports が漏れている');
});
