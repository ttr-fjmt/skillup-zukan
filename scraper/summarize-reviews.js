'use strict';

/**
 * 週次バッチ: 各スクールの review_source_urls[] を巡回し、口コミの「傾向」の要約を作って
 * data/schools.json の review_summary を更新するエントリーポイント。
 *
 * 【実行前の必須確認事項（人力）】
 * data/review-sources.json の各サイトについて、robots.txt と利用規約の自動アクセス・
 * クローリングに関する規定を人力で確認し、enabled / robots_txt_ok / terms_ok /
 * checked_by_human_at を埋めるまで、このスクリプトは1件もfetchしない（fail-closed）。
 * 未確認のまま実行した場合は、その旨を表示して何もせず終了する。
 *
 * 実行例:
 *   node summarize-reviews.js                       # 対象全件（未要約・古いものから）
 *   REVIEW_ONLY_SCHOOL_ID=example node summarize-reviews.js   # 1校だけテスト実行
 *   REVIEW_MAX_PER_RUN=5 node summarize-reviews.js
 */

const path = require('path');

const { getAnthropicClient } = require('./lib/school-discovery');
const { fetchReviewPage, buildReviewSummary, assembleReviewSummary } = require('./lib/review-summary');
const { enabledSources, loadReviewSources } = require('./lib/review-sources');
const { SCHOOLS_PATH, readSchools, writeSchools } = require('./lib/schools-store');

/** 1回の実行で要約を更新する学校数の上限。 */
const MAX_PER_RUN = Number(process.env.REVIEW_MAX_PER_RUN || 20);

/** 既存の要約がこの日数より新しい学校は、今回の対象から外す（毎週全件を取り直さない）。 */
const REFRESH_AFTER_DAYS = Number(process.env.REVIEW_REFRESH_AFTER_DAYS || 30);

/**
 * 対象の学校を選ぶ。
 * - review_source_urls[] が空の学校は対象外（巡回先が特定できていない）。
 * - REVIEW_ONLY_SCHOOL_ID が指定されていればその1校のみ（1校だけのテスト実行用）。
 * - 未要約（review_summary === null）を優先し、次に要約が古い順。
 */
function selectTargets(schools, now = Date.now()) {
  const onlyId = (process.env.REVIEW_ONLY_SCHOOL_ID || '').trim();
  if (onlyId) {
    return schools.filter(s => s.id === onlyId);
  }

  const cutoff = now - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000;

  const lastFetchedAt = school => {
    const sources = (school.review_summary && school.review_summary.sources) || [];
    const times = sources.map(s => Date.parse(s.fetched_at || '')).filter(t => !Number.isNaN(t));
    return times.length ? Math.max(...times) : 0;
  };

  return schools
    .filter(s => Array.isArray(s.review_source_urls) && s.review_source_urls.length > 0)
    .filter(s => !s.review_summary || lastFetchedAt(s) <= cutoff)
    .sort((a, b) => lastFetchedAt(a) - lastFetchedAt(b))
    .slice(0, MAX_PER_RUN);
}

/** 1校分の巡回。取得できた出典ごとのブロックを返す（拒否・失敗した出典は理由をログに出す）。 */
async function collectBlocksForSchool(school, sourcesConfig) {
  const blocks = [];

  for (const entry of school.review_source_urls) {
    const config = sourcesConfig.find(s => s.source_name === entry.source_name);
    const result = await fetchReviewPage(entry.source_url, { selectorHint: config && config.review_selector });

    if (!result.ok) {
      console.log(`    - ${entry.source_name}: スキップ (${result.reason}) ${result.message || ''}`);
      continue;
    }

    console.log(`    - ${entry.source_name}: 口コミ${result.reviews.length}件を取得`);
    blocks.push({
      source_name: entry.source_name,
      source_url: entry.source_url,
      reviews: result.reviews,
      fetchedAt: result.fetchedAt,
    });
  }

  return blocks;
}

async function main() {
  const sourcesConfig = loadReviewSources();
  const enabled = enabledSources(sourcesConfig);

  if (enabled.length === 0) {
    console.log(
      '口コミ収集の対象サイトが1件も有効になっていません。\n' +
        `data/review-sources.json の各サイトについて robots.txt と利用規約を人力で確認し、\n` +
        'enabled / robots_txt_ok / terms_ok / checked_by_human_at を埋めてから再実行してください。\n' +
        '（確認が済むまで、このパイプラインは1件もHTTPリクエストを送りません。）'
    );
    return;
  }
  console.log(`有効な口コミ出典: ${enabled.map(s => s.source_name).join('、')}`);

  const schools = readSchools();
  const targets = selectTargets(schools);
  console.log(`Summarizing reviews for ${targets.length} school(s) (max ${MAX_PER_RUN})...`);
  if (targets.length === 0) return;

  const anthropic = getAnthropicClient();
  let updated = 0;

  for (const school of targets) {
    console.log(`  ${school.school_name} (id=${school.id})`);
    const blocks = await collectBlocksForSchool(school, sourcesConfig);

    if (blocks.length === 0) {
      console.log('    要約に使える出典がありませんでした。既存の要約は変更しません。');
      continue;
    }

    let summary;
    try {
      summary = await buildReviewSummary(school.school_name, blocks, anthropic);
    } catch (err) {
      console.warn(`    要約の生成に失敗しました: ${err.message}`);
      continue;
    }

    // 既存の要約がある場合は上書き更新する（sources[] の fetched_at も今回の取得日時になる）。
    school.review_summary = assembleReviewSummary(summary.text, blocks);
    school.updated_at = new Date().toISOString();
    updated += 1;

    console.log(`    要約を更新しました（出典${school.review_summary.sources.length}件）:`);
    console.log(`      ${summary.text}`);
    if (summary.positive_themes.length) console.log(`      良い評判の傾向: ${summary.positive_themes.join('、')}`);
    if (summary.concern_themes.length) console.log(`      気になる点の傾向: ${summary.concern_themes.join('、')}`);
  }

  if (updated > 0) {
    writeSchools(schools);
    console.log(`Wrote ${updated} updated summary/summaries to ${path.basename(SCHOOLS_PATH)}.`);
  }
  console.log(
    `Review summarization finished: targets=${targets.length}, updated=${updated}.\n` +
      '生成された要約文が原文の構成をなぞっていないか、必ず人力で確認してください。'
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, selectTargets, collectBlocksForSchool, MAX_PER_RUN, REFRESH_AFTER_DAYS };
