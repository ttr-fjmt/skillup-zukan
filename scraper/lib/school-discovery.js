'use strict';

/**
 * 新規のスクール・講座をClaude(web_search)にジャンル別に発見させ、実際にその公式サイトへ
 * HTTPアクセスして実在照合したうえで掲載候補として採用するための2段階パイプライン。
 *
 * freelance-anken-zukan の lib/agent-discovery.js の構造をそのまま踏襲している
 * （図鑑4-2の教訓: AIの「実在する」という自己申告を無条件に信用しない）。
 *
 *   1段階目 searchGenreCandidates(): Claude API に web_search ツールで実際にWeb検索
 *     させ、既存に無い新規候補（スクール名+公式サイトURL）のみを回答させる。
 *     ジャンルごとに lib/discovery-queries.js の切り口を渡し、1本の広いクエリで
 *     頭打ちになるのを避ける。
 *   2段階目 verifyCandidate(): 候補ごとに実際に公式サイトへHTTPリクエストを送り、
 *     取得できたページ本文にスクール名（法人格・サービス種別を除いた主要部分）が
 *     実在するか機械的に照合する。一致しなければ不採用（呼び出し側でスキップリストに記録）。
 *
 * 本サイト固有の追加点として、3段階目に相当する buildDiscoveredSchoolFields() で
 * skill_genre[] / purpose[] / target_level / career_paths[] を推定させる。承認フェーズは
 * 設けず、二段階検証を通った候補は呼び出し側（discover-schools.js）が status:"active" と
 * して保存する。そのぶんAIの推定が直接サイトに出るため、このモジュールの側で
 * normalizeStructuredFields() による丸め込みと「本文に無いことは埋めない」指示を厚くしている。
 */

const cheerio = require('cheerio');
const { politeDelay, fetchWithVerifyUA } = require('./http');
const { candidateNameCores, schoolNameCore } = require('./name-core');
const {
  GENRE,
  PURPOSE,
  LEVEL,
  FORMAT,
  GENRE_LABELS,
  PREFECTURES,
  NOT_DISCLOSED_TEXT,
} = require('./schema');
const { queriesForGenre } = require('./discovery-queries');
const { verifyPlans, buildPriceFromPlans, normalizePlans } = require('./price-detail');
// 都道府県の照合ロジックは area フォールバックと共有する（同じ基準で判定するため）。
const { verifyPrefectures, filterToCampusPrefectures } = require('./area-detail');
const { portalMarkers, agencyScore } = require('./portal-filter');

const DISCOVERY_MODEL = process.env.ANTHROPIC_DISCOVERY_MODEL || 'claude-sonnet-4-6';
const STRUCTURE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/** 1ジャンルあたりの検索呼び出しで、AIに提案させる候補数の上限（軽量な呼び出しに留めるため）。 */
const PER_GENRE_SEARCH_LIMIT = 12;

/** 構造化AIのプロンプトに渡すページ本文抽出テキストの上限文字数。 */
const PAGE_TEXT_MAX_CHARS = 6000;

/**
 * pageTextの文字数がこれ未満の場合、実在照合自体はok:trueのまま thinContent:true を
 * 付与する（タイトルのみ・ボット検知エラー・リダイレクトスタブ等、実在はしているが
 * 本文からの特徴抽出には情報量が不足しているケースを検知するため）。
 */
const MIN_CONTENT_LENGTH = 200;

/** ANTHROPIC_API_KEY が無い場合は呼び出し時点で明確に例外を投げる。 */
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey });
}

/**
 * AIの応答テキストから、前後の説明文やコードフェンスを無視してJSON配列だけを堅牢に
 * 抽出する。最初の "[" から最後の "]" までを切り出してパースする方式。
 */
function extractJsonArray(text) {
  if (typeof text !== 'string') return [];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    console.error('school-discovery: AI応答からJSON配列を検出できませんでした:', text);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    console.error('school-discovery: JSON配列のパースに失敗しました:', err.message);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(c => c && typeof c.name === 'string' && typeof c.website === 'string');
}

/** usage をログに出す共通処理（プロンプトキャッシュの効きを実行ログで追えるようにする）。 */
function logCacheUsage(label, usage = {}) {
  console.log(
    `[ai:cache] ${label} input=${usage.input_tokens || 0} ` +
      `cache_write=${usage.cache_creation_input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );
}

/**
 * 発見プロンプトのうち、ジャンルによらず共通の「ルール部分」。
 * cache_control をこのブロックの末尾に置くことで、ジャンルループの2回目以降は
 * この共通部分がキャッシュから読まれる（structure.js の tools への cache_control と同じ狙い）。
 * ジャンル固有の内容（ラベル・クエリ・除外リスト）は必ずこの後ろのブロックに置くこと。
 */
const DISCOVERY_COMMON_RULES =
  '日本国内で、社会人・学生が受講できるスクール・講座・オンライン学習サービスを、' +
  'Web検索を使って実在するものだけ探すタスクです。\n\n' +
  '共通の条件:\n' +
  '- 検索で実在を確認できたサービスのみ回答すること。知識だけで推測したり、' +
  '実在確認ができないスクールを創作しないこと\n' +
  '- 個人ブログ・まとめ記事・アフィリエイトサイトそのものではなく、講座を実際に' +
  '提供しているスクール/サービス自体を対象にすること\n' +
  '- 他社・個人の講座を集めて掲載しているポータル・講座検索サイト・マーケットプレイスは' +
  '対象外（例: 講座を検索するためのポータル、個人講師が講座を出品する場）。' +
  '自社で講座を提供しているスクールだけを回答すること\n' +
  '- 大学・専門学校の正規課程（入学試験を要する学位課程）は対象外。社会人・学生が' +
  '任意に受講できる講座・スクール・オンライン学習サービスを対象にすること\n' +
  '- websiteには、まとめ記事からのアフィリエイトリンク・短縮URLではなく、' +
  'そのスクール自体の公式サイトのURLを回答すること\n' +
  '- 検索が終わったら、最後に必ず以下の形式のJSON配列のみを出力すること' +
  '（前後に説明文やコードフェンスを付けないこと）。\n' +
  '[{"name": "スクール名", "website": "公式サイトURL"}, ...]\n' +
  '- 該当なしの場合は空配列[]を出力すること。\n';

/**
 * 指定した1ジャンルについてのみ、Claude API に web_search ツールで実際に検索させ、
 * 候補スクールを返す（スクール名+公式サイトURL）。discoverCandidates() のジャンル
 * ループから呼ばれる、軽量な単位の検索呼び出し。
 */
async function searchGenreCandidates(genre, excludeNames) {
  const anthropic = getAnthropicClient();
  const { label, queries } = queriesForGenre(genre);

  const response = await anthropic.messages.create({
    model: DISCOVERY_MODEL,
    max_tokens: 1500,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: DISCOVERY_COMMON_RULES,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text:
            `今回の対象ジャンル: 「${label}」\n\n` +
            '次の検索の切り口を、表現を変えながら複数回実際に検索してください' +
            '（同じクエリを1回投げるだけで終わらせないこと）:\n' +
            queries.map(q => `- ${q}`).join('\n') +
            `\n\n最大${PER_GENRE_SEARCH_LIMIT}件まで回答してください。\n\n` +
            '除外リスト(既に掲載済み・既に他ジャンルで見つかった、これらは含めない): ' +
            (excludeNames.length ? excludeNames.join('、') : '(なし)'),
        },
      ],
    }],
  });

  logCacheUsage(`[discover:${genre}]`, response.usage);

  const textBlocks = response.content.filter(b => b.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) {
    console.error(`school-discovery: [${genre}] AI応答にtextブロックが含まれていませんでした。`);
    return [];
  }
  return extractJsonArray(lastText.text);
}

/** candidate.website を https/http の順で1回ずつ試すためのURL候補を組み立てる（パスはそのまま維持）。 */
function candidateFetchUrls(website) {
  let url;
  try {
    url = new URL(website.includes('://') ? website : `https://${website}`);
  } catch {
    return [];
  }
  const urls = [url.toString()];
  if (url.protocol === 'https:') {
    const httpUrl = new URL(url.toString());
    httpUrl.protocol = 'http:';
    urls.push(httpUrl.toString());
  }
  return urls;
}

/**
 * パス指定が404・DNS解決失敗等で使えなかった場合のフォールバック用に、オリジン
 * （トップページ）のURL候補を組み立てる。AIが提示したURLがパス違い（削除済みLP等）や
 * www.の有無違いで、トップページ自体は正常に存在するケースがあるため。
 */
function candidateRootUrls(website) {
  let url;
  try {
    url = new URL(website.includes('://') ? website : `https://${website}`);
  } catch {
    return [];
  }
  const hosts = [url.host, url.host.startsWith('www.') ? url.host.slice(4) : `www.${url.host}`];
  const urls = [];
  for (const host of hosts) {
    urls.push(`${url.protocol}//${host}/`);
    if (url.protocol === 'https:') urls.push(`http://${host}/`);
  }
  return urls;
}

function buildPageText(rawBodyText) {
  return rawBodyText
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, PAGE_TEXT_MAX_CHARS);
}

/**
 * urls を順番に試し、最初にfetchが成功したURLの内容で名称照合を行う（fetch自体が
 * 失敗した場合のみ次のURLへフォールバックする）。全URLでfetchが失敗した場合は { error }。
 */
async function tryUrlsForMatch(urls, nameCores) {
  let lastError = null;
  for (const url of urls) {
    await politeDelay();
    try {
      const html = await module.exports.fetchWithVerifyUA(url);
      const $ = cheerio.load(html);
      // script/styleの中身はページ本文ではないため、照合・本文抽出のどちらからも除く。
      $('script, style, noscript').remove();
      const titleText = $('title').text();
      const rawBodyText = $('body').text();
      const matchText = `${titleText} ${rawBodyText}`.replace(/[\s　]+/g, '');
      const matched = nameCores.some(core => matchText.includes(core));
      // html も返すのは、料金の詳細ページを探すためのリンク抽出に使うため
      // （同じページをもう一度取得しに行かないで済むようにする）。
      return { matched, url, html, pageText: buildPageText(rawBodyText) };
    } catch (err) {
      lastError = err;
    }
  }
  return { error: lastError ? lastError.message : 'unknown error' };
}

function verificationResult(attempt) {
  return attempt.matched
    ? {
        ok: true,
        verifiedUrl: attempt.url,
        pageText: attempt.pageText,
        html: attempt.html,
        thinContent: attempt.pageText.length < MIN_CONTENT_LENGTH,
      }
    : { ok: false, reason: 'name_mismatch' };
}

/**
 * candidate.website へ実際にHTTPリクエストを送り、取得できたページ本文に candidate.name
 * （法人格・サービス種別を除いた主要部分）が実在するかを機械的に照合する。
 *
 * 1. まず記録されたURL（パスそのまま、https→http）を試す。fetchに成功した時点で、
 *    名称が一致すれば ok:true、一致しなければ name_mismatch で確定する（パスが生きて
 *    いるなら、そのページの内容で判定するのが筋のため、ここではルートへ落とさない）。
 * 2. パスありの全URLでfetch自体が失敗した場合（404・DNS解決失敗・タイムアウト等）
 *    のみ、オリジン（トップページ）へフォールバックする。
 */
async function verifyCandidate(candidate) {
  const nameCores = candidateNameCores(candidate.name);
  if (nameCores.length === 0) return { ok: false, reason: 'name_mismatch' };

  const pathUrls = candidateFetchUrls(candidate.website);
  if (pathUrls.length === 0) return { ok: false, reason: 'fetch_failed' };

  const pathAttempt = await tryUrlsForMatch(pathUrls, nameCores);
  if (pathAttempt.matched !== undefined) return verificationResult(pathAttempt);

  const rootUrls = candidateRootUrls(candidate.website).filter(u => !pathUrls.includes(u));
  if (rootUrls.length === 0) {
    return { ok: false, reason: 'fetch_failed', error: pathAttempt.error };
  }

  const rootAttempt = await tryUrlsForMatch(rootUrls, nameCores);
  if (rootAttempt.matched !== undefined) return verificationResult(rootAttempt);

  return { ok: false, reason: 'fetch_failed', error: rootAttempt.error || pathAttempt.error };
}

/**
 * 重複判定用に、URLからホスト名を取り出す（www. のみ無視する）。
 *
 * 登録可能ドメイン（dhw.co.jp）まで丸めるとサブドメインで別ブランドを運営している
 * ケースまで同一視してしまうため、実際に起きた誤り（同じ www.sejuku.net が
 * 「SAMURAI ENGINEER」と「侍エンジニア」の2件になった）を防げる最小限に留める。
 */
function normalizedHost(url) {
  try {
    const raw = String(url).includes('://') ? url : `https://${url}`;
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
/**
 * 1回の検索呼び出しで見つかった候補群を、既存の除外セットと突き合わせて重複を除き、
 * maxCandidates上限まで verifyCandidate() まで通す共通処理。
 * verified/skipped/perGenre へは呼び出し元の配列へ直接pushする。
 */
async function collectVerifiedCandidates(rawCandidates, genre, excludeCores, maxCandidates, verified, skipped, perGenre, excludeHosts = new Set()) {
  let found = 0;
  let listed = 0;
  let skippedInGenre = 0;

  for (const candidate of rawCandidates) {
    const core = schoolNameCore(candidate.name);
    if (excludeCores.has(core)) continue; // 既存掲載・他ジャンルとの重複（名前による判定）
    // 同じサイトが別名で再発見されることがある。webdesign ジャンルで「侍エンジニア」が
    // 既存の「SAMURAI ENGINEER」（同じ sejuku.net）とは別物として掲載され、同一サイトの
    // レコードが2件できた。名前は表記が変わりうるので、ドメインでも重複を弾く。
    const host = normalizedHost(candidate.website);
    if (host && excludeHosts.has(host)) {
      console.log(`school-discovery: [${GENRE_LABELS[genre] || genre}] ${candidate.name} は既存掲載と同じサイト(${host})のためスキップします。`);
      continue;
    }
    excludeCores.add(core);
    if (host) excludeHosts.add(host);
    found += 1;

    if (verified.length >= maxCandidates) {
      // 上限到達後は、他に見つかっていた候補についても実在照合(HTTP)を行わない。
      continue;
    }

    const verification = await module.exports.verifyCandidate(candidate);

    // 実在はしていても、他社の講座を集めたポータル・マーケットプレイスは掲載しない
    // （講座ごとに料金も期間も違い、この図鑑の比較軸が埋まらないため）。
    if (verification.ok) {
      const markers = portalMarkers(verification.pageText);
      if (markers.length > 0) {
        console.log(
          `school-discovery: [${GENRE_LABELS[genre] || genre}] ${candidate.name} は講座ポータル/マーケットプレイスとみなしてスキップします（該当語: ${markers.join('、')}）。`
        );
        skipped.push({ candidate, genre, reason: 'portal_or_marketplace' });
        skippedInGenre += 1;
        continue;
      }

      // 本業が制作代行・運用代行・コンサルティングの会社も外す。
      // ポータル判定では素通りしていた（StockSun株式会社の例）。
      const agency = agencyScore(verification.pageText);
      if (agency.isAgency) {
        console.log(
          `school-discovery: [${GENRE_LABELS[genre] || genre}] ${candidate.name} は受注ビジネスが主とみなしてスキップします` +
            `（スクール語 ${agency.school}回 / 受注語 ${agency.agency}回）。`
        );
        skipped.push({ candidate, genre, reason: 'agency_not_school' });
        skippedInGenre += 1;
        continue;
      }
    }

    if (verification.ok) {
      verified.push({
        candidate,
        genre,
        pageText: verification.pageText,
        html: verification.html,
        verifiedUrl: verification.verifiedUrl,
        thinContent: verification.thinContent,
      });
      listed += 1;
    } else {
      skipped.push({ candidate, genre, reason: verification.reason });
      skippedInGenre += 1;
    }
  }

  const label = GENRE_LABELS[genre] || genre;
  perGenre.push({ genre, label, found, listed, skipped: skippedInGenre });
  console.log(`school-discovery: [${label}] 発見${found}件・照合成功${listed}件・スキップ${skippedInGenre}件`);
}

/**
 * 対象ジャンルを順番にループし、ジャンルごとに searchGenreCandidates() で発見した候補を
 * その場で verifyCandidate() まで通す（AIの自己申告を無条件に信用しない、という2段階
 * 方式の原則をここでも維持する）。
 *
 * - 見つかった候補はジャンルをまたいで重複させないよう、都度 excludeCores に追加する。
 * - 累計の実在照合成功数が maxCandidates に達したら、以降のジャンルの検索呼び出し自体を
 *   スキップして終了する（無駄なAPI呼び出しを避けるため）。
 * - 内部の searchGenreCandidates / verifyCandidate 呼び出しは、テストでの差し替え（モック）
 *   を可能にするため、必ず module.exports 経由で行う。
 *
 * genres は「まず1ジャンルだけ試す」運用（既存2サイトと同じく、いきなり全ジャンルを
 * 回さない）ができるよう、呼び出し側から明示的に渡す。
 */
async function discoverCandidates(genres, excludeNames, maxCandidates, excludeUrls = []) {
  const excludeCores = new Set((excludeNames || []).map(n => schoolNameCore(n)));
  const excludeHosts = new Set((excludeUrls || []).map(u => normalizedHost(u)).filter(Boolean));
  const verified = [];
  const skipped = [];
  const perGenre = [];

  for (const genre of genres) {
    if (verified.length >= maxCandidates) {
      console.log(`school-discovery: 上限(${maxCandidates}件)に到達したため、残りのジャンルの検索をスキップします。`);
      break;
    }

    let rawCandidates;
    try {
      rawCandidates = await module.exports.searchGenreCandidates(genre, [...excludeCores]);
    } catch (err) {
      console.warn(`school-discovery: [${genre}] Web検索呼び出しに失敗しました: ${err.message}`);
      perGenre.push({ genre, label: GENRE_LABELS[genre] || genre, found: 0, listed: 0, skipped: 0 });
      continue;
    }

    await collectVerifiedCandidates(rawCandidates, genre, excludeCores, maxCandidates, verified, skipped, perGenre, excludeHosts);
  }

  return { verified, skipped, perGenre };
}

/**
 * 実在照合済みの候補について、公式サイト本文から掲載用フィールドを抽出する
 * （tool-forced パターン。enumはすべて lib/schema.js のマスタから動的に生成するので、
 * マスタを変えればツール定義側も自動で追従する）。
 *
 * 「本文に書いてあることの抽出」であって「作文」ではない、という原則を守らせるため、
 * 読み取れない項目は正直に null / 空配列 / false を返させる。特に subsidy_eligible ・
 * career_support は、明記が無いのに true にすると事実と異なる訴求になるため、
 * 「明記がある場合のみ true」と強く指示する。
 */
async function buildDiscoveredSchoolFields(candidate, pageText, anthropic, genreHint, thinContent = false) {
  const tool = {
    name: 'structure_discovered_school',
    description:
      'スキルアップ図鑑サイトのスキーマに沿って、Web検索で発見し実在照合済みのスクール・講座の' +
      '公式サイト本文を、事実の抽出・要約として構造化する。',
    input_schema: {
      type: 'object',
      properties: {
        school_name: {
          type: 'string',
          description: 'ページ本文・タイトルから読み取れる、実際のスクール/講座の名称（装飾やキャッチコピーを含めない）。',
        },
        official_name: {
          type: ['string', 'null'],
          description:
            '運営会社の正式名称。ページ本文に書かれている表記を一字一句そのまま抜き出すこと。' +
            '「会社名」「商号」「運営会社」等の項目として明示されている場合のみ回答し、' +
            'それが無ければ null とする。\n' +
            '禁止事項:\n' +
            '- 英語表記（"Foo, Inc." "Foo Co., Ltd." 等）しか見つからない場合に、' +
            '「株式会社Foo」のような日本語の法人格を補って合成すること。' +
            'この場合は必ず null を返す（英語表記をそのまま返すのも不可）。\n' +
            '- フッターの著作権表記（"© 2026 Foo, Inc." 等）を運営会社名の根拠に使うこと。' +
            '著作権表記はサービス名やブランド名であることが多く、法人の正式名称とは限らない。\n' +
            '- カタカナ⇔英字の変換、法人格の位置（前株・後株）の推測、実在の企業名の記憶からの補完。\n' +
            '正式名称は誤ると実在の法人についての誤情報になるため、少しでも不確かなら null を選ぶこと。',
        },
        description: {
          type: 'string',
          description:
            '100〜200字程度の概要文。本文の抽出・要約であること。原文の丸写しはしないこと。\n' +
            'features と同じ基準を適用する。次のものは本文に書かれていても description に含めない:\n' +
            '- 検証不能な統計的数値主張（「継続率97.9%」「満足度98%」「転職成功率99%」等）\n' +
            '- 実績訴求（「10万人以上の受講生を輩出」「導入企業900社以上」等）\n' +
            '- 最上級・優位性の主張（「日本初」「業界No.1」等）\n' +
            '- 金銭的コミットメント文言（「転職保証」「返金保証」等）\n' +
            'これらを除いたうえで、カリキュラム内容・受講形式・サポート形態・講師の属性・' +
            '対象者といった客観的事実で構成すること。該当する事実が少なければ短くてよい' +
            '（100字を下回っても構わない）。無理に文字数を埋めたり、本文に無い内容を' +
            '足したりしないこと。本文から具体的な内容が読み取れない場合のみ、定型文を返すこと。',
        },
        skill_genre: {
          type: 'array',
          items: { type: 'string', enum: GENRE },
          minItems: 1,
          description:
            `次の文字列のいずれかのみを使うこと（新しい値を作らない）: ${GENRE.join(', ')}。` +
            'ページ本文で実際に提供が確認できるジャンルのみを挙げること。幅広く扱っていても、' +
            '本文に根拠が無いジャンルを足さないこと。',
        },
        purpose: {
          type: 'array',
          items: { type: 'string', enum: PURPOSE },
          minItems: 1,
          description:
            `次の文字列のいずれかのみを使うこと: ${PURPOSE.join(', ')}。` +
            'ページ本文が実際に訴求している受講目的（転職支援を謳っていれば career_change、' +
            '副業案件の獲得を謳っていれば side_job 等）のみを挙げること。',
        },
        target_level: {
          type: 'string',
          enum: LEVEL,
          description:
            `次の文字列のいずれか1つ: ${LEVEL.join(', ')}。ページ本文が主に想定している受講者レベル。` +
            '「未経験歓迎」なら beginner。明確な記載が無い場合は beginner を選ぶこと。',
        },
        career_paths: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description:
            'ページ本文に、受講後の想定進路・目指せる職種として実際に記載されている職種名' +
            '（例: "フロントエンドエンジニア", "動画クリエイター"）。記載が無ければ空配列 []。',
        },
        price_plans: {
          type: 'array',
          description:
            'ページ本文に記載されているプラン・コースと、その金額の一覧。' +
            '表示用の文章は作らないこと（display はこちらで機械的に組み立てる）。' +
            '本文に金額の記載が無ければ空配列 [] を返すこと（金額を推測しない）。\n' +
            '同一のプラン（コース名・期間等が同じもの）について通常価格と割引後価格が併記されて' +
            'いる場合は、通常価格のみを含めること。割引後価格は抽出対象から除外し、label を変えて' +
            '別プランとして列挙しないこと。\n' +
            '判断基準:\n' +
            '- 「通常◯◯円 → キャンペーン価格△△円」のような表記 → 通常価格のみ採用\n' +
            '- 「今なら□□円引き」「期間限定」「早割」「◯%OFF」等の文言が付随する金額 → 除外\n' +
            '- 期間やカリキュラムが明確に異なるプランは、通常どおり別エントリとして残す',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'プラン・コース名。ページ本文の表記をそのまま使う（例: "短期集中スタイル"）。',
              },
              amount: {
                type: 'integer',
                description:
                  'そのプランの金額（円。税込表記があれば税込）。ページ本文に数字として書かれている値を、' +
                  'カンマを除いた整数で返す（例: "657,800円" なら 657800）。自分で割り算・足し算して' +
                  '求めた値は入れないこと。',
              },
            },
              duration: {
                type: ['string', 'null'],
                description:
                  'そのプランの受講期間。ページ本文の表記をそのまま使う（例: "16週間", "約6ヶ月"）。' +
                  '記載が無ければ null。単位を換算したり自分で計算した値を入れないこと。' +
                  'キャンペーンの申込期限・支払期限は受講期間ではないので入れないこと。',
              },
              kind: {
                type: ['string', 'null'],
                enum: ['total', 'monthly', 'enrollment', null],
                description:
                  'その金額の種別。total=一括・総額、monthly=月額、enrollment=入学金。' +
                  '本文の「月額」「入学金」「一括」等の表記から判定すること。' +
                  '同じプランに入学金と月額の両方が書かれている場合は、それぞれ別のエントリとして' +
                  'kind を変えて返すこと（片方を捨てない）。判定できなければ null。',
              },
            required: ['label', 'amount', 'duration', 'kind'],
            additionalProperties: false,
          },
        },
        format: {
          type: 'string',
          enum: FORMAT,
          description:
            'online=オンライン専用、offline=通学専用、both=両方に対応。本文から判断できない場合は' +
            ' online を選ぶこと（教室の所在地の記載が無いのに offline/both にしないこと）。',
        },
        area: {
          type: 'array',
          items: { type: 'string', enum: PREFECTURES },
          description:
            '通学教室が実際に所在する都道府県を、都道府県名（例: "東京都"）でそのまま列挙する。' +
            'format が online の場合は必ず空配列 [] とすること。',
        },
        subsidy_eligible: {
          type: 'boolean',
          description:
            '教育訓練給付金・リスキリング支援等の対象講座を持つとページ本文に明記されている場合のみ true。' +
            '記載が無い・判断できない場合は必ず false とすること（推測でtrueにしない）。',
        },
        career_support: {
          type: 'boolean',
          description:
            '転職支援・キャリア相談・案件紹介等のサポートがページ本文に明記されている場合のみ true。' +
            '記載が無い場合は false とすること。',
        },
        features: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
          description:
            'ページ本文に実際に記載されている客観的な事実を3〜5件、各20〜35字程度の短い文で抽出する。' +
            'descriptionの単なる分割ではなく、別々の事実をそれぞれ書くこと。\n' +
            '含めてよいもの: カリキュラム内容、サポート形態、受講形式、講師の属性、教材・学習環境。\n' +
            '除外するもの（本文に書かれていても features には入れない）:\n' +
            '- 検証不能な統計的数値主張（「転職成功率99%」「継続率97.9%」「満足度98%」等）\n' +
            '- 金銭的コミットメント文言（「転職保証」「案件保証」「返金保証」「全額返金」等）\n' +
            '- 最上級・優位性の主張（「業界No.1」「日本初」等）\n' +
            'これらは各校の営業文言であり、こちらで真偽を検証できないため、中立的な特徴としては扱わない。' +
            '除外した結果3件未満になっても構わない。無理に水増しせず、客観的事実だけを残すこと。' +
            '本文から具体的な特徴を読み取れない場合は空配列 []。',
        },
      },
      required: [
        'school_name', 'official_name', 'description', 'skill_genre', 'purpose', 'target_level',
        'career_paths', 'price_plans', 'format', 'area',
        'subsidy_eligible', 'career_support', 'features',
      ],
      additionalProperties: false,
    },
  };

  const thinContentLine = thinContent
    ? '- 本文から具体的な特徴を抽出できるだけの情報量がありません。無理に文章を作らず、' +
      `description には「${NOT_DISCLOSED_TEXT}」を返し、features は空配列 [] としてください。\n`
    : '';

  const factsBlock = pageText && pageText.trim()
    ? `以下は、実際に取得した公式サイト（${candidate.website}）のページ本文です。\n\n${pageText}`
    : '公式サイトの本文を取得できませんでした。手がかりはスクール名と公式サイトURLのみです。\n' +
      `スクール名: ${candidate.name}\n公式サイト: ${candidate.website}`;

  const msg = await anthropic.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 2000,
    // ツール定義はスクール間で完全に同一のため、ここにキャッシュを効かせる
    // （agent-zukan の structure.js と同じ狙い）。
    tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'structure_discovered_school' },
    messages: [{
      role: 'user',
      content:
        `以下は、Web検索により実在を確認できたスクール・講座「${candidate.name}」の公式サイトの内容です。\n\n` +
        factsBlock +
        '\n\nこの本文の内容に基づいて structure_discovered_school ツールを呼び出し、' +
        'スキルアップ図鑑サイト用のデータを構造化してください。\n\n' +
        '厳守事項:\n' +
        '- creative作文ではなく、あくまで本文に実際に記載されている内容の抽出・要約であること。' +
        '本文に基づかない具体的な金額・期間・実績・受講者数を創作しないこと。\n' +
        '- 本文に記載が無い項目は、正直に null / 空配列 [] / false としてください。' +
        '存在しない情報を推測で埋めないこと。\n' +
        '- 特に subsidy_eligible（給付金対象）と career_support（転職支援）は、本文に明記が' +
        'ある場合のみ true にすること。誤って true にすると、事実と異なる訴求になります。\n' +
        '- official_name は、本文に「会社名」「商号」等として明示された表記のみを一字一句そのまま' +
        '使うこと。フッターの著作権表記（"© 2026 Foo, Inc."）から会社名を推測してはならず、' +
        '英語表記しか無い場合に「株式会社Foo」のような日本語の法人格を補うことは禁止です' +
        '（この場合は null）。実在の法人についての誤情報になります。\n' +
        '- 誇張的な断定表現（業界No.1、必ず転職できる、等）は使わないこと。\n' +
        '- skill_genre / purpose / target_level / format / area は、ツール定義に列挙された' +
        '文字列以外を絶対に使わないこと（新しい値を作らない）。\n' +
        (genreHint
          ? `- この候補は「${GENRE_LABELS[genreHint] || genreHint}」の検索で見つかったものですが、` +
            'それに引きずられず、本文の内容に基づいて skill_genre を判断してください' +
            '（本文で確認できるなら複数ジャンルを挙げてよい）。\n'
          : '') +
        thinContentLine,
    }],
  });

  logCacheUsage('[structure]', msg.usage);

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI response did not include a tool_use block');

  return normalizeStructuredFields(toolUse.input, genreHint, pageText);
}

/**
 * Anthropicのtool useはJSON Schemaのenumをサーバー側で厳密には強制しないため、
 * 未知の値・矛盾した組み合わせをここで機械的に丸める（agent-zukan の structure.js で
 * カテゴリーを「その他」にクランプしていたのと同じ防御を、増えたフィールド分行う）。
 * ここを通したうえで、最終的な採否は lib/validate.js のJSON Schema検証が決める。
 */
/**
 * official_name が「ページ本文に実際に書かれていた表記」かどうかを機械的に照合する。
 *
 * プロンプトで禁止するだけでは足りないことが実運用で分かったため（初回の本番実行で、
 * フッターの "© 2026 Brewus,Inc." から「株式会社Brewus」を合成する誤りが3件中3件で
 * 発生した。正しくは「株式会社ブリューアス」）、verifyCandidate() がスクール名の実在を
 * ページ本文で照合するのと同じやり方で、AIの出力を本文と突き合わせる。
 *
 * 本文に一字一句そのまま含まれていなければ null に落とす。正式名称は誤ると実在の法人に
 * ついての誤情報になるため、取りこぼし（本当は正しいのに null になる）の方を許容する。
 * pageText が無い場合（呼び出し側が渡していない場合）は照合をスキップする。
 */
/**
 * 英語の法人格だけで書かれた社名（"CodeCamp Co., Ltd." "POTEPAN.INC" 等）。
 *
 * 「英語表記しか確認できない場合は null」というルールはプロンプトに書いてあったが、
 * 機械的な担保が無く、本文に実在する英語表記はそのまま通っていた（日次cronが入れた
 * 2件で発覚）。日本語の正式名称と英語表記が混在すると表記が揃わないため、
 * 日本語の法人格を伴わない英語社名は採用しない。
 */
const ENGLISH_LEGAL_SUFFIX = /(Inc|Co\.,?\s*Ltd|Company|Corp(oration)?|LLC|LLP|Ltd|K\.?K)\.?$/i;
const JAPANESE_LEGAL_FORM = /(株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|学校法人)/;

function verifyOfficialName(officialName, pageText) {
  if (!officialName) return null;

  const trimmed = String(officialName).trim();
  if (!JAPANESE_LEGAL_FORM.test(trimmed) && ENGLISH_LEGAL_SUFFIX.test(trimmed.replace(/[.\s]+$/, ''))) {
    console.warn(`  official_name "${trimmed}" は英語表記のみのため null にしました（日本語の正式名称が確認できていない）。`);
    return null;
  }

  if (!pageText) return officialName;

  const compact = str => String(str).replace(/[\s　]+/g, '');
  if (compact(pageText).includes(compact(officialName))) return officialName;

  console.warn(
    `  official_name "${officialName}" はページ本文に見当たらないため null にしました` +
      '（著作権表記等からの合成の可能性）。'
  );
  return null;
}

/**
 * features から、検証不能な統計的数値主張と金銭的コミットメント文言を落とす。
 *
 * これらは各校の営業文言であり、抽出としては正しくても（本文に実際に書かれている）、
 * 図鑑側が中立的な「特徴」として並べるのには適さない。数値の真偽をこちらで検証する
 * 手段が無く、並べた時点で図鑑がその主張を保証しているように読めてしまうため。
 *
 * features に残すのは客観的な事実（カリキュラム、サポート形態、受講形式、講師属性、教材）に限る。
 * プロンプト側でも同じ方針を指示しているが、official_name の件で「指示だけでは漏れる」ことが
 * 分かったため、機械的にも落とす。
 */
const EXCLUDED_FEATURE_PATTERNS = [
  // 「転職成功率99%」「継続率97.9%」「満足度98%」等の、検証不能な統計的数値主張。
  /(成功率|継続率|満足度|達成率|定着率|内定率|就職率|転職率|合格率|離職率)/,
  // 率の語が無くても、パーセンテージ付きの主張は実質的に同じ性質のものとして落とす。
  /[0-9０-９][0-9０-９.,]*\s*[%％]/,
  // 「転職保証」「案件保証」「返金保証」等の金銭的コミットメント文言（条件付きが通例で、
  // 条件を併記せずに1行で並べると誤解を招く）。
  /保証|返金|全額|キャッシュバック/,
  // 「業界No.1」「日本初」等の最上級・優位性の主張。
  /No\.?\s*1|ナンバーワン|業界初|日本初|日本一|最大手|唯一/i,
  // 「10万人以上の受講生を輩出」「導入実績900社」等の規模・実績訴求。
  // 数を数えること自体は禁じない（「700名以上の講師が対応する」のような講師属性・体制の
  // 説明は客観的事実として残す）。落とすのは、輩出数・導入数のような成果や規模の誇示。
  /輩出|突破|導入実績|導入社数|累計\s*[0-9０-９]/,
  /[0-9０-９][0-9０-９,，.]*\s*[万千]?\s*[人名社件]\s*以上の?\s*(受講生|受講者|卒業生|修了生|利用者|会員|企業)/,
];

function filterFeatures(features) {
  const kept = [];
  for (const feature of features) {
    const pattern = EXCLUDED_FEATURE_PATTERNS.find(p => p.test(feature));
    if (pattern) {
      console.warn(`  features から除外しました（誇張・検証不能な主張）: "${feature}"`);
      continue;
    }
    kept.push(feature);
  }
  return kept;
}

/**
 * description（散文）から、features と同じ基準で誇張・検証不能な主張を落とす。
 *
 * features は箇条書きなので該当項目をそのまま捨てればよいが、description は文章なので
 * 文単位で落とす。日本語の文は「。」で区切れば単体で意味が通るため、該当文を除いても
 * 残りは自然な文章として成立する。
 *
 * 落とした結果が短くなること自体は問題としない（水増ししない、というfeaturesと同じ方針）。
 * ただし全文が落ちて空になった場合だけは、定型文に置き換える（説明が消えたまま
 * 掲載されるより、確認できなかったと明示する方がよい）。
 */
function stripExaggeratedSentences(description) {
  const text = String(description || '').trim();
  if (!text) return NOT_DISCLOSED_TEXT;

  // 「。」を残したまま分割する（末尾に「。」が無い最後の文も拾う）。
  const sentences = text.split(/(?<=。)/).map(s => s.trim()).filter(Boolean);
  const kept = sentences.filter(sentence => {
    const pattern = EXCLUDED_FEATURE_PATTERNS.find(p => p.test(sentence));
    if (pattern) {
      console.warn(`  description から除外しました（誇張・検証不能な主張）: "${sentence}"`);
      return false;
    }
    return true;
  });

  return kept.join('') || NOT_DISCLOSED_TEXT;
}

/**
 * career_paths を本文照合する。
 *
 * 動画編集ジャンルの初回実行で、デジタルハリウッドの career_paths 7件のうち3件
 * （「フリーランスクリエイター」「CG/VFXアーティスト」「UI/UXデザイナー」）が
 * 本文に存在しなかった。「クリエイター系スクールならこういう職種だろう」という
 * 一般知識からの補完で、そのスクールについての事実ではない。
 *
 * 職種名は診断結果や詳細ページで「このスクールで目指せる職種」として出るため、
 * 書かれていないものを並べると事実と異なる訴求になる。表記ゆれ（全角/半角、
 * 中黒、スペース）は無視して照合する。
 */
function verifyCareerPaths(paths, pageText) {
  const strip = str => String(str).replace(/[\s　・･/／]/g, '').toLowerCase();
  const compact = strip(pageText || '');

  return (Array.isArray(paths) ? paths : []).filter(path => {
    if (typeof path !== 'string' || !path.trim()) return false;
    if (compact.includes(strip(path))) return true;
    console.warn(`  career_paths「${path}」はページ本文に見当たらないため除外しました。`);
    return false;
  });
}

/** 「完全オンライン」相当の、受講形式をオンラインと確定できる明示的な記述。 */
const ONLINE_ONLY_PATTERNS = [
  /完全オンライン/, /フルオンライン/, /オンライン完結/, /オンラインで完結/,
  /すべてオンライン/, /全てオンライン/, /オンラインのみ/, /オンラインに?特化/,
];

/** 通学拠点の存在を示唆するキーワード。1つでもあれば、オンライン確定にはしない。 */
const CAMPUS_PATTERNS = [/教室/, /校舎/, /通学/, /来校/, /スクール所在地/, /対面(授業|レッスン|指導)/];

/**
 * 受講形式（format / area）の確定。
 *
 * 以前は「offline/both なのに area が空なら問答無用で online に丸める」としていたが、
 * これだと通学拠点を持つスクールを黙ってオンライン専用として掲載してしまう
 * （都道府県フィルターに直接効くため、利用者が通学先を探せなくなる）。
 *
 * 変更後:
 *   - area が取れていて offline/both なら、そのまま採用（矛盾なし）
 *   - 本文に「完全オンライン」等の明示的記述があればオンラインと確定
 *   - それ以外は online として掲載しつつ format_unconfirmed を立て、
 *     人が後から見直せるようにする（承認フェーズが無いため、掲載は止めない）
 *
 * 戻り値: { format, area, flags }
 */
function classifyFormat(aiFormat, area, pageText) {
  const text = String(pageText || '');

  // 都道府県も本文照合を通す。動画編集ジャンルの初回実行で、AIが24件の都道府県を
  // 挙げたうち11件が本文に存在しなかった（全国展開しているスクールなので「他にもある
  // だろう」と補完したとみられる）。area は都道府県フィルターに直結するため、
  // 存在しない校舎を案内しないよう、フォールバック側と同じガードをここでも通す。
  const verifiedArea = filterToCampusPrefectures(verifyPrefectures(area, text), text);

  if (verifiedArea.length > 0 && (aiFormat === 'offline' || aiFormat === 'both')) {
    return { format: aiFormat, area: verifiedArea, flags: [], areaSource: 'top_page' };
  }
  area = verifiedArea;

  const flags = [];

  if (aiFormat === 'offline' || aiFormat === 'both') {
    console.warn(
      `  format="${aiFormat}" だが area が空のため online として掲載し、format_unconfirmed を立てました` +
        '（通学拠点の都道府県を確認してください）。'
    );
    flags.push('format_unconfirmed');
  } else if (!ONLINE_ONLY_PATTERNS.some(p => p.test(text))) {
    // オンライン専用と言い切れる根拠が本文に無い。通学の手がかりがあればなおさら。
    const campus = CAMPUS_PATTERNS.some(p => p.test(text));
    console.warn(
      '  本文に「完全オンライン」等の明示的記述が無いため format_unconfirmed を立てました' +
        (campus ? '（通学を示唆するキーワードあり）。' : '。')
    );
    flags.push('format_unconfirmed');
  }

  return { format: 'online', area: [], flags, areaSource: 'top_page' };
}

/**
 * official_name が「ページ本文に実際に書かれていた表記」かどうかを機械的に照合する。
 *
 * プロンプトで禁止するだけでは足りないことが実運用で分かったため（初回の本番実行で、
 * フッターの "© 2026 Brewus,Inc." から「株式会社Brewus」を合成する誤りが3件中3件で
 * 発生した。正しくは「株式会社ブリューアス」）、verifyCandidate() がスクール名の実在を
 * ページ本文で照合するのと同じやり方で、AIの出力を本文と突き合わせる。
 */

/** 給付金対象であることを示す文言のバリエーション（表記ゆれが多いため広めに取る）。 */
const SUBSIDY_PATTERNS = [
  /教育訓練給付/, /給付金/, /給付制度/, /補助金/, /助成金/, /リスキリング/,
  /専門実践/, /特定一般教育訓練/, /厚生労働省?\s*(指定|認定)/, /経済産業省/,
];

/**
 * subsidy_eligible の裏取り。
 *
 * official_name と同じ「本文に根拠が無いのに生成される」問題が起きていないかを機械的に見る。
 * ただし給付金対象であることの言い回しは「教育訓練給付金対象」「給付金で最大80%OFF」
 * 「リスキリング支援事業対象」等バリエーションが多く、単純な文字列一致では拾いきれない。
 * そのため「本文に給付金関連のキーワードが一つも見つからなければ false に倒す」という
 * 粗い判定にとどめる（キーワードがあれば、その文脈の妥当性まではAIの判断を尊重する）。
 *
 * pageText が無い場合は判定をスキップする。
 */
function verifySubsidyClaim(subsidyEligible, pageText) {
  if (!subsidyEligible) return false;
  if (!pageText) return true;

  if (SUBSIDY_PATTERNS.some(p => p.test(pageText))) return true;

  console.warn('  subsidy_eligible=true だが、本文に給付金関連の記述が見当たらないため false にしました。');
  return false;
}

function normalizeStructuredFields(raw, genreHint, pageText) {
  const result = { ...raw };

  const keepEnum = (values, allowed) =>
    (Array.isArray(values) ? values : []).filter(v => allowed.includes(v));

  result.skill_genre = keepEnum(result.skill_genre, GENRE);
  if (result.skill_genre.length === 0 && GENRE.includes(genreHint)) {
    // 本文からジャンルを読み取れなかった場合のみ、発見時のクエリジャンルで補う
    // （承認フェーズが無いぶん、補完したことは必ずログに残して事後に追えるようにする）。
    console.warn(`  skill_genre が空だったため、発見時のジャンル "${genreHint}" で補完しました。`);
    result.skill_genre = [genreHint];
  }

  result.purpose = keepEnum(result.purpose, PURPOSE);
  if (result.purpose.length === 0) {
    console.warn('  purpose が空だったため、"current_job_skillup" で補完しました。');
    result.purpose = ['current_job_skillup'];
  }

  if (!LEVEL.includes(result.target_level)) {
    console.warn(`  Unexpected target_level "${result.target_level}" from AI, clamping to "beginner".`);
    result.target_level = 'beginner';
  }
  if (!FORMAT.includes(result.format)) {
    console.warn(`  Unexpected format "${result.format}" from AI, clamping to "online".`);
    result.format = 'online';
  }

  // 受講形式は classifyFormat が確定させる（オンライン確定・要確認の判定を含む）。
  const classified = classifyFormat(result.format, keepEnum(result.area, PREFECTURES), pageText);
  result.format = classified.format;
  result.area = classified.area;
  result.review_flags = classified.flags;
  result.area_source = classified.areaSource;

  result.career_paths = verifyCareerPaths(result.career_paths, pageText).slice(0, 8);
  result.features = filterFeatures(
    (Array.isArray(result.features) ? result.features : []).filter(s => typeof s === 'string' && s.trim())
  ).slice(0, 5);

  result.subsidy_eligible = verifySubsidyClaim(result.subsidy_eligible === true, pageText);
  result.career_support = result.career_support === true;

  // display / min_yen はAIに書かせず、本文照合を通ったプランから機械生成する。
  result.plans = normalizePlans(verifyPlans(result.price_plans, pageText));
  result.price = buildPriceFromPlans(result.plans, 'top_page');
  delete result.price_plans;
  result.description = stripExaggeratedSentences(result.description);
  result.official_name = verifyOfficialName(String(result.official_name || '').trim() || null, pageText);
  result.school_name = String(result.school_name || '').trim();

  return result;
}

module.exports = {
  PER_GENRE_SEARCH_LIMIT,
  PAGE_TEXT_MAX_CHARS,
  MIN_CONTENT_LENGTH,
  DISCOVERY_COMMON_RULES,
  getAnthropicClient,
  extractJsonArray,
  searchGenreCandidates,
  fetchWithVerifyUA,
  candidateFetchUrls,
  candidateRootUrls,
  verifyCandidate,
  verifyOfficialName,
  verifyCareerPaths,
  verifySubsidyClaim,
  filterFeatures,
  stripExaggeratedSentences,
  classifyFormat,
  EXCLUDED_FEATURE_PATTERNS,
  collectVerifiedCandidates,
  normalizedHost,
  discoverCandidates,
  buildDiscoveredSchoolFields,
  normalizeStructuredFields,
};
