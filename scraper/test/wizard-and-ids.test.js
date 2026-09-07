'use strict';

/**
 * 診断ウィザードの質問組み立て・回答検証と、id採番・スキップリスト再検証の選択ロジック。
 */

const test = require('node:test');
const assert = require('node:assert');

const { buildQuestions, validateAnswers, MAX_GENRES } = require('../lib/wizard-questions');
const { GENRE, PURPOSE, LEVEL, genreOrderForPurpose, purposeOrderForGenres } = require('../lib/schema');
const { slugify, domainSlug, buildSchoolId, buildClickTrackingId } = require('../lib/school-id');
const { selectDueEntries } = require('../reverify-old-skips');

const validAnswers = {
  purpose: 'career_change',
  genres: ['programming'],
  level: 'beginner',
  format: 'online',
  subsidy_preference: 'no_preference',
};

test('buildQuestions: Q1未回答ならジャンルの並びは GENRE の定義順', () => {
  const q2 = buildQuestions({}).find(q => q.id === 'genres');
  assert.deepStrictEqual(q2.choices.map(c => c.value), GENRE);
});

test('buildQuestions: Q1の目的に応じて、Q2のジャンルの並びが変わる（逆引き）', () => {
  const sideJob = buildQuestions({ purpose: 'side_job' }).find(q => q.id === 'genres');
  // GENRE_PURPOSE_ORDER で side_job を先頭に置いているのは video_editing。
  assert.strictEqual(sideJob.choices[0].value, 'video_editing');

  const certification = buildQuestions({ purpose: 'certification_itself' }).find(q => q.id === 'genres');
  assert.strictEqual(certification.choices[0].value, 'certification');

  const hobby = buildQuestions({ purpose: 'hobby' }).find(q => q.id === 'hobby' || q.id === 'genres');
  assert.strictEqual(hobby.choices[0].value, 'language');
});

test('buildQuestions: どの目的でも、ジャンルの選択肢は8件すべて出る（並びが変わるだけ）', () => {
  for (const purpose of PURPOSE) {
    const q2 = buildQuestions({ purpose }).find(q => q.id === 'genres');
    assert.deepStrictEqual([...q2.choices.map(c => c.value)].sort(), [...GENRE].sort(), purpose);
  }
});

test('buildQuestions: 通学を選んだときだけ都道府県の追加質問が出る', () => {
  assert.strictEqual(buildQuestions({ format: 'online' }).some(q => q.id === 'prefecture'), false);
  assert.strictEqual(buildQuestions({ format: 'either' }).some(q => q.id === 'prefecture'), false);

  const offline = buildQuestions({ format: 'offline' });
  const prefectureQ = offline.find(q => q.id === 'prefecture');
  assert.ok(prefectureQ);
  assert.strictEqual(prefectureQ.choices.length, 47);
  // 追加質問は Q4 の後、給付金の質問の前に入る。
  assert.deepStrictEqual(offline.map(q => q.id), ['purpose', 'genres', 'level', 'format', 'prefecture', 'subsidy_preference']);
});

test('buildQuestions: ジャンルは複数選択で上限3件', () => {
  const q2 = buildQuestions({}).find(q => q.id === 'genres');
  assert.strictEqual(q2.type, 'multiple');
  assert.strictEqual(q2.maxSelections, MAX_GENRES);
  assert.strictEqual(MAX_GENRES, 3);
});

test('genreOrderForPurpose / purposeOrderForGenres は入力を変更せず、要素の増減もしない', () => {
  const genres = ['programming', 'language'];
  const snapshot = [...genres];
  const purposes = purposeOrderForGenres(genres);
  assert.deepStrictEqual(genres, snapshot);
  assert.deepStrictEqual([...purposes].sort(), [...PURPOSE].sort());
  assert.deepStrictEqual([...genreOrderForPurpose('hobby')].sort(), [...GENRE].sort());
});

test('purposeOrderForGenres: 未知・空のジャンルでは PURPOSE の定義順を返す', () => {
  assert.deepStrictEqual(purposeOrderForGenres([]), PURPOSE);
  assert.deepStrictEqual(purposeOrderForGenres(['nonsense']), PURPOSE);
});

test('validateAnswers: 正常な回答は通る', () => {
  assert.deepStrictEqual(validateAnswers(validAnswers), { ok: true, errors: [] });
});

test('validateAnswers: 未知の値・空のジャンル・上限超過を検出する', () => {
  assert.strictEqual(validateAnswers({ ...validAnswers, purpose: 'nonsense' }).ok, false);
  assert.strictEqual(validateAnswers({ ...validAnswers, genres: [] }).ok, false);
  assert.strictEqual(validateAnswers({ ...validAnswers, genres: ['nonsense'] }).ok, false);
  assert.strictEqual(validateAnswers({ ...validAnswers, genres: [...GENRE].slice(0, 4) }).ok, false);
  assert.strictEqual(validateAnswers({ ...validAnswers, level: 'guru' }).ok, false);
  assert.strictEqual(validateAnswers({ ...validAnswers, format: 'hybrid' }).ok, false);
  assert.strictEqual(validateAnswers({ ...validAnswers, subsidy_preference: 'maybe' }).ok, false);
});

test('validateAnswers: 通学希望なのに都道府県が無ければエラー', () => {
  const result = validateAnswers({ ...validAnswers, format: 'offline' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('prefecture')), result.errors.join(' / '));

  assert.strictEqual(validateAnswers({ ...validAnswers, format: 'offline', prefecture: '東京都' }).ok, true);
});

test('validateAnswers: すべての目的×レベルの組み合わせが通る', () => {
  for (const purpose of PURPOSE) {
    for (const level of LEVEL) {
      assert.strictEqual(validateAnswers({ ...validAnswers, purpose, level }).ok, true, `${purpose}/${level}`);
    }
  }
});

test('slugify / domainSlug: ドメインのラベルからslugを作る（属性ラベルとwwwは無視）', () => {
  assert.strictEqual(domainSlug('https://www.example-school.co.jp/course'), 'example-school');
  assert.strictEqual(domainSlug('https://schoo.jp/'), 'schoo');
  assert.strictEqual(domainSlug('not a url'), '');
  assert.strictEqual(slugify('Tech Academy 2026!'), 'tech-academy-2026');
});

test('buildSchoolId: 衝突したら -2, -3 のサフィックスを付ける（既存を上書きしない）', () => {
  const taken = new Set(['example-school']);
  assert.strictEqual(buildSchoolId('A', 'https://example-school.co.jp/', taken), 'example-school-2');
  taken.add('example-school-2');
  assert.strictEqual(buildSchoolId('A', 'https://example-school.co.jp/', taken), 'example-school-3');
});

test('buildSchoolId: ドメインからslugが取れない場合は名前、それも無理ならハッシュに落とす', () => {
  assert.strictEqual(buildSchoolId('Sample School', 'not a url', new Set()), 'sample-school');
  assert.match(buildSchoolId('日本語のみの名前', 'not a url', new Set()), /^school-[0-9a-f]{8}$/);
});

test('buildSchoolId の結果はスキーマのid形式（小文字slug）を満たす', () => {
  const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const [name, url] of [['A', 'https://Example-School.CO.JP/'], ['日本語', 'not a url'], ['B', 'https://xn--nckgz9qc8c.jp/']]) {
    const id = buildSchoolId(name, url, new Set());
    assert.match(id, pattern, `${name} / ${url} → ${id}`);
    assert.match(buildClickTrackingId(id), /^click-[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

test('selectDueEntries: 一定日数を過ぎた fetch_failed のみを、古い順に取り出す', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const skipList = {
    recent: { name: 'recent', website: 'https://a.example.com/', reason: 'fetch_failed', checkedAt: '2026-05-25T00:00:00.000Z' },
    old: { name: 'old', website: 'https://b.example.com/', reason: 'fetch_failed', checkedAt: '2026-01-01T00:00:00.000Z' },
    older: { name: 'older', website: 'https://c.example.com/', reason: 'fetch_failed', checkedAt: '2025-12-01T00:00:00.000Z' },
    mismatch: { name: 'mismatch', website: 'https://d.example.com/', reason: 'name_mismatch', checkedAt: '2025-01-01T00:00:00.000Z' },
  };

  assert.deepStrictEqual(selectDueEntries(skipList, now, 30, 10).map(e => e.name), ['older', 'old']);
});

test('selectDueEntries: 上限件数を超えない', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const skipList = {};
  for (let i = 0; i < 10; i += 1) {
    skipList[`s${i}`] = { name: `s${i}`, website: `https://s${i}.example.com/`, reason: 'fetch_failed', checkedAt: '2025-01-01T00:00:00.000Z' };
  }
  assert.strictEqual(selectDueEntries(skipList, now, 30, 3).length, 3);
});

test('selectDueEntries: checkedAt が壊れているものは「最も古い」として対象に含める', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const skipList = {
    broken: { name: 'broken', website: 'https://x.example.com/', reason: 'fetch_failed', checkedAt: 'いつか' },
  };
  assert.deepStrictEqual(selectDueEntries(skipList, now, 30, 10).map(e => e.name), ['broken']);
});

test('selectDueEntries: websiteが無いエントリは対象にしない', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const skipList = { nourl: { name: 'nourl', reason: 'fetch_failed', checkedAt: '2025-01-01T00:00:00.000Z' } };
  assert.deepStrictEqual(selectDueEntries(skipList, now, 30, 10), []);
});
