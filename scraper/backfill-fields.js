'use strict';

/**
 * すでに掲載しているレコードを、新しい読み取り量で公式サイトから読み直し、
 * 空いている項目だけを埋めるバックフィル。
 *
 * 【なぜ必要になったか】
 * 2026-10-02、AdSense に「有用性の低いコンテンツ」と判定された。原因を追うと、
 * 公式サイトの本文を 6,000 文字で打ち切ってから抽出していた（lib/school-discovery.js の
 * PAGE_TEXT_MAX_CHARS）。説明文・特徴・料金・目指せる職種はすべてこの本文1つから
 * 取っているため、日本語のスクールサイトではメニューやパンくずで枠を使い切り、
 * 本題に入る前に切れていた。掲載321件のうち、目指せる職種が無い218件・料金が無い160件
 * という偏りはこれで説明がつく。
 *
 * 上限は 18,000 文字へ引き上げたが、それが効くのは「これから見つかる講座」だけなので、
 * すでに載っているレコードはこのスクリプトで読み直す。
 *
 * 【絶対に守ること】
 * 空いている項目だけを埋める。すでに入っている値は上書きしない。
 * 読み直しで値が変わること自体は正しくても、「前は取れていた情報が消える・入れ替わる」
 * 事故の方が、掲載サイトとしては重い。ジャンル（skill_genre）は、変えるとカテゴリー間で
 * 掲載が移動してしまうので触らない。
 *
 * 実行例:
 *   node backfill-fields.js                          # 空きのある全件
 *   BACKFILL_ONLY_SCHOOL_ID=sejuku node backfill-fields.js
 *   BACKFILL_MAX_PER_RUN=10 node backfill-fields.js
 *   BACKFILL_DRY_RUN=1 node backfill-fields.js       # 書き込まずに結果だけ表示
 */

const path = require('path');
const cheerio = require('cheerio');

const {
  getAnthropicClient,
  fetchWithVerifyUA,
  buildPageText,
  buildDiscoveredSchoolFields,
  PAGE_TEXT_MAX_CHARS,
} = require('./lib/school-discovery');
const { fetchRenderedHtml, closeBrowser } = require('./lib/render');
const { politeDelay } = require('./lib/http');
const { NOT_DISCLOSED_TEXT } = require('./lib/schema');
const { SCHOOLS_PATH, readSchools, writeSchools } = require('./lib/schools-store');
const { validateSchool } = require('./lib/validate');

const MAX_PER_RUN = Number(process.env.BACKFILL_MAX_PER_RUN || 20);
const DRY_RUN = Boolean(process.env.BACKFILL_DRY_RUN);
const USE_RENDER = process.env.BACKFILL_RENDER !== '0';

/** 本文がこの文字数に満たなければ、HTMLが組み上がっていないと見てブラウザで開き直す。 */
const MIN_TEXT_BEFORE_RENDER = Number(process.env.BACKFILL_MIN_TEXT || 3000);

/**
 * この件数ごとに途中経過を書き出す。
 * 2026-10-02、310件を読み直した最後の書き込みで1件が検証に落ち、全件分（$3.12）が
 * 保存されずに終わった。途中で止まっても、そこまでの成果は残るようにする。
 */
const SAVE_EVERY = Number(process.env.BACKFILL_SAVE_EVERY || 25);

/** 読み直す価値があるのは、何かしら空いているレコードだけ。 */
function hasGaps(school) {
  if (!school.description || school.description === NOT_DISCLOSED_TEXT) return true;
  if (!Array.isArray(school.features) || school.features.length === 0) return true;
  if (!Array.isArray(school.career_paths) || school.career_paths.length === 0) return true;
  if (!school.price || school.price.min_yen === null) return true;
  if (!Array.isArray(school.purpose) || school.purpose.length === 0) return true;
  if (!school.official_name) return true;
  return false;
}

function selectTargets(schools) {
  const onlyId = (process.env.BACKFILL_ONLY_SCHOOL_ID || '').trim();
  return schools
    .filter(s => s.status === 'active')
    .filter(s => (onlyId ? s.id === onlyId : hasGaps(s)))
    .slice(0, MAX_PER_RUN);
}

function bodyTextFrom(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text();
}

/**
 * トップページの本文を取る。HTMLをそのまま読んで本文が薄ければブラウザで開き直す
 * （メニューも本文もJavaScriptで組み立てるサイトが多いため）。
 */
async function fetchPageText(url) {
  await politeDelay();
  const html = await fetchWithVerifyUA(url);
  const plain = buildPageText(bodyTextFrom(html));
  if (!USE_RENDER || plain.length >= MIN_TEXT_BEFORE_RENDER) return plain;

  console.log(`  本文が${plain.length}文字しか無いため、ブラウザで開き直します。`);
  try {
    const rendered = buildPageText(bodyTextFrom(await fetchRenderedHtml(url)));
    console.log(`  ブラウザで開いた結果、本文は${rendered.length}文字になりました。`);
    return rendered.length > plain.length ? rendered : plain;
  } catch (err) {
    console.warn(`  ブラウザでの取得に失敗しました（そのままの本文を使います）: ${err.message}`);
    return plain;
  }
}

/**
 * 空いている項目だけを埋める。埋めた項目名を返す（何も埋まらなければ空配列）。
 *
 * subsidy_eligible / career_support は false → true の向きだけ採用する。
 * false は「本文で確認できなかった」という意味であり、読み取り量が増えて確認できたなら
 * 直すべき情報だが、逆向き（true → false）は、以前は読めていた記載を今回たまたま
 * 読めなかっただけ、という可能性がある。消す方向には倒さない。
 */
function fillGaps(school, fields) {
  const filled = [];

  if ((!school.description || school.description === NOT_DISCLOSED_TEXT) && fields.description) {
    school.description = fields.description;
    filled.push('説明文');
  }
  if ((school.features || []).length === 0 && (fields.features || []).length > 0) {
    school.features = fields.features;
    filled.push(`特徴${fields.features.length}件`);
  }
  if ((school.career_paths || []).length === 0 && (fields.career_paths || []).length > 0) {
    school.career_paths = fields.career_paths;
    filled.push(`目指せる職種${fields.career_paths.length}件`);
  }
  if ((school.purpose || []).length === 0 && (fields.purpose || []).length > 0) {
    school.purpose = fields.purpose;
    filled.push('目的');
  }
  if (!school.official_name && fields.official_name) {
    school.official_name = fields.official_name;
    filled.push('運営会社');
  }
  if (!school.target_level && fields.target_level) {
    school.target_level = fields.target_level;
    filled.push('対象レベル');
  }
  if ((!school.price || school.price.min_yen === null) && fields.price && fields.price.min_yen !== null) {
    school.price = fields.price;
    if (Array.isArray(fields.plans)) school.plans = fields.plans;
    filled.push(`料金「${fields.price.display}」`);
  }
  if (school.subsidy_eligible !== true && fields.subsidy_eligible === true) {
    school.subsidy_eligible = true;
    filled.push('給付金対象');
  }
  if (school.career_support !== true && fields.career_support === true) {
    school.career_support = true;
    filled.push('転職・キャリア支援');
  }

  return filled;
}

/**
 * 空きを埋め、そのレコードがスキーマを満たすか確かめる。満たさなければ元に戻す。
 *
 * 書き込み時の検証（writeSchools）は1件でも不正があるとファイル全体を書かない。
 * それ自体は正しい安全装置だが、読み直しのように何百件もまとめて書き換える処理では、
 * 1件の不備（例：80文字を超える特徴）で全件分の成果と費用が失われる。
 * そこで、不備はそのレコードだけ元に戻して先へ進む。
 */
function applyFill(schools, school, fields) {
  const index = schools.indexOf(school);
  const before = JSON.parse(JSON.stringify(school));
  const filled = fillGaps(school, fields);
  if (filled.length === 0) return { filled, reverted: false, errors: [] };

  const { ok, errors } = validateSchool(school);
  if (ok) return { filled, reverted: false, errors: [] };

  schools[index] = before;
  return { filled, reverted: true, errors };
}

async function main() {
  const schools = readSchools();
  const targets = selectTargets(schools);

  console.log(
    `公式サイトを読み直して空きを埋めます（本文の上限 ${PAGE_TEXT_MAX_CHARS} 文字）: ` +
      `${targets.length}件 / 上限${MAX_PER_RUN}件${DRY_RUN ? ' [DRY RUN — 書き込みません]' : ''}`
  );
  if (targets.length === 0) return;

  const anthropic = getAnthropicClient();
  let updated = 0;

  for (const school of targets) {
    console.log(`\n${school.school_name} (id=${school.id}) <${school.official_url}>`);

    let pageText;
    try {
      pageText = await fetchPageText(school.official_url);
    } catch (err) {
      console.warn(`  トップページの取得に失敗しました: ${err.message}`);
      continue;
    }
    if (!pageText || pageText.length < 200) {
      console.warn(`  本文が${pageText ? pageText.length : 0}文字しか取れないため、読み直しを見送ります。`);
      continue;
    }

    let fields;
    try {
      fields = await buildDiscoveredSchoolFields(
        { name: school.school_name, website: school.official_url },
        pageText,
        anthropic,
        null
      );
    } catch (err) {
      console.warn(`  本文からの抽出に失敗しました: ${err.message}`);
      continue;
    }

    const { filled, reverted, errors } = applyFill(schools, school, fields);
    if (filled.length === 0) {
      console.log('  埋まる項目はありませんでした（すでに入っている値は触りません）。');
      continue;
    }
    if (reverted) {
      console.warn(`  埋めた結果が掲載データの決まりを満たさないため、このレコードは元に戻しました: ${errors.join(' / ')}`);
      continue;
    }
    console.log(`  埋めました: ${filled.join(' / ')}`);
    school.updated_at = new Date().toISOString();
    updated += 1;

    if (!DRY_RUN && updated % SAVE_EVERY === 0) {
      writeSchools(schools);
      console.log(`  （途中経過を保存しました: ${updated}件）`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 書き込みをスキップしました。');
    return;
  }

  writeSchools(schools);
  console.log(`\nWrote updates to ${path.basename(SCHOOLS_PATH)}: 何か埋まったのは ${updated}件 / ${targets.length}件。`);
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeBrowser());
}

module.exports = { main, selectTargets, hasGaps, fillGaps, applyFill };
