'use strict';

/**
 * JSON Schema によるバリデーションの検証。モックデータ全件が通ること、および
 * 「通ってはいけないもの」がきちんと落ちることを確認する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { validateSchool, validateSchools } = require('../lib/validate');

const MOCK_PATH = path.join(__dirname, '..', '..', 'data', 'mock', 'schools.mock.json');
const mockSchools = JSON.parse(fs.readFileSync(MOCK_PATH, 'utf8'));

/** 1件の正常系レコードを作り、テストごとに一部だけ壊して使う。 */
function validSchool(overrides = {}) {
  return { ...JSON.parse(JSON.stringify(mockSchools[0])), ...overrides };
}

test('モックデータは40件あり、全件がスキーマを通る', () => {
  assert.strictEqual(mockSchools.length, 40);
  const { ok, invalid, duplicateIds } = validateSchools(mockSchools);
  assert.deepStrictEqual(invalid, []);
  assert.deepStrictEqual(duplicateIds, []);
  assert.strictEqual(ok, true);
});

test('未知の skill_genre は弾かれる', () => {
  const { ok, errors } = validateSchool(validSchool({ skill_genre: ['ai_prompt'] }));
  assert.strictEqual(ok, false);
  assert.ok(errors.some(e => e.includes('/skill_genre/0')), errors.join(' / '));
});

test('未知の target_level は弾かれる', () => {
  const { ok } = validateSchool(validSchool({ target_level: 'expert' }));
  assert.strictEqual(ok, false);
});

test('廃止した status "pending_review" は弾かれる', () => {
  assert.strictEqual(validateSchool(validSchool({ status: 'pending_review' })).ok, false);
  assert.strictEqual(validateSchool(validSchool({ status: 'active' })).ok, true);
  assert.strictEqual(validateSchool(validSchool({ status: 'skipped' })).ok, true);
});

test('format=online なのに area が入っているレコードは弾かれる', () => {
  const { ok, errors } = validateSchool(validSchool({ format: 'online', area: ['東京都'] }));
  assert.strictEqual(ok, false);
  assert.ok(errors.some(e => e.includes('area')), errors.join(' / '));
});

test('format=offline なのに area が空のレコードは弾かれる', () => {
  const { ok, errors } = validateSchool(validSchool({ format: 'offline', area: [] }));
  assert.strictEqual(ok, false);
  assert.ok(errors.some(e => e.includes('area')), errors.join(' / '));
});

test('area に都道府県以外の表記（「東京」）は弾かれる', () => {
  const { ok } = validateSchool(validSchool({ format: 'offline', area: ['東京'] }));
  assert.strictEqual(ok, false);
});

test('review_summary は sources が空だと弾かれる（出典なしの要約を許さない）', () => {
  const { ok } = validateSchool(validSchool({ review_summary: { text: '良い評判が多い。', sources: [] } }));
  assert.strictEqual(ok, false);
});

test('review_summary は null なら通る（未収集の状態）', () => {
  const { ok, errors } = validateSchool(validSchool({ review_summary: null }));
  assert.strictEqual(ok, true, errors.join(' / '));
});

test('price.min_yen は null を許すが、文字列は弾く', () => {
  const base = { scope: 'top_page' };
  assert.strictEqual(validateSchool(validSchool({ price: { ...base, display: '要問い合わせ', min_yen: null } })).ok, true);
  assert.strictEqual(validateSchool(validSchool({ price: { ...base, display: '198,000円', min_yen: '198000' } })).ok, false);
});

test('price.scope は必須で、未知の scope は弾く', () => {
  assert.strictEqual(validateSchool(validSchool({ price: { display: '198,000円', min_yen: 198000 } })).ok, false);
  assert.strictEqual(
    validateSchool(validSchool({ price: { display: '198,000円', min_yen: 198000, scope: 'guess' } })).ok,
    false
  );
});

test('plans はトップレベルで必須。金額・期間は null を許すが label は必須', () => {
  const school = validSchool();
  delete school.plans;
  assert.strictEqual(validateSchool(school).ok, false);

  assert.strictEqual(validateSchool(validSchool({ plans: [{ label: 'A', amount: null, duration: null }] })).ok, true);
  assert.strictEqual(validateSchool(validSchool({ plans: [{ amount: 1000, duration: '1ヶ月' }] })).ok, false);
});

test('廃止した duration（スクール代表値）は弾かれる', () => {
  assert.strictEqual(validateSchool(validSchool({ duration: '標準3ヶ月' })).ok, false);
});

test('id が slug 形式でない場合は弾かれる', () => {
  assert.strictEqual(validateSchool(validSchool({ id: 'Mock_School' })).ok, false);
});

test('click_tracking_id が click-{id} 形式でない場合は弾かれる', () => {
  assert.strictEqual(validateSchool(validSchool({ click_tracking_id: 'xyz' })).ok, false);
});

test('スキーマに無いフィールドを足すと弾かれる（AIの余計な出力が混ざらないように）', () => {
  assert.strictEqual(validateSchool(validSchool({ rating: 4.5 })).ok, false);
});

test('必須フィールドの欠落は弾かれる', () => {
  const school = validSchool();
  delete school.official_url;
  const { ok, errors } = validateSchool(school);
  assert.strictEqual(ok, false);
  assert.ok(errors.some(e => e.includes('official_url')), errors.join(' / '));
});

test('id の重複は validateSchools が検出する', () => {
  const duped = [validSchool(), validSchool()];
  const { ok, duplicateIds } = validateSchools(duped);
  assert.strictEqual(ok, false);
  assert.strictEqual(duplicateIds.length, 1);
  assert.strictEqual(duplicateIds[0].id, duped[0].id);
});
