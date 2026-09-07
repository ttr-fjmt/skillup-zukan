'use strict';

/**
 * 既に掲載済みで price が取れていないレコードに対して、料金の詳細ページ巡回だけを
 * 後から適用するバックフィル。
 *
 * discover-schools.js は既存掲載スクールを除外リストに入れるため、後から
 * フォールバック巡回を足しても、既存レコードには適用されない。このスクリプトは
 * 「price が null のレコード」だけを対象に、トップページを取り直して詳細ページの
 * 巡回を1回行う（freelance-anken-zukan の backfill-company-features.js と同じ位置づけ）。
 *
 * 1校あたりのHTTPリクエストは、トップページ1回 + 詳細ページ最大1回。
 * 取得できなければ price は null のまま据え置き、合成はしない。
 *
 * 実行例:
 *   node enrich-prices.js                        # price が null の全件
 *   ENRICH_ONLY_SCHOOL_ID=sejuku node enrich-prices.js
 *   ENRICH_MAX_PER_RUN=5 node enrich-prices.js
 *   ENRICH_DRY_RUN=1 node enrich-prices.js       # 書き込まずに結果だけ表示
 */

const path = require('path');

const { getAnthropicClient } = require('./lib/school-discovery');
const { enrichPriceFromDetailPage, fetchWithVerifyUA } = require('./lib/price-detail');
const { politeDelay } = require('./lib/http');
const { SCHOOLS_PATH, readSchools, writeSchools } = require('./lib/schools-store');

const MAX_PER_RUN = Number(process.env.ENRICH_MAX_PER_RUN || 20);
const DRY_RUN = Boolean(process.env.ENRICH_DRY_RUN);

/** 対象は price.min_yen が null のレコードのみ（既に取れているものは触らない）。 */
function selectTargets(schools) {
  const onlyId = (process.env.ENRICH_ONLY_SCHOOL_ID || '').trim();
  return schools
    .filter(s => s.status === 'active')
    .filter(s => !s.price || s.price.min_yen === null)
    .filter(s => !onlyId || s.id === onlyId)
    .slice(0, MAX_PER_RUN);
}

async function main() {
  const schools = readSchools();
  const targets = selectTargets(schools);

  console.log(
    `Enriching price for ${targets.length} school(s) with no price (max ${MAX_PER_RUN})` +
      `${DRY_RUN ? ' [DRY RUN — 書き込みません]' : ''}...`
  );
  if (targets.length === 0) return;

  const anthropic = getAnthropicClient();
  let updated = 0;

  for (const school of targets) {
    console.log(`\n${school.school_name} (id=${school.id}) <${school.official_url}>`);

    let html;
    try {
      await politeDelay();
      html = await fetchWithVerifyUA(school.official_url);
    } catch (err) {
      console.warn(`  トップページの取得に失敗しました: ${err.message}`);
      continue;
    }

    const enrichment = await enrichPriceFromDetailPage(school.school_name, html, school.official_url, anthropic);

    if (enrichment.detailPageUrl) {
      school.detail_page_url = enrichment.detailPageUrl;
      const flags = new Set([...(school.review_flags || []), ...enrichment.flags]);
      school.review_flags = [...flags];
    }

    if (enrichment.price && enrichment.price.min_yen !== null) {
      console.log(`  price: null -> ${enrichment.price.min_yen}円 「${enrichment.price.display}」`);
      school.price = { display: enrichment.price.display, min_yen: enrichment.price.min_yen };
      school.updated_at = new Date().toISOString();
      updated += 1;
    } else if (enrichment.detailPageUrl) {
      console.log('  詳細ページを巡回しましたが、金額の記載を確認できませんでした（null のまま据え置き）。');
      school.updated_at = new Date().toISOString();
    } else {
      console.log('  料金ページの候補が見つかりませんでした（HTTPリクエストは送っていません）。');
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 書き込みをスキップしました。');
    return;
  }

  writeSchools(schools);
  console.log(`\nWrote updates to ${path.basename(SCHOOLS_PATH)}: price を取得できたのは ${updated}件 / ${targets.length}件。`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, selectTargets };
