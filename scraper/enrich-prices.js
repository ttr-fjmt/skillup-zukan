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
const priceDetail = require('./lib/price-detail');
const {
  enrichPriceFromDetailPage,
  fetchWithVerifyUA,
  fetchDetailPage,
  extractPageLinks,
  extractPriceFromPage,
  DETAIL_TEXT_MAX_CHARS,
} = priceDetail;
const { fetchRenderedHtml, closeBrowser } = require('./lib/render');
const { politeDelay } = require('./lib/http');
const { PRICE_NOT_DISCLOSED_TEXT } = require('./lib/schema');
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
  return !Array.isArray(school.plans) || school.plans.length === 0;
}

/**
 * すでに料金ページを巡回したのに金額を取れなかったレコードか。
 *
 * 2026-10-02、料金が無い160件を埋めようとしたところ0件しか取れなかった。調べると、
 * そのうち108件は過去に巡回して失敗済みで、同じコードで同じページを読み直していた。
 * 公式サイトの作り（料金が画面表示時に読み込まれる・階層が深い）が理由なので、
 * コードが変わらないかぎり結果も変わらない。既定では巡回済みを除き、まだ試していない
 * レコードを先に処理する。プロンプトや抽出を直したあとの再適用は ENRICH_FORCE=1 で行う。
 */
function alreadyCrawled(school) {
  return Array.isArray(school.review_flags) && school.review_flags.includes('detail_page_crawled');
}

/**
 * ENRICH_FORCE=1 で needsEnrichment と「巡回済みを除く」判定の両方を飛ばし、
 * 既に plans があるレコードも対象に含める。抽出プロンプトを直したあと、その結果を
 * 既存レコードに反映し直すために使う
 * （プロンプト修正のたびに手でデータを消す、という運用を避けるため）。
 */
function selectTargets(schools) {
  const onlyId = (process.env.ENRICH_ONLY_SCHOOL_ID || '').trim();
  const force = Boolean(process.env.ENRICH_FORCE);
  // ENRICH_INCLUDE_CRAWLED=1 は「巡回済みを除く」判定だけを外す。
  // 取り方そのものを変えたとき（2026-10-02 のブラウザ対応など）に、過去に失敗した
  // レコードへもう一度だけかけるための入口。ENRICH_FORCE と違い、
  // すでに金額が入っているレコードには触らない（取れている料金を上書きしないため）。
  const includeCrawled = force || Boolean(process.env.ENRICH_INCLUDE_CRAWLED);
  return schools
    .filter(s => s.status === 'active')
    .filter(s => force || needsEnrichment(s))
    .filter(s => includeCrawled || onlyId || !alreadyCrawled(s))
    .filter(s => !onlyId || s.id === onlyId)
    .slice(0, MAX_PER_RUN);
}

/**
 * ブラウザで開いてから読むかどうか。既定は有効。ENRICH_RENDER=0 で切れる。
 *
 * 2026-10-02、HTMLをそのまま読む方式で57校を試して料金が1件も取れなかった。
 * メニューも料金表もJavaScriptで組み立てるサイトが多く、HTMLには
 * 「プライバシーポリシー」「特定商取引法に基づく表記」しか入っていなかったため。
 */
const USE_RENDER = process.env.ENRICH_RENDER !== '0';

/** リンクがこの数より少なければ、HTMLが組み上がっていないと見なしてブラウザで開き直す。 */
const MIN_LINKS_BEFORE_RENDER = Number(process.env.ENRICH_MIN_LINKS || 8);

/**
 * トップページを取る。まずHTMLをそのまま読み、リンクが乏しければブラウザで開き直す。
 * 速くて軽い方を先に試し、駄目なときだけブラウザを使う、という順番にしている。
 */
async function fetchHomepage(url) {
  let html = await fetchWithVerifyUA(url);
  if (!USE_RENDER) return html;

  const links = extractPageLinks(html, url);
  if (links.length >= MIN_LINKS_BEFORE_RENDER) return html;

  console.log(`  リンクが${links.length}件しか無いため、ブラウザで開き直します。`);
  try {
    const rendered = await fetchRenderedHtml(url);
    const after = extractPageLinks(rendered, url);
    console.log(`  ブラウザで開いた結果、リンクは${after.length}件になりました。`);
    if (after.length > links.length) return rendered;
  } catch (err) {
    console.warn(`  ブラウザでの取得に失敗しました（そのままのHTMLを使います）: ${err.message}`);
  }
  return html;
}

/**
 * 詳細ページの本文を取る。HTMLをそのまま読んで金額らしき表記が無ければ、
 * ブラウザで開き直す（料金表を描画してから出すサイトのため）。
 * price-detail.js が module.exports 経由で呼ぶので、ここで差し替える。
 */
const YEN_PATTERN = /[0-9０-９][0-9０-９,，]*\s*円|[¥￥]\s*[0-9０-９]/;

function bodyTextFrom(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, DETAIL_TEXT_MAX_CHARS);
}

async function fetchDetailPageWithRender(url) {
  const text = await fetchDetailPage(url);
  if (!USE_RENDER || YEN_PATTERN.test(text)) return text;

  console.log('  本文に金額が見当たらないため、詳細ページをブラウザで開き直します。');
  try {
    const rendered = bodyTextFrom(await fetchRenderedHtml(url));
    if (YEN_PATTERN.test(rendered)) return rendered;
    return rendered.length > text.length ? rendered : text;
  } catch (err) {
    console.warn(`  ブラウザでの取得に失敗しました（そのままの本文を使います）: ${err.message}`);
    return text;
  }
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
  if (school.price_detail_url) {
    let pageText;
    try {
      await politeDelay();
      pageText = await fetchDetailPage(school.price_detail_url);
    } catch (err) {
      console.warn(`  詳細ページの再取得に失敗しました: ${err.message}`);
      return null;
    }
    const extracted = await extractPriceFromPage(school.school_name, school.price_detail_url, pageText, anthropic, 'detail_page');
    return extracted.price.min_yen === null ? null : extracted;
  }

  const extracted = await extractPriceFromPage(school.school_name, school.official_url, pageTextFrom(homepageHtml), anthropic, 'top_page');
  return extracted.price.min_yen === null ? null : extracted;
}

/**
 * 詳細ページ1枚から得た価格は、そのスクール全体の最安値とは限らない
 * （他コースにより安いプランがありうる）。機械的に検出できる形で残す。
 */
function applyScopeFlags(school, price) {
  const flags = new Set(school.review_flags || []);
  // 金額が1件も取れていないレコードに「他にもっと安いプランがあるかも」という注記を
  // 付けても意味が無いので、金額があるときだけ立てる。
  if (price.scope === 'detail_page' && price.min_yen !== null) flags.add('price_scope_limited');
  else flags.delete('price_scope_limited');
  school.review_flags = [...flags];
}

async function main() {
  // price-detail.js は module.exports 経由で fetchDetailPage を呼ぶので、ここで
  // ブラウザ版に差し替える。日次の発見処理は差し替えないので、速さは変わらない。
  if (USE_RENDER) priceDetail.fetchDetailPage = fetchDetailPageWithRender;

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
      html = await fetchHomepage(school.official_url);
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
        const withDuration = migrated.plans.filter(p => p.duration !== null).length;
        console.log(
          `  price(移行): 「${school.price.display}」 -> 「${migrated.price.display}」 ` +
            `(min_yen=${migrated.price.min_yen}, plans=${migrated.plans.length}件` +
            `（うち期間あり ${withDuration}件）, scope=${migrated.price.scope})`
        );
        school.price = migrated.price;
        school.plans = migrated.plans;
        applyScopeFlags(school, migrated.price);
        school.updated_at = new Date().toISOString();
        updated += 1;
      } else {
        console.warn('  移行できませんでした（金額を再確認できず）。既存の値を据え置きます。');
      }
      continue;
    }

    const enrichment = await enrichPriceFromDetailPage(school.school_name, html, school.official_url, anthropic);

    if (enrichment.detailPageUrl) {
      school.price_detail_url = enrichment.detailPageUrl;
      // scope は price_detail_url の有無から導出する約束なので、URLを入れたら必ず合わせる。
      // 金額が取れなかったときは下の分岐で price を書き換えないため、ここで直さないと
      // 「price_detail_url はあるのに scope は top_page」という食い違いが残る
      // （2026-10-02、digital-hacks で実際に起き、掲載データのガードが止まった）。
      if (school.price) school.price.scope = 'detail_page';
      const flags = new Set([...(school.review_flags || []), ...enrichment.flags]);
      school.review_flags = [...flags];
    }

    if (enrichment.price && enrichment.price.min_yen !== null) {
      const plans = enrichment.plans || [];
      console.log(
        `  price: null -> 「${enrichment.price.display}」 ` +
          `(min_yen=${enrichment.price.min_yen}, plans=${plans.length}件` +
          `（うち期間あり ${plans.filter(p => p.duration !== null).length}件）, scope=${enrichment.price.scope})`
      );
      school.price = enrichment.price;
      school.plans = enrichment.plans || [];
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
    if (!Array.isArray(school.plans)) school.plans = [];
    // scope は price_detail_url の有無から導出する、という約束を書き込み前に必ず通す。
    // 1か所でも書き換え漏れがあると掲載データのガードが止まり、次の日の記事公開まで
    // 巻き添えになるため、形を整えるこの段階で全件そろえる。
    if (school.price && school.price.scope) {
      school.price.scope = school.price_detail_url ? 'detail_page' : 'top_page';
    }
    if (school.price && school.price.scope && !('plans' in school.price)) continue;
    school.price = {
      display: school.price ? school.price.display : PRICE_NOT_DISCLOSED_TEXT,
      min_yen: school.price ? school.price.min_yen : null,
      // scope は price_detail_url の有無から導出する（1フィールド1責務にした結果、
      // 「どこまで見たか」は URL の有無そのもので表せる）。
      scope: school.price_detail_url ? 'detail_page' : 'top_page',
    };
    applyScopeFlags(school, school.price);
  }

  writeSchools(schools);
  console.log(`\nWrote updates to ${path.basename(SCHOOLS_PATH)}: price を取得できたのは ${updated}件 / ${targets.length}件。`);
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error(err);
      process.exitCode = 1;
    })
    // 失敗しても必ずブラウザを閉じる。閉じ忘れると Actions のジョブが終わらない。
    .finally(() => closeBrowser());
}

module.exports = { main, selectTargets, alreadyCrawled, fetchHomepage, fetchDetailPageWithRender };
