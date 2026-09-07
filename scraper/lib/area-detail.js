'use strict';

/**
 * 開催エリア（通学拠点の都道府県）の詳細ページへのフォールバック巡回。
 *
 * price と同じ構造的問題がある。トップページには校舎の所在地が書かれておらず、
 * 「アクセス」「校舎一覧」のような下層ページにしか無いことが多い。そのため
 * classifyFormat() は「オンラインと言い切る根拠が無い」状態（format_unconfirmed）で
 * 止まり、通学拠点を持つスクールが黙ってオンライン専用として掲載されうる。
 *
 * price のフォールバックと同じ方針:
 *   - 全校一律では巡回しない（format_unconfirmed、または通学キーワードがあるのに
 *     area が空、という条件を満たしたときだけ）
 *   - 1校につき詳細ページへのリクエストは最大1回。再帰的に辿らない
 *   - 見つからなければ area は空配列のまま確定し、都道府県を合成しない
 *
 * price との違いは「取れなかったこと」の記録の仕方で、金額と違い
 * 「通学拠点は無い（オンライン専用）」と「確認できなかった」は意味が全く異なるため、
 * 前者は format を online に確定し、後者は area_unconfirmed を残して区別する。
 */

const { PREFECTURES } = require('./schema');
const { extractPageLinks, fetchDetailPage } = require('./price-detail');

const STRUCTURE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

/** 校舎一覧・アクセス情報が載っていそうなアンカーテキスト／URLの手がかり。 */
const AREA_LINK_HINTS =
  /校舎|教室|スクール一覧|拠点|アクセス|所在地|会場|店舗|エリア|campus|access|location|studio|school/i;

/** 通学拠点が存在しないことを示す明示的な記述。 */
const ONLINE_ONLY_PATTERNS = [
  /完全オンライン/, /フルオンライン/, /オンライン完結/, /オンラインで完結/,
  /すべてオンライン/, /全てオンライン/, /オンラインのみ/, /オンラインに?特化/,
  /校舎はありません/, /教室はありません/, /通学(は)?不要/, /オンライン校のみ/,
];

/**
 * ページ本文に「その都道府県が実際に書かれているか」を機械的に照合する。
 *
 * 正式名称（東京都）での一致を優先し、次に略称（東京）でも拾う。校舎ページは
 * 「東京校」「大阪校」のように略称でしか書かれていないことが多いため。
 *
 * 略称照合の前に、本文から正式名称をすべて取り除いておく。そうしないと
 * 「東京都」の中の「京都」を京都府の言及と誤検出してしまう（実際に起こりうる）。
 */
function verifyPrefectures(names, pageText) {
  const text = String(pageText || '');
  const found = new Set(PREFECTURES.filter(p => text.includes(p)));

  let rest = text;
  for (const p of PREFECTURES) rest = rest.split(p).join('　');

  for (const p of PREFECTURES) {
    // 「北海道」は道まで含めて1つの名前なので略さない。都・府・県のみ落とす。
    const base = p === '北海道' ? p : p.replace(/[都府県]$/, '');
    if (base.length >= 2 && rest.includes(base)) found.add(p);
  }

  const kept = (Array.isArray(names) ? names : []).filter(n => PREFECTURES.includes(n) && found.has(n));
  for (const n of (Array.isArray(names) ? names : [])) {
    if (!kept.includes(n)) console.warn(`  都道府県「${n}」はページ本文に見当たらないため除外しました。`);
  }
  return [...new Set(kept)];
}

/**
 * 「その都道府県に通学拠点がある」と読める根拠がページ本文にあるかを機械的に確かめる。
 *
 * 実運用で、AIが会社概要ページの本社所在地（「所在地〒105-0001 東京都港区虎ノ門…」）を
 * 通学拠点として返してきた。ツール定義に「本社の所在地しか書かれていない場合は含めない」
 * と書いてあっても守られなかったため、機械的にも確かめる。
 *
 * 本社住所を校舎と誤認すると、オンライン専用スクールが format=offline になり、
 * オンライン希望者の検索結果から消え、かつ通学希望者には存在しない校舎が案内される。
 * 取りこぼし（本当は校舎があるのに未確認になる）より、こちらの誤りの方が実害が大きい。
 *
 * 根拠として認めるのは次のいずれか:
 *   - ページ全体に校舎・教室の存在を示す語がある（校舎／教室／通学／受講会場／開講）
 *   - その都道府県名を冠した拠点表記がある（例: 「東京校」「大阪教室」）
 */
const CAMPUS_EVIDENCE_PATTERNS = [/校舎/, /教室/, /通学/, /受講会場/, /開講/, /スクール一覧/];

function hasCampusEvidence(prefecture, pageText) {
  const text = String(pageText || '');
  if (CAMPUS_EVIDENCE_PATTERNS.some(p => p.test(text))) return true;

  const base = prefecture === '北海道' ? prefecture : prefecture.replace(/[都府県]$/, '');
  return new RegExp(`${base}(校|教室|校舎|スクール|ラボ)`).test(text);
}

/** 通学拠点の根拠が無い都道府県を落とす（本社所在地だけのページ対策）。 */
function filterToCampusPrefectures(prefectures, pageText) {
  return prefectures.filter(p => {
    if (hasCampusEvidence(p, pageText)) return true;
    console.warn(
      `  都道府県「${p}」は通学拠点の根拠が本文に無いため除外しました` +
        '（本社所在地のみのページの可能性）。'
    );
    return false;
  });
}

/** 校舎一覧・アクセス情報のページを1つだけAIに選ばせる。確信が持てなければ null。 */
async function chooseAreaDetailLink(links, schoolName, anthropic) {
  if (links.length === 0) return null;

  const tool = {
    name: 'choose_area_page',
    description: 'リンク一覧から、校舎・教室の所在地やアクセス情報が記載されていそうなページを1つだけ選ぶ。',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: ['string', 'null'],
          description:
            '校舎の所在地が記載されていそうなページのURL。必ず提示されたリンク一覧の中から' +
            'そのまま選ぶこと。該当しそうなものが無い場合、または確信が持てない場合は null。',
        },
        reason: { type: 'string', description: '選んだ理由を一言で。null の場合は選べなかった理由。' },
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
    tool_choice: { type: 'tool', name: 'choose_area_page' },
    messages: [{
      role: 'user',
      content:
        `スクール「${schoolName}」の公式サイトのトップページから抽出したリンク一覧です。\n` +
        'この中から、校舎・教室の所在地（住所、都道府県、アクセス）が記載されていそうな' +
        'ページを1つだけ選んでください。\n\n' +
        '選ぶ際の優先順位:\n' +
        '- 「校舎」「教室一覧」「スクール一覧」「拠点」「アクセス」「所在地」を含むリンクを最優先\n' +
        '- 「会社概要」「企業情報」は選ばないこと。運営会社の本社所在地しか載っておらず、' +
        'それを通学拠点と取り違える原因になる\n' +
        '- 「料金」「コース」「よくある質問」は所在地が載っている可能性が低いので選ばない\n' +
        '- 一覧に適切なものが無ければ、無理に選ばず null を返すこと\n\n' +
        `リンク一覧:\n${linkList}`,
    }],
  });

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) return null;

  const chosen = toolUse.input.url;
  if (!chosen) {
    console.log(`  校舎情報のページは選ばれませんでした: ${toolUse.input.reason || '(理由なし)'}`);
    return null;
  }

  const match = links.find(l => l.url === chosen);
  if (!match) {
    console.warn(`  AIが候補一覧に無いURLを返したため無視しました: ${chosen}`);
    return null;
  }
  return match;
}

/** 詳細ページ本文から、通学拠点の都道府県とオンライン専用かどうかを抽出する。 */
async function extractAreaFromPage(schoolName, detailUrl, pageText, anthropic) {
  const tool = {
    name: 'extract_area',
    description: 'ページ本文から、通学できる校舎・教室が所在する都道府県を抽出する。',
    input_schema: {
      type: 'object',
      properties: {
        prefectures: {
          type: 'array',
          items: { type: 'string', enum: PREFECTURES },
          description:
            '通学できる校舎・教室が実際に所在する都道府県を、都道府県名（例: "東京都"）で列挙する。' +
            'ページ本文に所在地として書かれているものだけを挙げること。複数あればすべて挙げる。' +
            '本社の所在地しか書かれていない場合（そこで受講できると読み取れない場合）は含めないこと。' +
            '所在地が読み取れなければ空配列 []。',
        },
        online_only: {
          type: 'boolean',
          description:
            '「完全オンライン」「校舎はありません」等、通学拠点が存在しないことがページ本文に' +
            '明記されている場合のみ true。単に校舎の記載が見当たらないだけの場合は false' +
            '（記載が無いことと、無いと書いてあることは違う）。',
        },
        has_online_courses: {
          type: 'boolean',
          description: 'オンラインでの受講もできるとページ本文から読み取れる場合は true。',
        },
      },
      required: ['prefectures', 'online_only', 'has_online_courses'],
      additionalProperties: false,
    },
  };

  const msg = await anthropic.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 700,
    tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'extract_area' },
    messages: [{
      role: 'user',
      content:
        `スクール「${schoolName}」のページ（${detailUrl}）の本文です。\n\n${pageText}\n\n` +
        'この本文に実際に記載されている所在地だけを使って extract_area を呼び出してください。\n' +
        '厳守事項:\n' +
        '- 本文に書かれていない都道府県を推測・補完しないこと。全国展開していそうだから、' +
        'といった理由で都道府県を足さないこと。\n' +
        '- 「オンライン校」「オンライン教室」は通学拠点ではないので prefectures に含めないこと。\n' +
        '- 会社概要の「所在地」「本社」「アクセス」は、運営会社のオフィスであって受講会場とは' +
        '限らない。そこで受講できると本文から読み取れない限り prefectures に含めないこと。\n' +
        '- 所在地が読み取れなければ、正直に prefectures を空配列 [] にすること。',
    }],
  });

  const usage = msg.usage || {};
  console.log(
    `[ai:cache] [area] input=${usage.input_tokens || 0} ` +
      `cache_write=${usage.cache_creation_input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) return { prefectures: [], online_only: false, has_online_courses: true };

  return {
    prefectures: filterToCampusPrefectures(verifyPrefectures(toolUse.input.prefectures, pageText), pageText),
    online_only: toolUse.input.online_only === true,
    has_online_courses: toolUse.input.has_online_courses !== false,
  };
}

/**
 * area のフォールバック巡回が必要かを判定する。
 * price と同じく「取れていないときだけ」動かすための条件で、呼び出し側はこれを見て発動する。
 */
function needsAreaEnrichment(school, pageText) {
  if ((school.area || []).length > 0) return false;
  if ((school.review_flags || []).includes('format_unconfirmed')) return true;
  // 通学を示すキーワードが本文にあるのに area が空、というのも取りこぼしのサイン。
  return /教室|校舎|通学|来校|対面(授業|レッスン|指導)/.test(String(pageText || ''));
}

/**
 * area のフォールバック巡回の入口。
 *
 * 戻り値: { area, format, areaSource, flags, detailPageUrl, resolved }
 *   resolved は「オンライン確定」または「都道府県を特定できた」場合に true。
 *   どちらでもない（確認できなかった）場合は false で、area_unconfirmed を立てる。
 */
async function enrichAreaFromDetailPage(schoolName, html, verifiedUrl, anthropic) {
  const unresolved = {
    area: [],
    format: 'online',
    areaSource: 'top_page',
    flags: ['area_unconfirmed'],
    detailPageUrl: null,
    resolved: false,
  };
  if (!html) return unresolved;

  // 校舎系の手がかりを持つリンクを前に寄せるため、price 側の抽出結果を並べ替える。
  const links = extractPageLinks(html, verifiedUrl);
  const hinted = links.filter(l => AREA_LINK_HINTS.test(l.text) || AREA_LINK_HINTS.test(l.url));
  const ordered = [...hinted, ...links.filter(l => !hinted.includes(l))];
  if (ordered.length === 0) return unresolved;

  let chosen;
  try {
    chosen = await module.exports.chooseAreaDetailLink(ordered, schoolName, anthropic);
  } catch (err) {
    console.warn(`  校舎ページの選定に失敗しました: ${err.message}`);
    return unresolved;
  }
  if (!chosen) return unresolved;

  console.log(`  校舎情報のページを1回だけ取得します: [${chosen.text}] ${chosen.url}`);

  let pageText;
  try {
    // 1校につきHTTPリクエストはこの1回のみ。失敗しても再試行・別候補への切り替えはしない。
    pageText = await module.exports.fetchDetailPage(chosen.url);
  } catch (err) {
    console.warn(`  校舎ページの取得に失敗しました（再試行しません）: ${err.message}`);
    return { ...unresolved, detailPageUrl: chosen.url };
  }

  let extracted;
  try {
    extracted = await module.exports.extractAreaFromPage(schoolName, chosen.url, pageText, anthropic);
  } catch (err) {
    console.warn(`  校舎ページからの所在地抽出に失敗しました: ${err.message}`);
    return { ...unresolved, detailPageUrl: chosen.url };
  }

  if (extracted.prefectures.length > 0) {
    return {
      area: extracted.prefectures,
      // 通学拠点が確認できた。オンライン受講もできるなら both、そうでなければ offline。
      format: extracted.has_online_courses ? 'both' : 'offline',
      areaSource: 'detail_page',
      flags: [],
      detailPageUrl: chosen.url,
      resolved: true,
    };
  }

  if (extracted.online_only || ONLINE_ONLY_PATTERNS.some(p => p.test(pageText))) {
    // 「通学拠点は無い」と書いてある。確認できなかったのとは違うので、online で確定させる。
    return {
      area: [],
      format: 'online',
      areaSource: 'detail_page',
      flags: [],
      detailPageUrl: chosen.url,
      resolved: true,
    };
  }

  // 都道府県も「オンライン専用」の明記も見つからなかった。合成せず、確認できなかったと残す。
  return { ...unresolved, areaSource: 'detail_page', detailPageUrl: chosen.url };
}

module.exports = {
  AREA_LINK_HINTS,
  ONLINE_ONLY_PATTERNS,
  verifyPrefectures,
  hasCampusEvidence,
  filterToCampusPrefectures,
  chooseAreaDetailLink,
  extractAreaFromPage,
  fetchDetailPage,
  needsAreaEnrichment,
  enrichAreaFromDetailPage,
};
