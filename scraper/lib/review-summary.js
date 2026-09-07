'use strict';

/**
 * 口コミ要約パイプラインの中核。
 *
 * 【著作権・引用まわりの設計方針】
 * 口コミの原文は他社サイトの著作物であり、転載も、1件ずつの言い換え（＝実質的な
 * 翻案）も行わない。このモジュールが作るのは「複数件をまとめて読んだときに見える
 * 傾向」の要約だけであり、次の3点を構造として担保する:
 *
 *   1. 個別の口コミを1件ずつ渡して1件ずつ要約させる、という呼び出し方をしない。
 *      buildReviewSummary() は必ず複数件をまとめて1回のAI呼び出しに渡す。
 *   2. 原文は data/ にも schools.json にも保存しない（AI呼び出しの入力として
 *      メモリ上で使うだけ）。保存するのは出力された要約文と出典情報のみ。
 *   3. 要約文と一緒に必ず sources[]（出典名・URL・取得日時）を保存する。
 *      フロントエンドは「評判のポイント（出典：〇〇）」＋出典への直リンクと
 *      セットでのみ表示する（要約のみの単独表示を禁止する）。
 *
 * 取得部（fetchReviewPage）は、data/review-sources.json の人力確認済み許可リストに
 * 載っているホストしか触らない（lib/review-sources.js が fail-closed で判定する）。
 */

const cheerio = require('cheerio');
const { fetchText, reviewDelay, USER_AGENT } = require('./http');
const { isUrlAllowed } = require('./robots');
const { checkUrlAllowed, describeReason } = require('./review-sources');

const MODEL = process.env.ANTHROPIC_REVIEW_MODEL || 'claude-haiku-4-5-20251001';

/** 1校あたり、AIに渡す口コミ本文の合計上限文字数。 */
const REVIEW_TEXT_MAX_CHARS = Number(process.env.REVIEW_TEXT_MAX_CHARS || 8000);

/**
 * 要約を作るために最低限必要な口コミ件数。1〜2件しか無い状態で「傾向」を書かせると、
 * 実質的にその1件の言い換えになってしまうため、下回る場合は要約を作らない。
 */
const MIN_REVIEWS_FOR_SUMMARY = Number(process.env.MIN_REVIEWS_FOR_SUMMARY || 3);

/** 短すぎる断片（「★5」「参考になった」等のUI文言）は口コミ本文として数えない。 */
const MIN_REVIEW_LENGTH = 30;

/**
 * 口コミページのHTMLから、口コミ本文らしいテキストブロックを抽出する。
 *
 * サイトごとにマークアップが違うため、汎用のセレクタ候補を順に試し、最初に
 * 「十分な長さのブロックが複数取れた」ものを採用する。取れなければ空配列を返す
 * （＝そのURLは要約の材料にしない。無理に本文らしきものをかき集めると、運営の
 * 説明文や広告テキストを口コミとして扱ってしまうため）。
 *
 * selectorHint を渡すと、そのサイト専用のセレクタを最優先で試す
 * （data/review-sources.json の review_selector で指定できる）。
 */
const DEFAULT_REVIEW_SELECTORS = [
  '[class*="review"] p',
  '[class*="Review"] p',
  '[class*="voice"] p',
  '[class*="kuchikomi"] p',
  'article p',
  'li[class*="review"]',
];

function extractReviewTexts(html, selectorHint) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const selectors = selectorHint ? [selectorHint, ...DEFAULT_REVIEW_SELECTORS] : DEFAULT_REVIEW_SELECTORS;

  for (const selector of selectors) {
    const texts = $(selector)
      .map((_, el) => $(el).text().replace(/[ \t　]+/g, ' ').trim())
      .get()
      .filter(t => t.length >= MIN_REVIEW_LENGTH);

    // 重複（同じ文言が複数箇所に出るテンプレート）を除いたうえで件数を判断する。
    const unique = [...new Set(texts)];
    if (unique.length >= MIN_REVIEWS_FOR_SUMMARY) return unique;
  }

  return [];
}

/**
 * 口コミページを1件取得する。取得の前に必ず2段の関門を通す:
 *   1. data/review-sources.json の人力確認済み許可リスト（fail-closed）
 *   2. robots.txt の機械チェック（lib/robots.js）
 * どちらかで不可となった場合は fetch を行わず、理由を付けて返す。
 *
 * 呼び出しの間隔は reviewDelay()（最低2秒）で空ける。
 */
async function fetchReviewPage(url, { selectorHint, fetchImpl = fetchText } = {}) {
  const allowCheck = checkUrlAllowed(url);
  if (!allowCheck.allowed) {
    return { ok: false, reason: allowCheck.reason, message: describeReason(allowCheck.reason) };
  }

  let robotsOk;
  try {
    robotsOk = await isUrlAllowed(url, USER_AGENT);
  } catch (err) {
    // robots.txt の判定自体に失敗した場合は、通してよい根拠が無いので通さない。
    return { ok: false, reason: 'robots_check_failed', message: err.message };
  }
  if (!robotsOk) {
    return { ok: false, reason: 'robots_disallow', message: 'robots.txt により許可されていないパスです' };
  }

  await reviewDelay();

  let html;
  try {
    html = await fetchImpl(url);
  } catch (err) {
    return { ok: false, reason: 'fetch_failed', message: err.message };
  }

  const reviews = extractReviewTexts(html, selectorHint);
  if (reviews.length < MIN_REVIEWS_FOR_SUMMARY) {
    return {
      ok: false,
      reason: 'too_few_reviews',
      message: `抽出できた口コミが${reviews.length}件で、要約に必要な${MIN_REVIEWS_FOR_SUMMARY}件に達しません`,
      reviews,
    };
  }

  return { ok: true, reviews, fetchedAt: new Date().toISOString() };
}

/**
 * 複数の出典から集めた口コミ本文をまとめて1回のAI呼び出しに渡し、「傾向」の要約を作る。
 *
 * blocks: [{ source_name, source_url, reviews: string[] }, ...]
 * 戻り値: 要約文（string）。
 *
 * プロンプトは「個々の口コミを引用・言い換えるのではなく、全体の論調を要約する」ことを
 * 明示的に指示する。ツール定義（＝スクール間で不変の部分）に cache_control を置き、
 * 週次バッチで多数の学校を回すときのキャッシュを効かせる。
 */
async function buildReviewSummary(schoolName, blocks, anthropic) {
  const usableBlocks = blocks.filter(b => Array.isArray(b.reviews) && b.reviews.length > 0);
  const totalReviews = usableBlocks.reduce((sum, b) => sum + b.reviews.length, 0);
  if (totalReviews < MIN_REVIEWS_FOR_SUMMARY) {
    throw new Error(`口コミが${totalReviews}件しかないため要約を作りません（最低${MIN_REVIEWS_FOR_SUMMARY}件必要）`);
  }

  // 出典ごとに口コミをまとめ、全体で上限文字数に収まるよう均等に切り詰める。
  const perBlockBudget = Math.floor(REVIEW_TEXT_MAX_CHARS / usableBlocks.length);
  const reviewsBlock = usableBlocks
    .map(b => {
      let used = 0;
      const lines = [];
      for (const review of b.reviews) {
        if (used + review.length > perBlockBudget) break;
        lines.push(`- ${review}`);
        used += review.length;
      }
      return `【${b.source_name}】(${lines.length}件)\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const tool = {
    name: 'summarize_review_trend',
    description:
      '複数件の口コミから読み取れる全体の傾向を、個々の口コミを引用・言い換えることなく、' +
      '自分自身の言葉で要約する。',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            '「良い評判の傾向」と「気になる点の傾向」を合わせて3〜4文程度にまとめた要約文。' +
            '特定の口コミの言い回し・構成をなぞらないこと。個々の口コミを引用・言い換えないこと。' +
            '複数件に共通して現れる論調のみを書き、1件だけの意見を全体の傾向のように書かないこと。' +
            '断定的な評価（「必ず〜できる」等）や、口コミに書かれていない事実を足さないこと。',
        },
        positive_themes: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 4,
          description: '良い評判として複数件に共通して現れたテーマ（各10〜20字程度の短い名詞句）。',
        },
        concern_themes: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 4,
          description:
            '気になる点として複数件に共通して現れたテーマ（各10〜20字程度の短い名詞句）。' +
            '該当が無ければ空配列 [] とし、無理に作らないこと。',
        },
      },
      required: ['text', 'positive_themes', 'concern_themes'],
      additionalProperties: false,
    },
  };

  const sourceNames = usableBlocks.map(b => b.source_name).join('・');

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'summarize_review_trend' },
    messages: [{
      role: 'user',
      content:
        `以下は${schoolName}に関する${sourceNames}上の複数の口コミです。\n` +
        `これらから読み取れる「良い評判の傾向」「気になる点の傾向」を、\n` +
        `あなた自身の言葉で3〜4文程度にまとめてください。\n` +
        `特定の口コミの言い回しや構成をなぞらないでください。\n` +
        `個々の口コミを引用・言い換えるのではなく、全体の論調を要約してください。\n\n` +
        `厳守事項:\n` +
        `- 原文の表現をそのまま使わないこと（固有名詞・コース名を除く）。\n` +
        `- 1件だけに出てくる特徴的なエピソードは書かないこと（複数件に共通する論調のみ）。\n` +
        `- 口コミに書かれていない事実（料金・実績・受講者数等）を足さないこと。\n` +
        `- 良い点だけを並べず、気になる点の傾向も読み取れる範囲で書くこと` +
        `（見当たらない場合は無理に作らず、その旨には触れずに良い点のみ書く）。\n\n` +
        reviewsBlock,
    }],
  });

  const usage = msg.usage || {};
  console.log(
    `[ai:cache] [review:${schoolName}] input=${usage.input_tokens || 0} ` +
      `cache_write=${usage.cache_creation_input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI response did not include a tool_use block');

  const text = String(toolUse.input.text || '').trim();
  if (!text) throw new Error('要約文が空でした');
  return {
    text,
    positive_themes: toolUse.input.positive_themes || [],
    concern_themes: toolUse.input.concern_themes || [],
  };
}

/**
 * School レコードの review_summary を組み立てる。sources[] は必ず1件以上入る
 * （出典の無い要約は作らない、という表示ルールをデータ構造の側で保証する）。
 */
function assembleReviewSummary(summaryText, blocks) {
  const sources = blocks
    .filter(b => b.ok !== false && b.fetchedAt)
    .map(b => ({
      source_name: b.source_name,
      source_url: b.source_url,
      fetched_at: b.fetchedAt,
    }));

  if (sources.length === 0) {
    throw new Error('出典が1件も無い状態で review_summary を作ることはできません');
  }
  return { text: summaryText, sources };
}

module.exports = {
  MIN_REVIEWS_FOR_SUMMARY,
  MIN_REVIEW_LENGTH,
  REVIEW_TEXT_MAX_CHARS,
  DEFAULT_REVIEW_SELECTORS,
  extractReviewTexts,
  fetchReviewPage,
  buildReviewSummary,
  assembleReviewSummary,
};
