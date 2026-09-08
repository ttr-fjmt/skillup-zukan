'use strict';

/**
 * 構造化データ（JSON-LD）のガード。
 *
 * 一番大事なのは最後の「レコードに無い文字列を出していないか」。
 * 構造化データは検索結果やAIの回答にそのまま引用されるので、ここに推測が混ざると
 * 「ページ本文に書いていないことを外に出す」ことになる。表示側と同じ基準で機械的に止める。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  ALLOWED_CONSTANTS,
  buildSchoolLd,
  buildCategoryLd,
  buildHomeLd,
  offersOf,
  schoolUrl,
  categoryUrl,
} = require('../lib/structured-data');
const { readSchools } = require('../lib/schools-store');

function baseSchool(over) {
  return Object.assign({
    id: 'example-school',
    school_name: 'サンプルスクール',
    official_name: '株式会社サンプル',
    description: 'サンプルの説明文です。',
    skill_genre: ['programming'],
    price: { display: '要問い合わせ', min_yen: null, scope: 'top_page', kind: null },
    format: 'online',
    plans: [],
    official_url: 'https://example.com/',
  }, over || {});
}

/** JSON-LD の中の文字列をすべて集める（キー名は除く）。 */
function leafStrings(value, out) {
  const acc = out || [];
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach(v => leafStrings(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => leafStrings(v, acc));
  return acc;
}

test('Course には掲載名・説明・運営会社がレコードのまま入る', () => {
  const school = baseSchool();
  const course = buildSchoolLd(school)['@graph'].find(n => n['@type'] === 'Course');

  assert.strictEqual(course.name, school.school_name);
  assert.strictEqual(course.description, school.description);
  assert.strictEqual(course.provider.name, school.official_name);
  assert.strictEqual(course.provider.url, school.official_url);
  assert.strictEqual(course.url, schoolUrl(school.id));
});

test('運営会社名を確認できていないときは、掲載名以上のことを名乗らせない', () => {
  const school = baseSchool({ official_name: null });
  const course = buildSchoolLd(school)['@graph'].find(n => n['@type'] === 'Course');
  assert.strictEqual(course.provider.name, school.school_name);
});

test('料金が確認できていない講座には offers を出さない', () => {
  const course = buildSchoolLd(baseSchool())['@graph'].find(n => n['@type'] === 'Course');
  assert.strictEqual(course.offers, undefined);
});

test('月額の講座には offers を出さない（一括料金と桁が違い、混ぜて比較されるため）', () => {
  const school = baseSchool({ price: { display: '月額39,600円〜', min_yen: 39600, kind: 'monthly' } });
  assert.strictEqual(offersOf(school), null);
  const course = buildSchoolLd(school)['@graph'].find(n => n['@type'] === 'Course');
  assert.strictEqual(course.offers, undefined);
});

test('一括料金が確認できている講座は lowPrice に確認できた最低額を出す', () => {
  const school = baseSchool({
    price: { display: '475,200円〜', min_yen: 475200, kind: 'total' },
    plans: [{ label: 'A', amount: 475200, kind: 'total' }, { label: 'B', amount: 653400, kind: 'total' }],
  });
  const course = buildSchoolLd(school)['@graph'].find(n => n['@type'] === 'Course');
  assert.strictEqual(course.offers['@type'], 'AggregateOffer');
  assert.strictEqual(course.offers.lowPrice, 475200);
  assert.strictEqual(course.offers.priceCurrency, 'JPY');
  assert.strictEqual(course.offers.offerCount, 2);
});

test('受講スタイルは courseMode に対応づける', () => {
  const modeOf = format => {
    const course = buildSchoolLd(baseSchool({ format }))['@graph'].find(n => n['@type'] === 'Course');
    return course.hasCourseInstance.courseMode;
  };
  assert.strictEqual(modeOf('online'), 'Online');
  assert.strictEqual(modeOf('offline'), 'Onsite');
  assert.strictEqual(modeOf('both'), 'Blended');
});

test('パンくずは ホーム > ジャンル > スクール名 の順になる', () => {
  const school = baseSchool();
  const crumb = buildSchoolLd(school)['@graph'].find(n => n['@type'] === 'BreadcrumbList');
  assert.deepStrictEqual(crumb.itemListElement.map(i => i.name),
    ['ホーム', 'プログラミング・エンジニア', school.school_name]);
  assert.deepStrictEqual(crumb.itemListElement.map(i => i.position), [1, 2, 3]);
  assert.strictEqual(crumb.itemListElement[1].item, categoryUrl('programming'));
});

test('ジャンルが無い講座では、パンくずにジャンルを作らない', () => {
  const crumb = buildSchoolLd(baseSchool({ skill_genre: [] }))['@graph']
    .find(n => n['@type'] === 'BreadcrumbList');
  assert.deepStrictEqual(crumb.itemListElement.map(i => i.name), ['ホーム', 'サンプルスクール']);
});

test('ジャンル別ページは、そのジャンルの講座だけを一覧にする', () => {
  const list = [baseSchool({ id: 'a', school_name: 'A' }), baseSchool({ id: 'b', school_name: 'B' })];
  const page = buildCategoryLd('programming', list)['@graph'].find(n => n['@type'] === 'CollectionPage');
  assert.strictEqual(page.mainEntity.numberOfItems, 2);
  assert.deepStrictEqual(page.mainEntity.itemListElement.map(i => i.name), ['A', 'B']);
  assert.strictEqual(page.mainEntity.itemListElement[0].url, schoolUrl('a'));
});

test('トップページは WebSite と掲載一覧を出す', () => {
  const graph = buildHomeLd([baseSchool()])['@graph'];
  assert.ok(graph.some(n => n['@type'] === 'WebSite'));
  assert.strictEqual(graph.find(n => n['@type'] === 'CollectionPage').mainEntity.numberOfItems, 1);
});

test('JSON-LD はそのまま JSON にできる（ページに埋め込めない形にしない）', () => {
  const json = JSON.stringify(buildSchoolLd(baseSchool()));
  assert.deepStrictEqual(JSON.parse(json), buildSchoolLd(baseSchool()));
});

test('掲載中の全レコードで、レコードに無い文字列を構造化データに出していない', () => {
  const schools = readSchools().filter(s => s.status === 'active');
  assert.ok(schools.length > 0, '掲載中の講座が読み込めていない');

  const allowed = new Set(ALLOWED_CONSTANTS);
  for (const school of schools) {
    const source = JSON.stringify(school);
    for (const value of leafStrings(buildSchoolLd(school))) {
      if (allowed.has(value)) continue;
      // /school/{id}/ のようなサイト内URLは、レコードのidから機械的に作っている。
      if (value === schoolUrl(school.id)) continue;
      if (value.startsWith('https://skillup-zukan.net/category/')) continue;
      assert.ok(
        source.includes(JSON.stringify(value).slice(1, -1)),
        `${school.id}: レコードに無い文字列が構造化データに出ている: ${value}`
      );
    }
  }
});

test('構造化データのモジュールは lib/ にあり、ブラウザ用bundleにも入っている', () => {
  const { MODULES, EXPORTS } = require('../build-wizard-bundle');
  assert.ok(MODULES.includes('lib/structured-data.js'));
  for (const key of ['buildHomeLd', 'buildCategoryLd', 'buildSchoolLd']) {
    assert.ok(EXPORTS.includes(key), `${key} が bundle の公開APIに入っていない`);
  }
  // 生成済みの assets/wizard.js が古いままだと、サイトでは使えない。
  const bundle = require('fs').readFileSync(
    path.join(__dirname, '..', '..', 'assets', 'wizard.js'), 'utf8');
  assert.ok(bundle.includes('buildSchoolLd'), 'assets/wizard.js を作り直していない');
});
