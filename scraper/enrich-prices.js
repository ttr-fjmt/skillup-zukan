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
const cheerio = require('cheerio');
const {
  enrichPriceFromDetailPage,
  fetchWithVerifyUA,
  fetchDetailPage,
  extractPriceFromPage,
  DETAIL_TEXT_MAX_CHARS,
} = require('./lib/price-detail');
const { politeDelay } = require('./lib/http');
const { NOT_DISCLOSED_TEXT } = require('./lib/schema');
const { SCHOOLS_PATH, readSchools, writeSchools } = require('./lib/schools-store');

const MAX_PER_RUN = Number(process.env.ENRICH_MAX_PER_RUN || 20);
const DRY_RUN = Boolean(process.env.ENRICH_DRY_RUN);

/**
 * 対象は次のいずれか。
 *   - price.min_yen が null（まだ金額を取れていない）
 *   - price.plans が無い（display をAIに書かせていた旧フォーマットのままのレコード）
 * 既に新フォーマットで金額が入っているレコードは触らない。
 */
function needsEnrichment(school) {
  if (!school.price) return true;
  if (school.price.min_yen === null) return true;
  return !Array.isArray(school.price.plans) || school.price.plans.length === 0;
}

/**
 * ENRICH_FORCE=1 で needsEnrichment の判定を飛ばし、既に plans があるレコードも
 * 対象に含める。抽出プロンプトを直したあと、その結果を既存レコードに反映し直すために使う
 * （プロンプト修正のたびに手でデータを消す、という運用を避けるため）。
 */
function selectTargets(schools) {
  const onlyId = (process.env.ENRICH_ONLY_SCHOOL_ID || '').trim();
  const force = Boolean(process.env.ENRICH_FORCE);
  return schools
    .filter(s => s.status === 'active')
    .filter(s => force || needsEnrichment(s))
    .filter(s => !onlyId || s.id === onlyId)
    .slice(0, MAX_PER_RUN);
}

/** HTMLから本文テキストを取り出す（トップページからの再抽出用）。 */
function pageTextFrom(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, DETAIL_TEXT_MAX_CHARS);
}

/**
 * 旧フォーマット（display がAIの自由記述、plans 無し）のレコードを新フォーマットへ移行する。
 * 当時の金額がどこから来たかを detail_page_url の有無で判断し、同じページから取り直す。
 */
async function migrateExistingPrice(school, homepageHtml, anthropic) {
  if (school.detail_page_url) {
    let pageText;
    try {
      await politeDelay();
      pageText = await fetchDetailPage(school.detail_page_url);
    } catch (err) {
      console.warn(`  詳細ページの再取得に失敗しました: ${err.message}`);
      return null;
    }
    const price = await extractPriceFromPage(school.school_name, school.detail_page_url, pageText, anthropic, 'detail_page');
    return price.min_yen === null ? null : price;
  }

  const price = await extractPriceFromPage(school.school_name, school.official_url, pageTextFrom(homepageHtml), anthropic, 'top_page');
  return price.min_yen === null ? null : price;
}

/**
 * 詳細ページ1枚から得た価格は、そのスクール全体の最安値とは限らない
 * （他コースにより安いプランがありうる）。機械的に検出できる形で残す。
 */
function applyScopeFlags(school, price) {
  const flags = new Set(school.review_flags || []);
  if (price.scope === 'detail_page') flags.add('price_scope_limited');
  else flags.delete('price_scope_limited');
  school.review_flags = [...flags];
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

    // 既に金額はあるが plans を持たない（display をAIに書かせていた旧フォーマットの）
    // レコードは、当時と同じページから plans 形式で取り直す。新たにリンクを選び直すと
    // 別のページの金額に置き換わってしまい、移行ではなく再収集になってしまうため。
    if (school.price && school.price.min_yen !== null) {
      const migrated = await migrateExistingPrice(school, html, anthropic);
      if (migrated) {
        console.log(
          `  price(移行): 「${school.price.display}」 -> 「${migrated.display}」 ` +
            `(min_yen=${migrated.min_yen}, plans=${migrated.plans.length}件, scope=${migrated.scope})`
        );
        school.price = migrated;
        applyScopeFlags(school, migrated);
        school.updated_at = new Date().toISOString();
        updated += 1;
      } else {
        console.warn('  移行できませんでした（金額を再確認できず）。既存の値を据え置きます。');
      }
      continue;
    }

    const enrichment = await enrichPriceFromDetailPage(school.school_name, html, school.official_url, anthropic);

    if (enrichment.detailPageUrl) {
      school.detail_page_url = enrichment.detailPageUrl;
      const flags = new Set([...(school.review_flags || []), ...enrichment.flags]);
      school.review_flags = [...flags];
    }

    if (enrichment.price && enrichment.price.min_yen !== null) {
      console.log(
        `  price: null -> 「${enrichment.price.display}」 ` +
          `(min_yen=${enrichment.price.min_yen}, plans=${enrichment.price.plans.length}件, scope=${enrichment.price.scope})`
      );
      school.price = enrichment.price;
      applyScopeFlags(school, enrichment.price);
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

  // 移行できなかったレコードが旧フォーマット（plans / scope 無し）のまま残ると、
  // writeSchools() のスキーマ検証で実行全体が落ちる。対象外だったレコードも含め、
  // 形だけは必ず新フォーマットに揃えてから書き込む（金額そのものは触らない）。
  for (const school of schools) {
    if (school.price && Array.isArray(school.price.plans) && school.price.scope) continue;
    const scope = school.detail_page_url && school.price && school.price.min_yen !== null ? 'detail_page' : 'top_page';
    school.price = {
      display: school.price ? school.price.display : NOT_DISCLOSED_TEXT,
      min_yen: school.price ? school.price.min_yen : null,
      plans: [],
      scope,
    };
    applyScopeFlags(school, school.price);
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
