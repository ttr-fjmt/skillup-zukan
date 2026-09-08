'use strict';

/**
 * 検索エンジン・AI向けの構造化データ（JSON-LD）を組み立てる。
 *
 * 【なぜ専用モジュールにしているか】
 * 構造化データは、人が読むページ本文と同じ内容を機械向けに書き直したものにすぎない。
 * ここで「それらしい値」を足してしまうと、本文には無いことを検索結果やAIの回答に
 * 出すことになり、このサイトで一番避けたい事故になる（DATA_QUALITY_POLICY.md）。
 * そのため、出力してよいのは
 *   - schools.json のレコードにそのまま入っている値
 *   - このファイルで定義している定数（サイト名・ラベル・schema.org の語彙）
 * の2種類だけと決め、それをテストで機械的に確かめている。
 *
 * 料金については、確認できている「一括の最低額」だけを AggregateOffer.lowPrice として出す。
 * 月額と一括は桁が違うので混ぜられない、という表示側の方針とここも揃えている。
 */

const { GENRE_LABELS } = require('./schema');

const SITE_URL = 'https://skillup-zukan.net';
const SITE_NAME = 'スキルアップ図鑑';
const HOME_BREADCRUMB_NAME = 'ホーム';

/** 受講スタイル → schema.org の courseMode。 */
const COURSE_MODE = {
  online: 'Online',
  offline: 'Onsite',
  both: 'Blended',
};

function schoolUrl(id) {
  return `${SITE_URL}/school/${encodeURIComponent(id)}/`;
}

function categoryUrl(genre) {
  return `${SITE_URL}/category/${encodeURIComponent(genre)}/`;
}

/** パンくず。position は 1 始まり。 */
function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** 講座の一覧（ItemList）。並び順は渡された順のまま。 */
function itemList(schools) {
  return {
    '@type': 'ItemList',
    numberOfItems: schools.length,
    itemListElement: schools.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.school_name,
      url: schoolUrl(s.id),
    })),
  };
}

/**
 * 料金。確認できた一括料金の最低額があるときだけ出す。
 *
 * 月額（kind === 'monthly'）を price として出すと、一括料金と同じ土俵で
 * 比較されて誤解を生むため出さない。金額が確認できていない講座も同じく出さない。
 */
function offersOf(school) {
  const price = school.price || {};
  if (price.kind !== 'total') return null;
  if (typeof price.min_yen !== 'number') return null;

  const offer = {
    '@type': 'AggregateOffer',
    priceCurrency: 'JPY',
    lowPrice: price.min_yen,
    url: school.official_url,
  };
  const plans = (school.plans || []).filter(p => typeof p.amount === 'number');
  if (plans.length) offer.offerCount = plans.length;
  return offer;
}

/** 講座詳細ページ（/school/{id}/）。Course と パンくず。 */
function buildSchoolLd(school) {
  const genre = (school.skill_genre || []).find(g => GENRE_LABELS[g]);

  const course = {
    '@type': 'Course',
    name: school.school_name,
    description: school.description,
    url: schoolUrl(school.id),
    provider: {
      '@type': 'Organization',
      // official_name は「公式サイト本文にその表記があるか」を照合済みのときだけ入っている。
      // 確認できていない場合は、掲載名（school_name）以上のことを名乗らせない。
      name: school.official_name || school.school_name,
      url: school.official_url,
    },
    inLanguage: 'ja',
  };

  if (genre) course.about = { '@type': 'Thing', name: GENRE_LABELS[genre] };

  const offers = offersOf(school);
  if (offers) course.offers = offers;

  if (COURSE_MODE[school.format]) {
    course.hasCourseInstance = {
      '@type': 'CourseInstance',
      courseMode: COURSE_MODE[school.format],
    };
  }

  const trail = [{ name: HOME_BREADCRUMB_NAME, url: `${SITE_URL}/` }];
  if (genre) trail.push({ name: GENRE_LABELS[genre], url: categoryUrl(genre) });
  trail.push({ name: school.school_name, url: schoolUrl(school.id) });

  return { '@context': 'https://schema.org', '@graph': [breadcrumb(trail), course] };
}

/** ジャンル別ページ（/category/{genre}/）。掲載中の講座一覧とパンくず。 */
function buildCategoryLd(genre, schools) {
  const label = GENRE_LABELS[genre];
  const trail = [{ name: HOME_BREADCRUMB_NAME, url: `${SITE_URL}/` }];
  if (label) trail.push({ name: label, url: categoryUrl(genre) });

  const page = {
    '@type': 'CollectionPage',
    name: label ? `${label}の講座・スクール比較` : SITE_NAME,
    url: categoryUrl(genre),
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
    mainEntity: itemList(schools),
  };

  return { '@context': 'https://schema.org', '@graph': [breadcrumb(trail), page] };
}

/** トップページ。サイト全体の情報と、掲載している講座の一覧。 */
function buildHomeLd(schools) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        inLanguage: 'ja',
      },
      {
        '@type': 'CollectionPage',
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
        mainEntity: itemList(schools),
      },
    ],
  };
}

/**
 * 出力してよい定数の一覧。
 * テストで「レコードに無い文字列が混ざっていないか」を確かめるときに使う。
 */
const ALLOWED_CONSTANTS = []
  .concat(['https://schema.org', SITE_NAME, HOME_BREADCRUMB_NAME, 'ja', 'JPY', `${SITE_URL}/`])
  .concat(['BreadcrumbList', 'ListItem', 'ItemList', 'CollectionPage', 'WebSite', 'Course',
    'CourseInstance', 'Organization', 'Thing', 'AggregateOffer'])
  .concat(Object.values(COURSE_MODE))
  .concat(Object.values(GENRE_LABELS));

module.exports = {
  SITE_URL,
  SITE_NAME,
  COURSE_MODE,
  ALLOWED_CONSTANTS,
  schoolUrl,
  categoryUrl,
  offersOf,
  buildSchoolLd,
  buildCategoryLd,
  buildHomeLd,
};
