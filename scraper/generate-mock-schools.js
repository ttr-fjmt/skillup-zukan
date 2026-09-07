'use strict';

/**
 * 動作確認用モックデータ（data/mock/schools.mock.json）の生成。
 *
 * 【なぜ架空のスクール名なのか】
 * 実在するスクール名を使ってしまうと、料金・給付金対象・転職支援の有無といった
 * 「そのスクールについての事実の主張」を、確認していないまま作ることになる。
 * モックはスキーマ検証とマッチングロジックの動作確認のためだけのものなので、
 * すべて架空の名称・example.com ドメイン（ドキュメント用に予約されたドメイン）で作る。
 * 本番相当のデータは discover-schools.js が実在照合を経て収集する。
 *
 * 各ジャンル5件×8ジャンル＝40件。診断ウィザードのスコアリングを意味のある形で試せるよう、
 * 目的・レベル・受講形式・給付金対象・口コミ有無・cta_type を意図的にばらつかせている。
 *
 * 実行: node generate-mock-schools.js
 */

const fs = require('fs');
const path = require('path');

const { GENRE, PURPOSE, LEVEL, GENRE_LABELS, GENRE_PURPOSE_ORDER } = require('./lib/schema');
const { buildClickTrackingId } = require('./lib/school-id');
const { buildPriceFromPlans } = require('./lib/price-detail');
const { validateSchools } = require('./lib/validate');

const OUT_PATH = path.join(__dirname, '..', 'data', 'mock', 'schools.mock.json');

/** 生成を毎回同じ結果にするための固定タイムスタンプ（差分が無駄に出ないように）。 */
const FIXED_CREATED_AT = '2026-01-15T09:00:00.000Z';
const FIXED_UPDATED_AT = '2026-03-01T09:00:00.000Z';
const FIXED_FETCHED_AT = '2026-02-20T09:00:00.000Z';

/** 各ジャンル5件それぞれの「型」。5件のうち必ず1件は通学、1件は併用、3件はオンラインになる。 */
const VARIANTS = [
  { suffix: 'オンライン集中', format: 'online', areaIndex: null, levelIndex: 0, subsidy: true, careerSupport: true, ctaType: 'affiliate', reviewSources: 2 },
  { suffix: 'オンライン夜間', format: 'online', areaIndex: null, levelIndex: 1, subsidy: false, careerSupport: true, ctaType: 'direct', reviewSources: 1 },
  { suffix: '通学教室', format: 'offline', areaIndex: 0, levelIndex: 0, subsidy: true, careerSupport: false, ctaType: 'direct', reviewSources: 0 },
  { suffix: 'ハイブリッド', format: 'both', areaIndex: 1, levelIndex: 2, subsidy: false, careerSupport: true, ctaType: 'affiliate', reviewSources: 1 },
  { suffix: '実践ゼミ', format: 'online', areaIndex: null, levelIndex: 3, subsidy: false, careerSupport: false, ctaType: 'direct', reviewSources: 0 },
];

/** 通学系モックの所在地（東京・大阪・愛知を順に使い、都道府県フィルターを試せるようにする）。 */
const AREA_SETS = [
  ['東京都'],
  ['東京都', '大阪府', '愛知県'],
];

const CAREER_PATHS = {
  programming: ['Webエンジニア', 'フロントエンドエンジニア', 'バックエンドエンジニア'],
  webdesign: ['Webデザイナー', 'コーダー', 'バナー制作'],
  uiux: ['UIデザイナー', 'UXリサーチャー', 'プロダクトデザイナー'],
  video_editing: ['動画編集者', '映像クリエイター', 'YouTube運用担当'],
  web_marketing: ['Webマーケター', '広告運用担当', 'SEO担当'],
  genai_dx: ['DX推進担当', '生成AI活用リード', 'データ利活用担当'],
  language: ['海外営業', '通訳・翻訳アシスタント', '外資系企業スタッフ'],
  certification: ['経理・財務', '不動産営業', '総務・法務'],
};

// display / min_yen は buildPriceFromPlans が plans から機械生成する（実データと同じ経路）。
const PRICE_PLANS = [
  [{ label: '月額プラン', amount: 9800 }, { label: '年額プラン', amount: 98000 }],
  [{ label: '標準コース', amount: 198000 }],
  [{ label: '標準コース', amount: 348000 }, { label: '短期コース', amount: 248000 }],
  [{ label: '4週間プラン', amount: 89000 }, { label: '8週間プラン', amount: 149000 }],
  [], // 金額の記載が無いケース
];

const DURATIONS = ['標準3ヶ月', '4〜24週間から選択', '標準6ヶ月（週2回）', '最短1ヶ月', '通い放題（期間の定めなし）'];

/**
 * purpose[] は GENRE_PURPOSE_ORDER の上位から取る（そのジャンルで自然な目的が付く）。
 * variant ごとに開始位置をずらし、同一ジャンル内でも目的が重ならないようにする。
 */
function purposesFor(genre, variantIndex) {
  const order = GENRE_PURPOSE_ORDER[genre];
  const start = variantIndex % 3;
  return order.slice(start, start + 2);
}

function buildMockSchool(genre, variantIndex) {
  const variant = VARIANTS[variantIndex];
  const n = variantIndex + 1;
  const id = `mock-${genre.replace(/_/g, '-')}-${n}`;
  const label = GENRE_LABELS[genre];
  const url = `https://mock-${genre.replace(/_/g, '-')}-${n}.example.com/`;

  const area = variant.areaIndex === null ? [] : AREA_SETS[variant.areaIndex];
  const price = buildPriceFromPlans(PRICE_PLANS[variantIndex], variantIndex === 3 ? 'detail_page' : 'top_page');

  const school = {
    id,
    school_name: `【モック】${label}スクール ${variant.suffix}`,
    official_name: `架空株式会社モック${n}`,
    description:
      `動作確認用の架空データです。${label}を${variant.suffix}形式で学ぶ想定のモックレコードで、` +
      '実在するスクールの情報ではありません。スキーマ検証と診断ウィザードのスコアリングを' +
      '試すためだけに使います。',
    skill_genre: [genre],
    purpose: purposesFor(genre, variantIndex),
    target_level: LEVEL[variant.levelIndex],
    career_paths: CAREER_PATHS[genre].slice(0, 2 + (variantIndex % 2)),
    price,
    duration: DURATIONS[variantIndex],
    format: variant.format,
    area,
    subsidy_eligible: variant.subsidy,
    career_support: variant.careerSupport,
    features: [
      `${label}の基礎から実践までを段階的に扱う想定のモック`,
      `${variant.suffix}での受講を想定したモック`,
      variant.careerSupport ? 'キャリア相談ありの想定のモック' : '学習サポートのみの想定のモック',
    ],
    review_summary:
      variant.reviewSources > 0
        ? {
            text:
              'これは動作確認用の架空の要約文です。実在の口コミに基づくものではなく、' +
              'タイブレーク（口コミ件数の多い方を優先）の挙動を確認するために入れています。',
            sources: Array.from({ length: variant.reviewSources }, (_, i) => ({
              source_name: `モック出典${i + 1}`,
              source_url: `https://mock-review-${i + 1}.example.com/${id}`,
              fetched_at: FIXED_FETCHED_AT,
            })),
          }
        : null,
    review_source_urls: [],
    official_url: url,
    cta_url: variant.ctaType === 'affiliate' ? `${url}?utm_source=skillup-zukan` : url,
    cta_type: variant.ctaType,
    click_tracking_id: buildClickTrackingId(id),
    created_at: FIXED_CREATED_AT,
    updated_at: FIXED_UPDATED_AT,
    // 二段階検証を通った実データと同じく active。1件だけ下で "skipped" に上書きし、
    // 「掲載しないと判断したレコードは診断結果に出ない」ことを確認できるようにする。
    status: 'active',
    source: 'mock',
    source_note: '動作確認用の架空データ（実在のスクールではありません）',
  };

  return school;
}

function buildMockSchools() {
  const schools = [];
  for (const genre of GENRE) {
    for (let i = 0; i < VARIANTS.length; i += 1) {
      schools.push(buildMockSchool(genre, i));
    }
  }

  // フィルターの動作確認用に、意図的に active 以外・複数ジャンルのレコードを混ぜる。
  const excluded = schools.find(s => s.id === 'mock-programming-5');
  excluded.status = 'skipped';
  excluded.source_note += '（status=skipped が診断結果に出ないことの確認用）';

  const multiGenre = schools.find(s => s.id === 'mock-webdesign-1');
  multiGenre.skill_genre = ['webdesign', 'uiux'];
  multiGenre.source_note += '（skill_genre 複数一致の加点確認用）';

  const skipped = schools.find(s => s.id === 'mock-language-5');
  skipped.status = 'skipped';
  skipped.source_note += '（status=skipped が診断結果に出ないことの確認用）';

  return schools;
}

function main() {
  const schools = buildMockSchools();

  const { ok, invalid, duplicateIds } = validateSchools(schools);
  if (!ok) {
    for (const item of invalid) {
      console.error(`  [invalid] index=${item.index} id=${item.id}: ${item.errors.join(' / ')}`);
    }
    for (const dup of duplicateIds) {
      console.error(`  [duplicate id] ${dup.id}`);
    }
    throw new Error('モックデータがスキーマ検証を通りませんでした。');
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(schools, null, 2) + '\n', 'utf8');

  const byStatus = schools.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {});
  console.log(`Wrote ${schools.length} mock school(s) to data/mock/schools.mock.json`);
  console.log(`  status breakdown: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log('  すべて架空のスクールです（実在のスクールの情報ではありません）。');
}

if (require.main === module) {
  main();
}

module.exports = { buildMockSchools, OUT_PATH };
