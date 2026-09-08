'use strict';

/**
 * 掲載中の全レコードに、現在のガードをまとめて再適用する。
 *
 * DATA_QUALITY_POLICY.md の手順3「新しいジャンルを1つ追加するたびに、追加済みの
 * 全ジャンル・全校に対して同じガードを再チェックする」を実行するためのもの。
 * あるジャンルで見つかった問題は既存の他ジャンルにも隠れていることが多く、実際に
 * video_editing で見つかった career_paths の穴が programming の既存レコードにもあった。
 *
 * 【AI呼び出しは一切行わない】公式サイト本文を取り直し、本文と機械的に照合するだけ。
 * そのため何度実行しても結果は安定し、APIコストもかからない。落とすべきものを落とすだけで、
 * 新しい値を作ることはない。
 *
 * 実行例:
 *   node recheck-guards.js
 *   node recheck-guards.js --dry-run     # 書き込まずに差分だけ表示
 *   RECHECK_ONLY_SCHOOL_ID=vook node recheck-guards.js
 */

const path = require('path');
const cheerio = require('cheerio');

const { verifyOfficialName, verifyCareerPaths } = require('./lib/school-discovery');
const { verifyPrefectures, filterToCampusPrefectures } = require('./lib/area-detail');
const { normalizePlans, verifyPlans, buildPriceFromPlans, fetchWithVerifyUA, DETAIL_TEXT_MAX_CHARS } = require('./lib/price-detail');
const { verifyGenres } = require('./lib/genre-verify');
const { politeDelay } = require('./lib/http');
const { SCHOOLS_PATH, readSchools, writeSchools } = require('./lib/schools-store');

const DRY_RUN = process.argv.includes('--dry-run') || Boolean(process.env.RECHECK_DRY_RUN);

/**
 * 金額の種別（total / monthly / enrollment）を本文の表記から判定する。
 *
 * 金額の直前にある「月額」「入学金」のうち、**最も近い**方を採る。「入学金無料月額74,800円」
 * を入学金と読み違えた実例があるため、includes ではなく位置で比べる。
 * どちらも見つからなければ total（一括表示が既定）とみなす。
 */
function inferKind(amount, compactText) {
  const i = compactText.indexOf(String(amount));
  if (i === -1) return null;

  const before = compactText.slice(Math.max(0, i - 20), i);
  const monthly = Math.max(before.lastIndexOf('月額'), before.lastIndexOf('月々'));
  const enrollment = before.lastIndexOf('入学金');
  if (monthly === -1 && enrollment === -1) return 'total';
  return monthly > enrollment ? 'monthly' : 'enrollment';
}

/** そのレコードの根拠になりうるページをすべて取得して連結する。 */
async function fetchEvidence(school) {
  const urls = [school.official_url, school.price_detail_url, school.area_detail_url].filter(Boolean);
  let text = '';
  for (const url of urls) {
    try {
      await politeDelay();
      const $ = cheerio.load(await fetchWithVerifyUA(url));
      $('script, style, noscript').remove();
      text += '\n' + $('body').text().replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, DETAIL_TEXT_MAX_CHARS);
    } catch (err) {
      console.warn(`  ${url} の取得に失敗: ${err.message}`);
    }
  }
  return text;
}

/**
 * 1件に全ガードを再適用する。戻り値は変更点の説明の配列（空なら変更なし）。
 * ページを取得できなかった場合は、何も変更せずに null を返す（取得失敗を
 * 「本文に無い」と解釈して値を消してしまわないため）。
 */
function recheckSchool(school, pageText) {
  const changes = [];
  const compact = pageText.replace(/[,，\s　]/g, '');

  // official_name は本文照合の対象にしない。
  //
  // 正式名称の根拠は「会社概要」ページにあることが多く（株式会社SAMURAI は /corp/、
  // 株式会社ブリューアス は /company）、このスクリプトが取得する official_url /
  // price_detail_url / area_detail_url には含まれない。ここで照合すると、根拠ページを
  // 見ていないだけなのに「本文に無い」と判定して、確認済みの値を消してしまう
  // （実際に2件消してしまい、復元した）。
  //
  // ただし「英語表記のみなら null」はページ本文を必要としない判定なので、これだけは行う。
  const beforeName = school.official_name;
  school.official_name = verifyOfficialName(school.official_name, null);
  if (beforeName !== school.official_name) changes.push(`official_name ${JSON.stringify(beforeName)} → null（英語表記のみ）`);

  // ジャンルの照合。発見時にしか掛かっていなかったため、あとから裏付け語を
  // 見直しても既存レコードに反映されなかった（音楽スクールが「生成AI・DX」のまま残った）。
  //
  // 全部落ちる場合だけは、値を消さずに印を付けて残す。ジャンルは1件以上が必須で、
  // ここで空にするとレコードごと掲載できなくなる。掲載を止めるかどうかは人が決める。
  const beforeGenres = [...(school.skill_genre || [])];
  const genreCheck = verifyGenres(beforeGenres, pageText);
  if (genreCheck.judged && genreCheck.dropped.length) {
    if (genreCheck.genres.length > 0) {
      school.skill_genre = genreCheck.genres;
      changes.push(`skill_genre ${beforeGenres.length}→${school.skill_genre.length}件（除外: ${genreCheck.dropped.join('、')}）`);
    } else {
      school.review_flags = [...new Set([...(school.review_flags || []), 'genre_unverified'])];
      changes.push(`skill_genre 本文で裏付けられません（${beforeGenres.join('、')}）— 掲載可否を要確認`);
    }
  }

  const beforePaths = [...school.career_paths];
  school.career_paths = verifyCareerPaths(school.career_paths, pageText);
  const droppedPaths = beforePaths.filter(p => !school.career_paths.includes(p));
  if (droppedPaths.length) changes.push(`career_paths ${beforePaths.length}→${school.career_paths.length}件（除外: ${droppedPaths.join('、')}）`);

  const beforeArea = [...school.area];
  school.area = filterToCampusPrefectures(verifyPrefectures(school.area, pageText), pageText);
  const droppedArea = beforeArea.filter(p => !school.area.includes(p));
  if (droppedArea.length) {
    changes.push(`area ${beforeArea.length}→${school.area.length}件（除外: ${droppedArea.join('、')}）`);
    if (school.area.length === 0 && school.format !== 'online') {
      school.format = 'online';
      school.review_flags = [...new Set([...school.review_flags, 'format_unconfirmed'])];
      changes.push('format → online（area が空になったため）');
    }
  }

  if (school.plans.length > 0) {
    const beforePrice = JSON.stringify(school.price);
    const beforePlans = school.plans.length;
    // 金額もページ本文と突き合わせ直す。発見時にしか掛かっていなかったため、
    // 照合を厳しくしても既存レコードには反映されなかった
    // （ドル建ての金額が「月額178円」として残っていた）。
    school.plans = verifyPlans(school.plans, pageText);
    if (school.plans.length !== beforePlans) {
      changes.push(`plans ${beforePlans}→${school.plans.length}件（本文で確認できない金額を除外）`);
    }
    school.plans = normalizePlans(school.plans.map(p => ({ ...p, kind: p.kind || inferKind(p.amount, compact) })));
    school.price = buildPriceFromPlans(school.plans, school.price.scope);
    if (JSON.stringify(school.price) !== beforePrice) {
      changes.push(`price ${beforePrice} → ${JSON.stringify(school.price)}`);
    }
  }

  return changes;
}

async function main() {
  const onlyId = (process.env.RECHECK_ONLY_SCHOOL_ID || '').trim();
  const schools = readSchools();
  const targets = schools.filter(s => !onlyId || s.id === onlyId);

  console.log(`Re-checking guards for ${targets.length} school(s)${DRY_RUN ? ' [DRY RUN — 書き込みません]' : ''}...\n`);

  let changed = 0;
  let unreachable = 0;

  for (const school of targets) {
    const pageText = await fetchEvidence(school);
    if (!pageText.trim()) {
      console.log(`[${school.id}] ページを取得できませんでした。値は一切変更しません。`);
      unreachable += 1;
      continue;
    }

    const changes = recheckSchool(school, pageText);
    if (changes.length === 0) {
      console.log(`[${school.id}] ${school.school_name} — 変更なし`);
      continue;
    }

    school.updated_at = new Date().toISOString();
    changed += 1;
    console.log(`[${school.id}] ${school.school_name}`);
    for (const change of changes) console.log(`    - ${change}`);
  }

  console.log(`\n再チェック完了: ${targets.length}件中 ${changed}件を修正、${unreachable}件は取得失敗でスキップ。`);

  if (DRY_RUN) {
    console.log('[DRY RUN] 書き込みをスキップしました。');
    return;
  }
  if (changed > 0) {
    writeSchools(schools);
    console.log(`Wrote updates to ${path.basename(SCHOOLS_PATH)}.`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, recheckSchool, inferKind };
