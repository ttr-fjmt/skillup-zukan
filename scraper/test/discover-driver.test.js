'use strict';

/**
 * discover-schools.js の、AI呼び出しを伴わない部分の検証。
 * 特に「組み立てたレコードがそのままJSON Schemaを通ること」を固定しておく
 * （ここがズレると、発見・照合まで通った候補が最後の書き込みで丸ごと落ちる）。
 */

const test = require('node:test');
const assert = require('node:assert');

const { assembleDiscoveredSchool, targetGenres } = require('../discover-schools');
const { validateSchool } = require('../lib/validate');
const { GENRE } = require('../lib/schema');

const candidate = { name: 'サンプルスクール', website: 'https://sample-school.example.com/lp' };

const aiFields = {
  school_name: 'サンプルスクール',
  official_name: '架空株式会社サンプル',
  description: 'テスト用の概要文です。'.repeat(5),
  skill_genre: ['programming'],
  purpose: ['career_change'],
  target_level: 'beginner',
  career_paths: ['Webエンジニア'],
  price: { display: '298,000円', min_yen: 298000, scope: 'top_page', kind: 'total' },
  plans: [{ label: '標準コース', amount: 298000, duration: '3ヶ月', kind: 'total' }],
  format: 'online',
  area: [],
  subsidy_eligible: false,
  career_support: true,
  features: ['特徴1', '特徴2', '特徴3'],
};

test('assembleDiscoveredSchool: 組み立てたレコードがJSON Schemaを通る', () => {
  const entry = assembleDiscoveredSchool(candidate, aiFields, 'sample-school', 'https://sample-school.example.com/', 'programming');
  const { ok, errors } = validateSchool(entry);
  assert.strictEqual(ok, true, errors.join(' / '));
});

test('assembleDiscoveredSchool: 二段階検証を通ったレコードは検証完了時点で active（承認フェーズなし）', () => {
  const entry = assembleDiscoveredSchool(candidate, aiFields, 'sample-school', null, 'programming');
  assert.strictEqual(entry.status, 'active');
  assert.strictEqual(entry.source, 'ai-discovered');
});

test('assembleDiscoveredSchool: 口コミ要約は発見時点では必ず null（出典なしの要約を作らない）', () => {
  const entry = assembleDiscoveredSchool(candidate, aiFields, 'sample-school', null, 'programming');
  assert.strictEqual(entry.review_summary, null);
  assert.deepStrictEqual(entry.review_source_urls, []);
});

test('assembleDiscoveredSchool: URLは実在照合できた verifiedUrl を使う（AI提示値ではない）', () => {
  const entry = assembleDiscoveredSchool(candidate, aiFields, 'sample-school', 'https://sample-school.example.com/', 'programming');
  assert.strictEqual(entry.official_url, 'https://sample-school.example.com/');
  assert.strictEqual(entry.verified_url, 'https://sample-school.example.com/');
  // verifiedUrl が無い場合のみ候補のURLにフォールバックする。
  const fallback = assembleDiscoveredSchool(candidate, aiFields, 'sample-school', null, 'programming');
  assert.strictEqual(fallback.official_url, candidate.website);
});

test('assembleDiscoveredSchool: 提携前は cta_url = official_url かつ cta_type = direct', () => {
  const entry = assembleDiscoveredSchool(candidate, aiFields, 'sample-school', 'https://sample-school.example.com/', 'programming');
  assert.strictEqual(entry.cta_url, entry.official_url);
  assert.strictEqual(entry.cta_type, 'direct');
  assert.strictEqual(entry.click_tracking_id, 'click-sample-school');
});

test('assembleDiscoveredSchool: 通学レコードも組み立て可能でスキーマを通る', () => {
  const offline = { ...aiFields, format: 'both', area: ['東京都', '大阪府'] };
  const entry = assembleDiscoveredSchool(candidate, offline, 'sample-school', null, 'programming');
  const { ok, errors } = validateSchool(entry);
  assert.strictEqual(ok, true, errors.join(' / '));
  assert.deepStrictEqual(entry.area, ['東京都', '大阪府']);
});

test('targetGenres: 既定は programming の1ジャンルのみ（いきなり全ジャンルを回さない）', () => {
  const original = process.env.DISCOVER_GENRES;
  try {
    delete process.env.DISCOVER_GENRES;
    assert.deepStrictEqual(targetGenres(), ['programming']);

    process.env.DISCOVER_GENRES = 'all';
    assert.deepStrictEqual(targetGenres(), GENRE);

    process.env.DISCOVER_GENRES = 'webdesign, uiux';
    assert.deepStrictEqual(targetGenres(), ['webdesign', 'uiux']);

    process.env.DISCOVER_GENRES = 'webdesign,nonsense';
    assert.throws(() => targetGenres(), /未知のジャンル/);

    process.env.DISCOVER_GENRES = '  ';
    assert.throws(() => targetGenres(), /空です/);
  } finally {
    if (original === undefined) delete process.env.DISCOVER_GENRES;
    else process.env.DISCOVER_GENRES = original;
  }
});
