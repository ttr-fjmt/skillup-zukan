'use strict';

/**
 * 既に掲載済みで受講形式を確定できていないレコードに、校舎ページ巡回だけを後から適用する
 * バックフィル（enrich-prices.js の area 版）。
 *
 * discover-schools.js は既存掲載スクールを除外リストに入れるため、後からフォールバックを
 * 足しても既存レコードには適用されない。
 *
 * 1校あたりのHTTPリクエストは、トップページ1回 + 校舎ページ最大1回。
 * 都道府県が見つからなければ area は空配列のまま据え置き、合成はしない。
 *
 * 実行例:
 *   node enrich-areas.js                          # 対象全件
 *   ENRICH_ONLY_SCHOOL_ID=sejuku node enrich-areas.js
 *   ENRICH_FORCE=1 node enrich-areas.js           # 確定済みのレコードも再確認する
 *   ENRICH_DRY_RUN=1 node enrich-areas.js         # 書き込まずに結果だけ表示
 */

const path = require('path');
const cheerio = require('cheerio');

const { getAnthropicClient } = require('./lib/school-discovery');
const { fetchWithVerifyUA, DETAIL_TEXT_MAX_CHARS } = require('./lib/price-detail');
const { enrichAreaFromDetailPage, needsAreaEnrichment } = require('./lib/area-detail');
const { politeDelay } = require('./lib/http');
const { SCHOOLS_PATH, readSchools, writeSchools } = require('./lib/schools-store');

const MAX_PER_RUN = Number(process.env.ENRICH_MAX_PER_RUN || 20);
const DRY_RUN = Boolean(process.env.ENRICH_DRY_RUN);
const FORCE = Boolean(process.env.ENRICH_FORCE);

function pageTextFrom(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, DETAIL_TEXT_MAX_CHARS);
}

/**
 * 対象の絞り込みはトップページ本文を見ないと決められない（通学キーワードの有無を見るため）
 * ので、ここでは明らかに対象外のものだけを落とす。最終判定は needsAreaEnrichment が行う。
 */
function selectCandidates(schools) {
  const onlyId = (process.env.ENRICH_ONLY_SCHOOL_ID || '').trim();
  return schools
    .filter(s => s.status === 'active')
    // area が入っていても、根拠がトップページだけの通学系は校舎ページを見に行く。
    .filter(s => FORCE || (s.area || []).length === 0 || ((s.format === 'offline' || s.format === 'both') && s.area_source !== 'detail_page'))
    .filter(s => !onlyId || s.id === onlyId)
    .slice(0, MAX_PER_RUN);
}

async function main() {
  const schools = readSchools();
  const candidates = selectCandidates(schools);

  console.log(
    `Checking area for ${candidates.length} school(s) (max ${MAX_PER_RUN})` +
      `${FORCE ? ' [FORCE]' : ''}${DRY_RUN ? ' [DRY RUN — 書き込みません]' : ''}...`
  );
  if (candidates.length === 0) return;

  const anthropic = getAnthropicClient();
  let resolved = 0;
  let unresolved = 0;
  let skippedNoTrigger = 0;

  for (const school of candidates) {
    console.log(`\n${school.school_name} (id=${school.id}) <${school.official_url}>`);

    let html;
    try {
      await politeDelay();
      html = await fetchWithVerifyUA(school.official_url);
    } catch (err) {
      console.warn(`  トップページの取得に失敗しました: ${err.message}`);
      continue;
    }

    if (!FORCE && !needsAreaEnrichment(school, pageTextFrom(html))) {
      console.log('  受講形式は確定済みのため、フォールバックを発動しません（HTTPリクエストは送っていません）。');
      skippedNoTrigger += 1;
      continue;
    }

    const result = await enrichAreaFromDetailPage(school.school_name, html, school.official_url, anthropic);

    school.area = result.area;
    school.format = result.format;
    school.area_source = result.areaSource;
    if (result.detailPageUrl) school.area_detail_url = result.detailPageUrl;

    // 確定できたら format_unconfirmed は落とす。できなければ area_unconfirmed に置き換える。
    const flags = new Set((school.review_flags || []).filter(f => f !== 'format_unconfirmed' && f !== 'area_unconfirmed'));
    if (result.detailPageUrl) flags.add('detail_page_crawled');
    for (const flag of result.flags) flags.add(flag);
    school.review_flags = [...flags];
    school.updated_at = new Date().toISOString();

    if (result.resolved && result.area.length > 0) {
      console.log(`  通学拠点を確認しました: ${result.area.join('、')} (format=${result.format})`);
      resolved += 1;
    } else if (result.resolved) {
      console.log('  「通学拠点なし」と明記されていたため、format=online で確定しました。');
      resolved += 1;
    } else {
      console.log('  都道府県も「オンライン専用」の明記も確認できませんでした（area_unconfirmed、合成はしません）。');
      unresolved += 1;
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 書き込みをスキップしました。');
    return;
  }

  writeSchools(schools);
  console.log(
    `\nWrote updates to ${path.basename(SCHOOLS_PATH)}: 確定 ${resolved}件 / 未確認 ${unresolved}件 / ` +
      `発動せず ${skippedNoTrigger}件。`
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, selectCandidates };
