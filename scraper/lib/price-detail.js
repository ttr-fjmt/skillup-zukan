'use strict';

/**
 * 料金の詳細ページへのフォールバック巡回。
 *
 * トップページには料金が載っていないスクールが多く（初回の本番実行では3件中2件で
 * price が取得できなかった）、その分だけレコードが薄くなる。とはいえ全校で下層ページを
 * 辿るのは無駄なリクエストになるため、「トップページから price を取得できなかった場合
 * だけ」詳細ページを1回だけ見に行くフォールバック方式にする。
 *
 * 【1校あたりHTTPリクエストは最大1回】
 * リンク候補が複数あってもAIに1つだけ選ばせ、選ばれたページから再帰的に辿ることはしない。
 * 「料金ページのリンクをたどったらまた一覧だった」というケースでも、そこで打ち切る。
 * 取得できなければ price は null のまま確定させる（合成しない）。
 *
 * 【金額の裏取り】
 * official_name の件（プロンプトの禁止指示だけでは合成が防げなかった）と同じ方針で、
 * AIが返した金額がページ本文に実在するかを機械的に照合する（verifyPriceClaim）。
 * 金額は誤ると利用者の受講判断に直接影響するため、取りこぼしより誤情報の回避を優先する。
 */

const cheerio = require('cheerio');
const { politeDelay, fetchWithVerifyUA } = require('./http');
const { NOT_DISCLOSED_TEXT } = require('./schema');

const STRUCTURE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/** AIに渡すリンク候補の上限（プロンプトを膨らませすぎないため）。 */
const MAX_LINK_CANDIDATES = 50;

/** 料金・コース詳細が載っていそうなアンカーテキスト／URLの手がかり。 */
const PRICE_LINK_HINTS =
  /料金|価格|費用|学費|受講料|入学金|授業料|プラン|コース|カリキュラム|price|pricing|plan|course|tuition|fee/i;

/** 詳細ページから取得した本文の上限文字数（トップページと同じ考え方）。 */
const DETAIL_TEXT_MAX_CHARS = 8000;

/**
 * トップページのHTMLから、同一ホスト内のリンク（URL + アンカーテキスト）を抽出する。
 *
 * 外部ドメインを除くのは、比較サイトやSNSの「料金」リンクを掴んでしまうと、
 * そのスクールのものではない金額を拾う危険があるため。
 * 料金らしい手がかりを持つリンクを先頭に寄せてから上限で切るので、リンクが多い
 * ページでも候補が押し出されにくい。
 */
function extractPageLinks(html, baseUrl, limit = MAX_LINK_CANDIDATES) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const baseHost = base.hostname.replace(/^www\./, '');

  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];

  $('a[href]').each((_, el) => {
    const text = $(el).text().replace(/[\s　]+/g, ' ').trim();
    if (!text) return;

    let url;
    try {
      url = new URL($(el).attr('href'), baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    if (url.hostname.replace(/^www\./, '') !== baseHost) return;

    url.hash = '';
    const href = url.toString();
    if (href === baseUrl || seen.has(href)) return;
    seen.add(href);

    links.push({ url: href, text: text.slice(0, 40) });
  });

  // 料金の手がかりを持つものを前に出す（同順位内の並びは元のまま）。
  const hinted = links.filter(l => PRICE_LINK_HINTS.test(l.text) || PRICE_LINK_HINTS.test(l.url));
  const rest = links.filter(l => !hinted.includes(l));
  return [...hinted, ...rest].slice(0, limit);
}

/**
 * リンク候補の中から、料金・コース詳細が書かれていそうなページを1つだけAIに選ばせる。
 * 確信が持てない場合は無理に選ばせず null を返させる（無駄なリクエストを避けるため）。
 * AIが候補一覧に無いURLを返した場合も null 扱いにする（勝手なURLを踏まない）。
 */
async function choosePriceDetailLink(links, schoolName, anthropic) {
  if (links.length === 0) return null;

  const tool = {
    name: 'choose_price_page',
    description: 'リンク一覧から、受講料金・コース詳細が記載されていそうなページを1つだけ選ぶ。',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: ['string', 'null'],
          description:
            '料金が記載されていそうなページのURL。必ず提示されたリンク一覧の中からそのまま選ぶこと。' +
            '該当しそうなものが無い場合、または確信が持てない場合は null を返すこと' +
            '（無理に選ばない。外れを引くと無駄なリクエストになる）。',
        },
        reason: { type: 'string', description: 'そのリンクを選んだ理由を一言で。null の場合は選べなかった理由。' },
      },
      required: ['url', 'reason'],
      additionalProperties: false,
    },
  };

  const linkList = links.map((l, i) => `${i + 1}. [${l.text}] ${l.url}`).join('\n');

  const msg = await anthropic.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 500,
    tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'choose_price_page' },
    messages: [{
      role: 'user',
      content:
        `スクール「${schoolName}」の公式サイトのトップページから抽出したリンク一覧です。\n` +
        'この中から、受講料金・コース詳細（金額、コース別の価格、入学金等）が' +
        '記載されていそうなページを1つだけ選んでください。\n\n' +
        '選ぶ際の優先順位:\n' +
        '- 「料金」「価格」「費用」「学費」「受講料」「入学金」を含むリンクを最優先\n' +
        '- 次に「コース」「プラン」「カリキュラム」等、コース別の詳細が載っていそうなもの\n' +
        '- 「よくある質問」「お問い合わせ」「会社概要」「無料相談」は料金表がある可能性が低いので選ばない\n' +
        '- 一覧に適切なものが無ければ、無理に選ばず null を返すこと\n\n' +
        `リンク一覧:\n${linkList}`,
    }],
  });

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) return null;

  const chosen = toolUse.input.url;
  if (!chosen) {
    console.log(`  料金の詳細ページは選ばれませんでした: ${toolUse.input.reason || '(理由なし)'}`);
    return null;
  }

  // AIが一覧に無いURLを組み立てた場合は踏まない（存在しないページへの無駄打ちを防ぐ）。
  const match = links.find(l => l.url === chosen);
  if (!match) {
    console.warn(`  AIが候補一覧に無いURLを返したため無視しました: ${chosen}`);
    return null;
  }
  return match;
}

/**
 * AIが返した金額が、実際にページ本文に書かれているかを機械的に照合する。
 *
 * min_yen の数字が本文に見つからなければ、display ごと不採用にする
 * （display だけ残すと、根拠不明の金額が表示に出てしまうため）。
 * カンマ・空白の有無は無視して照合する（"657,800円" と 657800 を同一視する）。
 */
function verifyPriceClaim(priceDisplay, priceMinYen, pageText) {
  const display = String(priceDisplay || '').trim();

  if (!Number.isInteger(priceMinYen) || priceMinYen < 0) {
    return { display: display || NOT_DISCLOSED_TEXT, min_yen: null };
  }

  const compact = String(pageText || '').replace(/[,，\s　]/g, '');
  if (compact.includes(String(priceMinYen))) {
    return { display: display || NOT_DISCLOSED_TEXT, min_yen: priceMinYen };
  }

  console.warn(`  price ${priceMinYen}円 はページ本文に見当たらないため不採用にしました（合成の可能性）。`);
  return { display: NOT_DISCLOSED_TEXT, min_yen: null };
}

/** 詳細ページの本文から料金を抽出する（tool-forced）。 */
async function extractPriceFromPage(schoolName, detailUrl, pageText, anthropic) {
  const tool = {
    name: 'extract_price',
    description: '受講料金のページ本文から、表示用の料金文字列と、ソート用の最低金額を抽出する。',
    input_schema: {
      type: 'object',
      properties: {
        price_display: {
          type: 'string',
          description:
            '料金の表示用文字列（例: "月額9,800円〜", "一括298,000円（税込）"）。' +
            'ページ本文に書かれている金額をそのまま使うこと。' +
            `本文に金額の記載が無ければ「${NOT_DISCLOSED_TEXT}」を返すこと（金額を推測・計算しない）。`,
        },
        price_min_yen: {
          type: ['integer', 'null'],
          description:
            'ソート用の最低受講料金（円）。ページ本文に書かれている金額のうち最も安いものを、' +
            'カンマを除いた整数で返す（例: "657,800円" なら 657800）。' +
            '本文から金額を読み取れなければ null。0や仮の値で埋めないこと。' +
            '割引後の価格と通常価格が併記されている場合は、通常価格（割引前）を使うこと。',
        },
      },
      required: ['price_display', 'price_min_yen'],
      additionalProperties: false,
    },
  };

  const msg = await anthropic.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 500,
    tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'extract_price' },
    messages: [{
      role: 'user',
      content:
        `スクール「${schoolName}」の料金ページ（${detailUrl}）の本文です。\n\n${pageText}\n\n` +
        'この本文に実際に記載されている金額だけを使って extract_price を呼び出してください。\n' +
        '厳守事項:\n' +
        '- 本文に書かれていない金額を創作・推測・計算しないこと。\n' +
        '- 分割払いの月額と総額が併記されている場合、price_min_yen には実際に本文に' +
        '数字として書かれている値を使うこと（自分で割り算して求めた値を入れない）。\n' +
        `- 金額の記載が読み取れない場合は、正直に price_display を「${NOT_DISCLOSED_TEXT}」、` +
        'price_min_yen を null にすること。',
    }],
  });

  const usage = msg.usage || {};
  console.log(
    `[ai:cache] [price] input=${usage.input_tokens || 0} ` +
      `cache_write=${usage.cache_creation_input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) return { display: NOT_DISCLOSED_TEXT, min_yen: null };

  return verifyPriceClaim(toolUse.input.price_display, toolUse.input.price_min_yen, pageText);
}

/** 詳細ページを1回だけ取得する（HTTP検証と同じUA・ポライトウェイトを流用）。 */
async function fetchDetailPage(url) {
  await politeDelay();
  const html = await module.exports.fetchWithVerifyUA(url);
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, DETAIL_TEXT_MAX_CHARS);
}

/**
 * 料金のフォールバック巡回の入口。
 *
 * 呼び出し側（discover-schools.js）は、トップページからの抽出で price が取得できなかった
 * ときだけこれを呼ぶ。ここでは発動条件の判定は行わない（呼び出し側の責務）。
 *
 * 戻り値: { price, detailPageUrl, flags }
 *   price は取得できなければ { display: 定型文, min_yen: null } のまま返す（合成しない）。
 */
async function enrichPriceFromDetailPage(schoolName, html, verifiedUrl, anthropic) {
  const empty = { price: null, detailPageUrl: null, flags: [] };
  if (!html) return empty;

  const links = extractPageLinks(html, verifiedUrl);
  if (links.length === 0) return empty;

  let chosen;
  try {
    chosen = await module.exports.choosePriceDetailLink(links, schoolName, anthropic);
  } catch (err) {
    console.warn(`  料金ページの選定に失敗しました: ${err.message}`);
    return empty;
  }
  if (!chosen) return empty;

  console.log(`  料金の詳細ページを1回だけ取得します: [${chosen.text}] ${chosen.url}`);

  let pageText;
  try {
    // 1校につきHTTPリクエストはこの1回のみ。失敗しても再試行・別候補への切り替えはしない。
    pageText = await module.exports.fetchDetailPage(chosen.url);
  } catch (err) {
    console.warn(`  詳細ページの取得に失敗しました（再試行しません）: ${err.message}`);
    return { price: null, detailPageUrl: chosen.url, flags: ['detail_page_crawled'] };
  }

  let price;
  try {
    price = await module.exports.extractPriceFromPage(schoolName, chosen.url, pageText, anthropic);
  } catch (err) {
    console.warn(`  詳細ページからの料金抽出に失敗しました: ${err.message}`);
    return { price: null, detailPageUrl: chosen.url, flags: ['detail_page_crawled'] };
  }

  return { price, detailPageUrl: chosen.url, flags: ['detail_page_crawled'] };
}

module.exports = {
  MAX_LINK_CANDIDATES,
  PRICE_LINK_HINTS,
  DETAIL_TEXT_MAX_CHARS,
  extractPageLinks,
  choosePriceDetailLink,
  verifyPriceClaim,
  extractPriceFromPage,
  fetchDetailPage,
  fetchWithVerifyUA,
  enrichPriceFromDetailPage,
};
