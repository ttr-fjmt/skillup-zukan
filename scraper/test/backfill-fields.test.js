'use strict';

/**
 * 既存レコードの読み直し（backfill-fields.js）のガード。
 *
 * このスクリプトは掲載中のデータを書き換えるので、「空いている項目だけを埋め、
 * すでに入っている値は上書きしない」という約束を機械的に固定する。
 * 読み直しで値が変わること自体は正しくても、「前は取れていた情報が消える・入れ替わる」
 * 事故の方が、掲載サイトとしては重い。
 */

const test = require('node:test');
const assert = require('node:assert');

const { hasGaps, fillGaps, selectTargets } = require('../backfill-fields');
const { NOT_DISCLOSED_TEXT } = require('../lib/schema');

function full(over) {
  return Object.assign(
    {
      id: 'x',
      status: 'active',
      school_name: 'テストスクール',
      official_name: '株式会社テスト',
      description: '既存の説明文',
      features: ['既存の特徴'],
      career_paths: ['既存の職種'],
      purpose: ['career_change'],
      target_level: 'beginner',
      price: { display: '100,000円', min_yen: 100000, scope: 'top_page' },
      plans: [{ label: '既存プラン', amount: 100000, duration: null, kind: 'total' }],
      subsidy_eligible: true,
      career_support: true,
      skill_genre: ['programming'],
    },
    over || {}
  );
}

const extracted = {
  description: '新しい説明文',
  features: ['新しい特徴1', '新しい特徴2'],
  career_paths: ['新しい職種'],
  purpose: ['side_job'],
  target_level: 'advanced',
  official_name: '株式会社ニュー',
  price: { display: '999,999円', min_yen: 999999, scope: 'top_page' },
  plans: [{ label: '新プラン', amount: 999999, duration: null, kind: 'total' }],
  subsidy_eligible: true,
  career_support: true,
};

test('すでに入っている値は、読み直しても上書きしない', () => {
  const school = full();
  const filled = fillGaps(school, extracted);
  assert.deepStrictEqual(filled, [], `何も埋めないはずなのに埋めた: ${filled.join('、')}`);
  assert.strictEqual(school.description, '既存の説明文');
  assert.deepStrictEqual(school.features, ['既存の特徴']);
  assert.deepStrictEqual(school.career_paths, ['既存の職種']);
  assert.strictEqual(school.price.min_yen, 100000);
  assert.strictEqual(school.official_name, '株式会社テスト');
  assert.strictEqual(school.target_level, 'beginner');
});

test('空いている項目だけを埋める', () => {
  const school = full({
    description: NOT_DISCLOSED_TEXT,
    features: [],
    career_paths: [],
    price: { display: '要問い合わせ', min_yen: null, scope: 'top_page' },
  });
  const filled = fillGaps(school, extracted);
  assert.strictEqual(school.description, '新しい説明文');
  assert.deepStrictEqual(school.features, ['新しい特徴1', '新しい特徴2']);
  assert.deepStrictEqual(school.career_paths, ['新しい職種']);
  assert.strictEqual(school.price.min_yen, 999999);
  assert.deepStrictEqual(school.plans, extracted.plans);
  // 空いていなかった項目は触らない。
  assert.deepStrictEqual(school.purpose, ['career_change']);
  assert.strictEqual(school.target_level, 'beginner');
  assert.ok(filled.length >= 4);
});

test('給付金対象・キャリア支援は、確認できた向き（false → true）だけ直す', () => {
  const up = full({ subsidy_eligible: false, career_support: false });
  fillGaps(up, extracted);
  assert.strictEqual(up.subsidy_eligible, true, '確認できたのに true にしていない');
  assert.strictEqual(up.career_support, true);

  const down = full({ subsidy_eligible: true, career_support: true });
  fillGaps(down, { ...extracted, subsidy_eligible: false, career_support: false });
  assert.strictEqual(down.subsidy_eligible, true, '今回読めなかっただけで消してはいけない');
  assert.strictEqual(down.career_support, true);
});

test('ジャンルは読み直しでも変えない（カテゴリー間で掲載が移動してしまうため）', () => {
  const school = full({ features: [] });
  fillGaps(school, { ...extracted, skill_genre: ['uiux', 'video_editing'] });
  assert.deepStrictEqual(school.skill_genre, ['programming']);
});

test('空きが1つも無いレコードは読み直しの対象にしない', () => {
  assert.strictEqual(hasGaps(full()), false);
  assert.strictEqual(hasGaps(full({ career_paths: [] })), true);
  assert.strictEqual(hasGaps(full({ description: NOT_DISCLOSED_TEXT })), true);
  assert.strictEqual(hasGaps(full({ price: { display: '要問い合わせ', min_yen: null } })), true);
});

test('掲載をやめたレコードは読み直さない', () => {
  const ids = selectTargets([full({ id: 'gone', status: 'skipped', features: [] }), full({ id: 'live', features: [] })])
    .map(s => s.id);
  assert.deepStrictEqual(ids, ['live']);
});

test('埋めた結果が掲載データの決まりを満たさなければ、そのレコードだけ元に戻す', () => {
  // 2026-10-02、310件を読み直した最後の書き込みで、1件の特徴が80文字を超えていたために
  // ファイル全体の書き込みが中止され、全件分の成果（$3.12）が保存されなかった。
  const { applyFill } = require('../backfill-fields');
  const { readSchools } = require('../lib/schools-store');
  const { validateSchool } = require('../lib/validate');

  // 実データから、決まりを満たしている掲載中レコードを1件借りる。
  const real = readSchools().find(s => s.status === 'active' && validateSchool(s).ok);
  const school = JSON.parse(JSON.stringify(real));
  school.features = [];
  const original = JSON.parse(JSON.stringify(school));
  const schools = [school];

  const tooLong = 'あ'.repeat(120);
  const result = applyFill(schools, school, { features: [tooLong] });

  assert.strictEqual(result.reverted, true, '決まりを満たさない値を入れたまま進んでいる');
  assert.deepStrictEqual(schools[0], original, '元の値に戻っていない');
  assert.ok(validateSchool(schools[0]).ok, '戻したあとのレコードが決まりを満たしていない');

  // 正しい値なら、そのまま埋まる。
  const ok = applyFill(schools, schools[0], { features: ['80文字以内の特徴'] });
  assert.strictEqual(ok.reverted, false);
  assert.deepStrictEqual(schools[0].features, ['80文字以内の特徴']);
});
