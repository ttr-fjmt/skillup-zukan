'use strict';

/**
 * 診断ウィザードとマスタを、ブラウザから使える1ファイルにまとめて assets/wizard.js を作る。
 *
 * 【なぜコピペしないのか】
 * agent-zukan / freelance-anken-zukan は index.html にロジックを直接書いているが、
 * このサイトの診断ロジック（配点・タイブレーク・マッチ理由）は lib/match.js にあり、
 * ユニットテストで固定されている。HTMLに書き写すと、テストが通っているコードと
 * 実際にサイトで動くコードが別物になり、片方だけ直して食い違う事故が起きる。
 *
 * そこで Node 用の CommonJS モジュールをそのまま連結し、ごく小さな require シムで
 * つないでブラウザ用のグローバル（window.SkillupZukan）にする。ソースは1つのままで、
 * サイトで動くのはテスト済みのコードそのものになる。
 *
 * 実行: node build-wizard-bundle.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'assets', 'wizard.js');

/** 束ねる対象。依存の順に並べる（後のものが前のものを require する）。 */
const MODULES = ['lib/schema.js', 'lib/match.js', 'lib/wizard-questions.js'];

/** 公開するAPI。index.html からはこれだけを使う。 */
const EXPORTS = [
  'GENRE', 'PURPOSE', 'LEVEL', 'FORMAT', 'PREFECTURES',
  'GENRE_LABELS', 'PURPOSE_LABELS', 'LEVEL_LABELS', 'FORMAT_LABELS',
  'GENRE_PURPOSE_ORDER', 'genreOrderForPurpose', 'purposeOrderForGenres',
  'matchSchools', 'scoreSchool', 'filterCandidates', 'MAX_RESULTS',
  'buildQuestions', 'validateAnswers', 'MAX_GENRES',
];

function buildBundle() {
  const parts = MODULES.map(rel => {
    const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    // モジュール名は require('./schema') のような相対指定に合わせる。
    const name = './' + path.basename(rel, '.js');
    return `  register(${JSON.stringify(name)}, function (module, exports, require) {\n${source}\n  });`;
  });

  return `/* 自動生成ファイル — 直接編集しないこと。
 * scraper/build-wizard-bundle.js が scraper/lib/ のソースから生成する。
 * 変更したいときは scraper/lib/ 側を直し、node build-wizard-bundle.js を実行する。
 */
(function (global) {
  'use strict';

  var registry = {};
  var cache = {};

  function register(name, factory) {
    registry[name] = factory;
  }

  function require(name) {
    if (cache[name]) return cache[name].exports;
    var factory = registry[name];
    if (!factory) throw new Error('未登録のモジュール: ' + name);
    var module = { exports: {} };
    cache[name] = module;
    factory(module, module.exports, require);
    return module.exports;
  }

${parts.join('\n\n')}

  var api = {};
  var sources = [require('./schema'), require('./match'), require('./wizard-questions')];
  ${JSON.stringify(EXPORTS)}.forEach(function (key) {
    for (var i = 0; i < sources.length; i += 1) {
      if (sources[i][key] !== undefined) { api[key] = sources[i][key]; return; }
    }
    throw new Error('公開対象が見つかりません: ' + key);
  });

  global.SkillupZukan = api;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

function main() {
  const bundle = buildBundle();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, bundle, 'utf8');

  // 生成物がそのまま動くかを、この場で読み込んで確認する（壊れたまま公開しないため）。
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('window', bundle)(sandbox);
  const api = sandbox.SkillupZukan;
  for (const key of EXPORTS) {
    if (api[key] === undefined) throw new Error(`生成した bundle に ${key} が含まれていません`);
  }

  console.log(`Wrote assets/wizard.js (${(bundle.length / 1024).toFixed(1)} KB)`);
  console.log(`  公開API: ${EXPORTS.length}件 / 束ねたモジュール: ${MODULES.join(', ')}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildBundle, OUT_PATH, EXPORTS, MODULES };
