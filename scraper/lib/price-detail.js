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
 * AIが返したプランの金額が、実際にページ本文に書かれているかを1件ずつ機械的に照合する。
 * カンマ・空白の有無は無視して照合する（"657,800円" と 657800 を同一視する）。
 *
 * 本文に見つからない金額は、そのプランごと落とす。AIが分割払いから割り算して作った
 * 月額のような「計算で出しただけで本文には無い数字」はここで消える。
 */
function verifyPlans(plans, pageText) {
  const strip = str => String(str).replace(/[,，\s　]/g, '');
  const compact = strip(pageText || '');

  return (Array.isArray(plans) ? plans : []).flatMap(plan => {
    if (!plan || typeof plan.label !== 'string' || !plan.label.trim()) return [];

    // 金額は「記載が無い」こともあるため null を許す。非nullなら本文に実在すること。
    let amount = Number.isInteger(plan.amount) && plan.amount >= 0 ? plan.amount : null;
    if (amount !== null && !compact.includes(String(amount))) {
      console.warn(`  プラン「${plan.label}」の ${amount}円 はページ本文に見当たらないため除外しました。`);
      amount = null;
    }

    // 期間も同じ扱い。本文に無い期間（AIが言い換えた・単位を換算した値）は採用しない。
    let duration = typeof plan.duration === 'string' && plan.duration.trim() ? plan.duration.trim() : null;
    if (duration !== null && !compact.includes(strip(duration))) {
      console.warn(`  プラン「${plan.label}」の期間「${duration}」はページ本文に見当たらないため除外しました。`);
      duration = null;
    }

    // 金額も期間も取れないプランは、名前だけ残っても使い道が無いので落とす。
    if (amount === null && duration === null) return [];
    const kind = ['total', 'monthly', 'enrollment'].includes(plan.kind) ? plan.kind : null;
    return [{ label: plan.label.trim().slice(0, 80), amount, duration, kind }];
  });
}

/**
 * 同一プラン名で複数の金額が挙がっている場合に、最も高い金額（＝通常価格）だけを残す。
 *
 * sejuku の実例で、同じ「集中8週間プラン」が通常価格 475,200円 と割引後 456,390円 の
 * 2エントリとして列挙され、min_yen が割引価格になってしまった。プロンプトでも
 * 「割引後価格は含めない」と指示しているが、official_name の件と同じく指示だけでは
 * 漏れるため、機械的にも落とす。
 *
 * 【なぜ「高い方を残す」なのか】
 * 割引後価格は必ず通常価格より安い。ラベルが同じである以上、内容の違いで区別する
 * 手がかりはこちらには無いので、「同じ名前なら安い方がキャンペーン価格」と見なす。
 * 本当に同名で内容の異なるプランが並んでいた場合は安い方を取りこぼすが、
 * 割引価格を通常価格として掲げるより、この向きの誤りの方が安全と判断する。
 * 期間・カリキュラムが違うプランはラベルが異なるため、ここでは影響を受けない。
 */
function dropDiscountedDuplicates(plans) {
  const byLabel = new Map();

  for (const plan of plans) {
    // 畳み込みのキーは「ラベル＋種別」。同じプラン名で入学金と月額が別々に載っている
    // ことがあり（Vook のマスタープランは入学金139,700円＋月額39,600円）、ラベルだけを
    // キーにすると、安い方を割引価格と誤認して片方を捨ててしまう。
    const key = `${plan.label.trim()} ${plan.kind || ''}`;
    const existing = byLabel.get(key);
    if (!existing) {
      byLabel.set(key, { ...plan });
      continue;
    }

    // 期間は片方にしか入っていないことがあるので、非nullの方を拾って統合する。
    if (existing.duration === null && plan.duration !== null) existing.duration = plan.duration;

    if (plan.amount === null) continue;
    if (existing.amount === null) {
      existing.amount = plan.amount;
      continue;
    }
    if (plan.amount > existing.amount) {
      console.warn(`  プラン「${key}」に複数の金額があるため、割引前とみなして ${plan.amount}円 を採用しました（${existing.amount}円 を除外）。`);
      existing.amount = plan.amount;
    } else if (plan.amount < existing.amount) {
      console.warn(`  プラン「${key}」の ${plan.amount}円 は割引後価格とみなして除外しました（${existing.amount}円 を採用）。`);
    }
  }

  return [...byLabel.values()];
}

/**
 * plans から display と min_yen を機械的に組み立てる。
 *
 * display をAIの自由記述にすると、プランの羅列がそのまま入ったり、要約の仕方が
 * スクールごとにバラついたりする（実際に102字のプラン羅列が入った）。表示文字列は
 * 常に同じ規則で組み立てる。
 *
 * ロケールは 'en-US' を明示する。既定ロケールに任せると、実行環境によっては
 * 桁区切りが "657.800" のようになりうるため。日本語表記としての結果は同じ。
 */
/**
 * plans を正規化する（重複の畳み込みまで）。plans はレコードの事実そのもので、
 * price はここから導出される表示用の見え方、という関係にする。
 */
function normalizePlans(plans) {
  return dropDiscountedDuplicates(
    (Array.isArray(plans) ? plans : [])
      .filter(p => p && typeof p.label === 'string' && p.label.trim())
      .map(p => ({
        label: p.label.trim().slice(0, 80),
        amount: Number.isInteger(p.amount) && p.amount >= 0 ? p.amount : null,
        duration: typeof p.duration === 'string' && p.duration.trim() ? p.duration.trim().slice(0, 60) : null,
        kind: ['total', 'monthly', 'enrollment'].includes(p.kind) ? p.kind : null,
      }))
  );
}

/**
 * plans から price（表示用）を機械的に組み立てる。
 *
 * display をAIの自由記述にすると、プランの羅列がそのまま入ったり、要約の仕方が
 * スクールごとにバラついたりする（実際に102字のプラン羅列が入った）。表示文字列は
 * 常に同じ規則で組み立てる。
 *
 * 期間側に同種の代表値（「最短◯週間」等）は作らない。sejuku の料金ページには
 * 「無料カウンセリング実施後2週間以内のご入会」というキャンペーンの申込期限があり、
 * 素朴に最短を代表値にすると受講期間として 2週間 を掲げてしまう。期間はプラン単位で
 * 持ち、代表値はUI側で必要になったときに改めて設計する。
 *
 * ロケールは 'en-US' を明示する。既定ロケールに任せると、実行環境によっては
 * 桁区切りが "657.800" のようになりうるため。日本語表記としての結果は同じ。
 */
function buildPriceFromPlans(plans, scope = 'top_page') {
  const priced = normalizePlans(plans).filter(p => p.amount !== null);

  // 種別の違う金額を同じ数値軸に並べない。Vook は月額39,600円（別途入学金139,700円）、
  // sejuku は一括475,200円で、これを同じ min_yen として比べると桁の違うものが同列に見える。
  // total を優先し、無ければ monthly を使う。enrollment（入学金）は受講料そのものでは
  // ないので min_yen には使わない。kind を判定できなかったプランも使わない。
  const kind = ['total', 'monthly'].find(k => priced.some(p => p.kind === k)) || null;
  const usable = kind === null ? [] : priced.filter(p => p.kind === kind);

  if (usable.length === 0) {
    if (priced.length > 0) {
      console.warn(
        `  金額はあるが min_yen に使える種別（total / monthly）がないため null にしました` +
          `（種別: ${[...new Set(priced.map(p => p.kind))].join(', ')}）。`
      );
    }
    return { display: NOT_DISCLOSED_TEXT, min_yen: null, scope, kind: null };
  }

  const min = Math.min(...usable.map(p => p.amount));
  const formatted = min.toLocaleString('en-US');
  // 月額であることを表示文字列にも出す。数字だけだと一括料金と見分けが付かない。
  const prefix = kind === 'monthly' ? '月額' : '';
  return {
    // 金額のあるプランが1件だけなら「〜」を付けない（幅が無いのに幅があるように見せない）。
    display: usable.length === 1 ? `${prefix}${formatted}円` : `${prefix}${formatted}円〜`,
    min_yen: min,
    scope,
    kind,
  };
}

/** 詳細ページの本文から料金を抽出する（tool-forced）。 */
async function extractPriceFromPage(schoolName, detailUrl, pageText, anthropic, scope = 'detail_page') {
  const tool = {
    name: 'extract_price',
    description: '受講料金のページ本文から、表示用の料金文字列と、ソート用の最低金額を抽出する。',
    input_schema: {
      type: 'object',
      properties: {
        plans: {
          type: 'array',
          description:
            'ページ本文に記載されているプラン・コースと、その金額の一覧。' +
            '表示用の文章は作らないこと（こちらで機械的に組み立てる）。' +
            '金額の記載が読み取れない場合は空配列 [] を返すこと。\n' +
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
                description: 'プラン・コース名。ページ本文の表記をそのまま使う（例: "集中8週間プラン"）。',
              },
              amount: {
                type: 'integer',
                description:
                  'そのプランの金額（円）。ページ本文に数字として書かれている値を、カンマを除いた' +
                  '整数で返す（例: "¥657,800" なら 657800）。自分で割り算・足し算して求めた値は' +
                  '入れないこと。割引後と通常価格が併記されている場合は通常価格（割引前）を使う。',
              },
            },
              duration: {
                type: ['string', 'null'],
                description:
                  'そのプランの受講期間。ページ本文の表記をそのまま使う（例: "16週間", "約6ヶ月"）。' +
                  '期間の記載が無ければ null。単位を換算したり、自分で計算した値を入れないこと。' +
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
      },
      required: ['plans'],
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
        'この本文に実際に記載されているプランと金額だけを使って extract_price を呼び出してください。\n' +
        '厳守事項:\n' +
        '- 本文に書かれていない金額を創作・推測・計算しないこと。\n' +
        '- 分割払いの月額と総額が併記されている場合、本文に数字として書かれている値だけを' +
        '使うこと（自分で割り算して求めた値を入れない）。\n' +
        '- 表示用の文章・要約は作らないこと。プラン名と金額のペアだけを返せばよい。\n' +
        '- 金額には必ず kind（total=一括/総額、monthly=月額、enrollment=入学金）を付けること。' +
        '「月額◯◯円」と「入学金◯◯円」が併記されている場合は、両方を別エントリとして返すこと。\n' +
        '- 割引後価格（キャンペーン価格・早割・期間限定価格）は plans に含めないこと。' +
        '同じプランの通常価格と割引後価格が両方載っている場合は、通常価格だけを返すこと。' +
        'label を変えて別プランとして並べるのも不可。\n' +
        '- 金額の記載が読み取れない場合は、正直に plans を空配列 [] にすること。',
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
  if (!toolUse) return { plans: [], price: buildPriceFromPlans([], scope) };

  // 本文照合を通ったプランだけから display / min_yen を機械生成する。
  // plans が事実、price はそこから導出される見え方。両方返す。
  const plans = normalizePlans(verifyPlans(toolUse.input.plans, pageText));
  return { plans, price: buildPriceFromPlans(plans, scope) };
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
  const empty = { price: null, plans: null, detailPageUrl: null, flags: [] };
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
    return { price: null, plans: null, detailPageUrl: chosen.url, flags: ['detail_page_crawled'] };
  }

  let extracted;
  try {
    extracted = await module.exports.extractPriceFromPage(schoolName, chosen.url, pageText, anthropic);
  } catch (err) {
    console.warn(`  詳細ページからの料金抽出に失敗しました: ${err.message}`);
    return { price: null, plans: null, detailPageUrl: chosen.url, flags: ['detail_page_crawled'] };
  }

  return { price: extracted.price, plans: extracted.plans, detailPageUrl: chosen.url, flags: ['detail_page_crawled'] };
}

module.exports = {
  MAX_LINK_CANDIDATES,
  PRICE_LINK_HINTS,
  DETAIL_TEXT_MAX_CHARS,
  extractPageLinks,
  choosePriceDetailLink,
  verifyPlans,
  buildPriceFromPlans,
  normalizePlans,
  extractPriceFromPage,
  fetchDetailPage,
  fetchWithVerifyUA,
  enrichPriceFromDetailPage,
};
