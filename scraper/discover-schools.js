'use strict';

/**
 * 日次で、新規のスクール・講座をClaude(web_search)にジャンル別に発見させ、実際に
 * HTTPアクセスして実在照合したうえで data/schools.json に追加するエントリーポイント。
 *
 * 【安全設計】lib/school-discovery.js の discoverCandidates() が、ジャンルごとの
 * web_search呼び出しと実在照合(verifyCandidate)までを内部で一貫して行う。この2段階
 * 方式を経ていない候補は絶対に掲載しない（freelance-anken-zukan の discover-agents.js と同じ原則）。
 * 不一致・fetch失敗は data/school-discover-skip.json に記録し、以降の実行では除外リストに
 * 含めて再試行しない（reverify-old-skips.js が一定期間後にまとめて再検証する）。
 *
 * 【status】承認フェーズは設けない。二段階検証を通過したレコードは、その時点で
 * status:"active" として保存し、そのままサイト表示・診断ウィザードの候補に入る。
 * 代わりに、その回で新しく active 化されたIDを data/discovery-log/YYYY-MM-DD.json に
 * 記録として残す（lib/discovery-log.js。承認UI・通知は持たない）。
 * skill_genre[] / purpose[] / target_level / career_paths[] は公式サイト本文からのAI推定の
 * ままなので、精度の確認はこのログを手がかりに事後で行う。
 *
 * 実行例:
 *   node discover-schools.js                       # DISCOVER_GENRES 未指定なら programming のみ
 *   DISCOVER_GENRES=programming,webdesign node discover-schools.js
 *   DISCOVER_GENRES=all DISCOVER_MAX_PER_RUN=20 node discover-schools.js
 */

const path = require('path');

const {
  discoverCandidates,
  buildDiscoveredSchoolFields,
  getAnthropicClient,
} = require('./lib/school-discovery');
const { GENRE, GENRE_LABELS } = require('./lib/schema');
const { buildSchoolId, buildClickTrackingId } = require('./lib/school-id');
const { validateSchool } = require('./lib/validate');
const { writeDiscoveryLog } = require('./lib/discovery-log');
const { enrichPriceFromDetailPage } = require('./lib/price-detail');
const { enrichAreaFromDetailPage, needsAreaEnrichment } = require('./lib/area-detail');
const {
  SCHOOLS_PATH,
  SKIP_PATH,
  readSchools,
  readSkipList,
  writeSchools,
  writeSkipList,
} = require('./lib/schools-store');

/** 1回の実行あたりに新規発見を試みる候補数の上限。環境変数で調整可能。 */
const MAX_PER_RUN = Number(process.env.DISCOVER_MAX_PER_RUN || 10);

/**
 * 対象ジャンル。既存2サイトの教訓（いきなり全件を回さず、まず1つで挙動を確かめてから
 * 増やす）に従い、既定は programming の1ジャンルのみ。"all" で全8ジャンル。
 */
function targetGenres() {
  const raw = (process.env.DISCOVER_GENRES || 'programming').trim();
  if (raw === 'all') return [...GENRE];

  const requested = raw.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = requested.filter(g => !GENRE.includes(g));
  if (unknown.length > 0) {
    throw new Error(`DISCOVER_GENRES に未知のジャンルが含まれています: ${unknown.join(', ')}`);
  }
  if (requested.length === 0) {
    throw new Error('DISCOVER_GENRES が空です。');
  }
  return requested;
}

/**
 * 実在照合＋構造化済みの候補を School レコードに組み立てる。
 *
 * - cta_url / cta_type は、A8等のアフィリエイト提携が取れるまでは official_url と同一の
 *   "direct" とする（提携後にインポート側で上書きする想定）。
 * - review_summary は発見時点では必ず null。口コミ要約は summarize-reviews.js が別途、
 *   出典URLとセットでのみ埋める（出典の無い要約を絶対に作らないため）。
 * - official_url には、AIが提示したURLではなく verifyCandidate() が実際にアクセスできた
 *   URL（verifiedUrl）を使う。AI提示値はパス・www.の有無が誤っていることがあるため。
 */
function assembleDiscoveredSchool(candidate, ai, id, verifiedUrl, genre) {
  const now = new Date().toISOString();
  const officialUrl = verifiedUrl || candidate.website;

  return {
    id,
    school_name: ai.school_name || candidate.name,
    official_name: ai.official_name,
    description: ai.description,
    skill_genre: ai.skill_genre,
    purpose: ai.purpose,
    target_level: ai.target_level,
    career_paths: ai.career_paths,
    price: ai.price,
    duration: ai.duration,
    format: ai.format,
    area: ai.area,
    area_source: ai.area_source || 'top_page',
    subsidy_eligible: ai.subsidy_eligible,
    career_support: ai.career_support,
    features: ai.features,
    review_summary: null,
    review_source_urls: [],
    // 自動抽出の確度が低い箇所の目印（classifyFormat 等が立てる）。UI表示には使わない。
    review_flags: ai.review_flags || [],
    ...(ai.detail_page_url ? { detail_page_url: ai.detail_page_url } : {}),
    official_url: officialUrl,
    cta_url: officialUrl,
    cta_type: 'direct',
    click_tracking_id: buildClickTrackingId(id),
    created_at: now,
    updated_at: now,
    // 二段階検証を通過した時点で掲載可とする（承認フェーズなし）。
    status: 'active',
    source: 'ai-discovered',
    source_note: `AIによるWeb検索(${GENRE_LABELS[genre] || genre})で発見・実在照合済み`,
    verified_url: officialUrl,
  };
}

/**
 * 実行開始時点で1回だけ、ANTHROPIC_API_KEY の設定を確認する。
 *
 * discoverCandidates() はジャンル単位で例外を握りつぶす（1ジャンルの一時的な失敗で
 * 実行全体を落とさないため）。この設計自体は正しいが、APIキー未設定は一時的な失敗では
 * なく設定ミスであり、同じ経路で握りつぶすと「found=0, listed=0 で正常終了」という
 * 静かな成功になってしまう。日次cronでそれが起きると、毎朝グリーンのまま何も収集
 * されない状態が続き、気づくのが遅れる。
 *
 * そのため、ジャンルごとの検索呼び出しに入る前にここで確実に落とす。
 * ジャンル単位の try/catch 側には手を入れない（一時的な失敗の扱いはそのままでよい）。
 */
function assertApiKeyConfigured() {
  if (process.env.ANTHROPIC_API_KEY) return;

  const message = 'ANTHROPIC_API_KEY is not set. Aborting before any per-genre search calls.';
  // "::error::" は GitHub Actions のログでエラー注釈として赤く表示される。
  console.error(`::error::${message}`);
  console.error(
    'ワークフローで実行している場合は、リポジトリの Actions secrets に設定してください:\n' +
      '  gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>'
  );

  const err = new Error(message);
  // 下のCLIハンドラで、スタックトレースを重ねて出さないための目印。
  err.preflight = true;
  throw err;
}

async function main() {
  assertApiKeyConfigured();

  const genres = targetGenres();
  const schools = readSchools();
  const skipList = readSkipList();

  const excludeNames = [
    ...schools.map(s => s.school_name).filter(Boolean),
    ...Object.keys(skipList),
  ];

  console.log(
    `Discovering up to ${MAX_PER_RUN} new school candidate(s) across ${genres.length} genre(s) ` +
      `[${genres.join(', ')}] (excluding ${excludeNames.length} known name(s): ` +
      `${schools.length} listed + ${Object.keys(skipList).length} skip-listed)...`
  );

  const { verified, skipped, perGenre } = await discoverCandidates(genres, excludeNames, MAX_PER_RUN);
  const totalFound = perGenre.reduce((sum, g) => sum + g.found, 0);
  console.log(
    `AI proposed ${totalFound} candidate(s) via web_search across ${perGenre.length} genre(s), ` +
      `${verified.length} passed verification.`
  );

  const now = new Date().toISOString();
  for (const { candidate, genre, reason } of skipped) {
    skipList[candidate.name] = {
      name: candidate.name,
      website: candidate.website,
      genre,
      reason,
      checkedAt: now,
    };
  }
  if (skipped.length > 0) {
    console.log(`Recorded ${skipped.length} skipped candidate(s) in ${path.basename(SKIP_PATH)}, will not retry until reverify-old-skips.js picks them up.`);
  }

  let listedCount = 0;
  // その回で新しく active 化されたIDを、日次の記録（data/discovery-log/）用に集める。
  const newlyListed = [];

  if (verified.length > 0) {
    const anthropic = getAnthropicClient();
    const existingIds = new Set(schools.map(s => s.id));

    for (const { candidate, genre, pageText, html, verifiedUrl, thinContent } of verified) {
      console.log(`Structuring verified candidate: ${candidate.name} <${candidate.website}>${thinContent ? ' (thin content)' : ''}`);

      let ai;
      try {
        ai = await buildDiscoveredSchoolFields(candidate, pageText, anthropic, genre, thinContent);
      } catch (err) {
        // 実在は確認済みだが構造化AI呼び出し自体が失敗（レート制限等）した場合は
        // スキップリストに入れず、次回の実行で再試行する。
        console.warn(`  Structuring failed for ${candidate.name}: ${err.message}. Will retry next run.`);
        continue;
      }

      // トップページで料金を取得できなかった場合だけ、詳細ページを1回だけ見に行く
      // （全校で下層ページを辿ると無駄なリクエストになるため、フォールバックに留める）。
      if (ai.price.min_yen === null) {
        const enrichment = await enrichPriceFromDetailPage(
          ai.school_name || candidate.name,
          html,
          verifiedUrl || candidate.website,
          anthropic
        );
        if (enrichment.price && enrichment.price.min_yen !== null) {
          ai.price = enrichment.price;
          // 詳細ページ1枚から得た価格は、そのスクール全体の最安値とは限らない。
          ai.review_flags = [...(ai.review_flags || []), 'price_scope_limited'];
        }
        if (enrichment.detailPageUrl) ai.detail_page_url = enrichment.detailPageUrl;
        ai.review_flags = [...(ai.review_flags || []), ...enrichment.flags];
      }

      // 受講形式を確定できなかった場合だけ、校舎一覧・アクセスページを1回だけ見に行く
      // （price と同じフォールバック方式。全校一律では巡回しない）。
      if (needsAreaEnrichment({ area: ai.area, review_flags: ai.review_flags }, pageText)) {
        const areaResult = await enrichAreaFromDetailPage(
          ai.school_name || candidate.name,
          html,
          verifiedUrl || candidate.website,
          anthropic
        );
        ai.area = areaResult.area;
        ai.format = areaResult.format;
        ai.area_source = areaResult.areaSource;
        // 確定できたなら format_unconfirmed は不要。できなければ area_unconfirmed に置き換える。
        const flags = new Set((ai.review_flags || []).filter(f => f !== 'format_unconfirmed'));
        for (const flag of areaResult.flags) flags.add(flag);
        ai.review_flags = [...flags];
      }

      const id = buildSchoolId(ai.school_name || candidate.name, verifiedUrl || candidate.website, existingIds);
      const entry = assembleDiscoveredSchool(candidate, ai, id, verifiedUrl, genre);

      // 1件単位でも検証しておき、不正なレコードはその1件だけを落とす
      // （writeSchools() の全件検証で実行全体が落ちるのを避けるため）。
      const { ok, errors } = validateSchool(entry);
      if (!ok) {
        console.warn(`  SKIPPED (schema invalid) ${candidate.name}: ${errors.join(' / ')}`);
        skipList[candidate.name] = {
          name: candidate.name,
          website: candidate.website,
          genre,
          reason: 'schema_invalid',
          checkedAt: now,
        };
        continue;
      }

      existingIds.add(id);
      schools.push(entry);
      newlyListed.push({ id: entry.id, genre });
      listedCount += 1;
      console.log(
        `  LISTED as id=${entry.id}, genre=${entry.skill_genre.join('/')}, ` +
          `purpose=${entry.purpose.join('/')}, level=${entry.target_level}, status=${entry.status}`
      );
    }
  }

  if (listedCount > 0) {
    // 掲載データの書き込みが成功してからログを書く（schools.json に入っていないIDを
    // 「新規掲載」として記録しないため。writeSchools はスキーマ検証に失敗すると投げる）。
    writeSchools(schools);
    console.log(`Wrote ${listedCount} new record(s) to ${path.basename(SCHOOLS_PATH)}.`);

    const logPath = writeDiscoveryLog(newlyListed);
    if (logPath) console.log(`Recorded ${newlyListed.length} newly listed id(s) in ${path.relative(process.cwd(), logPath)}.`);
  }
  if (skipped.length > 0 || Object.keys(skipList).length > 0) {
    writeSkipList(skipList);
  }

  console.log('--- Genre breakdown ---');
  for (const g of perGenre) {
    console.log(`${g.label}: 発見${g.found}件・照合成功${g.listed}件・スキップ${g.skipped}件`);
  }

  const activeCount = schools.filter(s => s.status === 'active').length;
  console.log(
    `Discovery finished: found=${totalFound}, listed=${listedCount}, skipped=${skipped.length}. ` +
      `掲載中(active)は合計${activeCount}件です。`
  );
}

if (require.main === module) {
  main().catch(err => {
    // 事前チェック（assertApiKeyConfigured）は既に読みやすいメッセージを出しているので、
    // スタックトレースを重ねない。それ以外は原因調査のためそのまま出す。
    if (!err.preflight) console.error(err);
    process.exit(1);
  });
}

module.exports = { main, assertApiKeyConfigured, targetGenres, assembleDiscoveredSchool, MAX_PER_RUN };
