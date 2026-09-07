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

const DISCOVERY_MODEL = process.env.ANTHROPIC_DISCOVERY_MODEL || 'claude-sonnet-4-6';
const STRUCTURE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/** 1ジャンルあたりの検索呼び出しで、AIに提案させる候補数の上限（軽量な呼び出しに留めるため）。 */
const PER_GENRE_SEARCH_LIMIT = 5;

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
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
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
      return { matched, url, pageText: buildPageText(rawBodyText) };
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
 * 1回の検索呼び出しで見つかった候補群を、既存の除外セットと突き合わせて重複を除き、
 * maxCandidates上限まで verifyCandidate() まで通す共通処理。
 * verified/skipped/perGenre へは呼び出し元の配列へ直接pushする。
 */
async function collectVerifiedCandidates(rawCandidates, genre, excludeCores, maxCandidates, verified, skipped, perGenre) {
  let found = 0;
  let listed = 0;
  let skippedInGenre = 0;

  for (const candidate of rawCandidates) {
    const core = schoolNameCore(candidate.name);
    if (excludeCores.has(core)) continue; // 既存掲載・他ジャンルとの重複
    excludeCores.add(core);
    found += 1;

    if (verified.length >= maxCandidates) {
      // 上限到達後は、他に見つかっていた候補についても実在照合(HTTP)を行わない。
      continue;
    }

    const verification = await module.exports.verifyCandidate(candidate);
    if (verification.ok) {
      verified.push({
        candidate,
        genre,
        pageText: verification.pageText,
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
async function discoverCandidates(genres, excludeNames, maxCandidates) {
  const excludeCores = new Set((excludeNames || []).map(n => schoolNameCore(n)));
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

    await collectVerifiedCandidates(rawCandidates, genre, excludeCores, maxCandidates, verified, skipped, perGenre);
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
          description: '運営会社の正式名称（例: "株式会社〇〇"）。本文から読み取れなければ null。',
        },
        description: {
          type: 'string',
          description:
            '100〜200字程度の概要文。本文の抽出・要約であること。原文の丸写しはしないこと。' +
            '本文から具体的な内容が読み取れない場合のみ、定型文を返すこと。',
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
        price_display: {
          type: 'string',
          description:
            '料金の表示用文字列（例: "月額9,800円〜", "一括298,000円（税込）"）。' +
            `本文に料金の記載が無ければ「${NOT_DISCLOSED_TEXT}」を返すこと（金額を推測しない）。`,
        },
        price_min_yen: {
          type: ['integer', 'null'],
          description:
            'ソート・フィルター用の最低受講料金（円。税込表記があれば税込）。本文から数値が' +
            '読み取れなければ null。0や仮の値で埋めないこと。',
        },
        duration: {
          type: 'string',
          description:
            '受講期間の表示用文字列（例: "標準3ヶ月", "4〜24週間から選択"）。' +
            `本文に記載が無ければ「${NOT_DISCLOSED_TEXT}」を返すこと。`,
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
            'ページ本文に実際に記載されている具体的な特徴を3〜5件、各20〜35字程度の短い文で抽出する。' +
            'descriptionの単なる分割ではなく、別々の具体的な事実（学習形式、サポート内容、教材、' +
            '保証制度等）をそれぞれ書くこと。本文から具体的な特徴を読み取れない場合は空配列 []。',
        },
      },
      required: [
        'school_name', 'official_name', 'description', 'skill_genre', 'purpose', 'target_level',
        'career_paths', 'price_display', 'price_min_yen', 'duration', 'format', 'area',
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

  return normalizeStructuredFields(toolUse.input, genreHint);
}

/**
 * Anthropicのtool useはJSON Schemaのenumをサーバー側で厳密には強制しないため、
 * 未知の値・矛盾した組み合わせをここで機械的に丸める（agent-zukan の structure.js で
 * カテゴリーを「その他」にクランプしていたのと同じ防御を、増えたフィールド分行う）。
 * ここを通したうえで、最終的な採否は lib/validate.js のJSON Schema検証が決める。
 */
function normalizeStructuredFields(raw, genreHint) {
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

  result.area = keepEnum(result.area, PREFECTURES);
  // format と area の矛盾（online なのに都道府県がある / 通学なのに空）を解消する。
  // スキーマ側でも弾かれるが、ここで直しておかないと候補が丸ごと落ちてしまうため。
  if (result.format === 'online') {
    result.area = [];
  } else if (result.area.length === 0) {
    console.warn(`  format="${result.format}" だが area が空のため、format を "online" に丸めました。`);
    result.format = 'online';
  }

  result.career_paths = (Array.isArray(result.career_paths) ? result.career_paths : [])
    .filter(s => typeof s === 'string' && s.trim())
    .slice(0, 8);
  result.features = (Array.isArray(result.features) ? result.features : [])
    .filter(s => typeof s === 'string' && s.trim())
    .slice(0, 5);

  result.subsidy_eligible = result.subsidy_eligible === true;
  result.career_support = result.career_support === true;

  result.price_min_yen =
    Number.isInteger(result.price_min_yen) && result.price_min_yen >= 0 ? result.price_min_yen : null;
  result.price_display = String(result.price_display || '').trim() || NOT_DISCLOSED_TEXT;
  result.duration = String(result.duration || '').trim() || NOT_DISCLOSED_TEXT;
  result.description = String(result.description || '').trim() || NOT_DISCLOSED_TEXT;
  result.official_name = String(result.official_name || '').trim() || null;
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
  collectVerifiedCandidates,
  discoverCandidates,
  buildDiscoveredSchoolFields,
  normalizeStructuredFields,
};
