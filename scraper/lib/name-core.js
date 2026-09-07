'use strict';

/**
 * freelance-anken-zukan の lib/website-enrich.js の companyNameCore / lib/agent-discovery.js の
 * splitName・candidateNameCores を、スクール名向けに移植したもの。実在照合（ページ本文に
 * 名前が実際に載っているか）と、重複判定（既に掲載済みか）の両方で同じ正規化を使う。
 *
 * スクール名固有の事情として、「テックスクール【公式】」「〇〇スクール | 無料体験受付中」の
 * ようにタイトル装飾が混ざりやすいため、法人格に加えてサービス種別の接尾辞も除去対象に
 * 含める。ただし除去しすぎると "Aスクール" と "Bスクール" の区別が消えるため、
 * 除去後2文字未満になる候補は照合キーとして採用しない（candidateNameCores 側で除外）。
 */

/** 名前から除去する法人格表記。長い（より具体的な）ものを先に判定させる。 */
const LEGAL_FORMS = [
  '特定非営利活動法人',
  '独立行政法人',
  '社会福祉法人',
  '一般社団法人',
  '公益社団法人',
  '一般財団法人',
  '公益財団法人',
  '事業協同組合',
  '合名会社',
  '合資会社',
  '合同会社',
  '有限会社',
  '株式会社',
  '学校法人',
  'NPO法人',
];

/**
 * 名前の末尾から除去するサービス種別の接尾辞（照合キーを作るときのみ使う）。
 * 表示名（school_name）からは除去しない。
 */
const SERVICE_SUFFIXES = ['スクール', 'アカデミー', 'カレッジ', '講座', '教室', 'ゼミ'];

/** 名前から法人格・空白・装飾記号を取り除いた「主要部分」を取り出す。 */
function schoolNameCore(name) {
  if (!name) return '';
  let core = String(name);
  for (const form of LEGAL_FORMS) {
    core = core.split(form).join('');
  }
  // 【公式】等の装飾（囲み記号の中身ごと）、および " | 〜" 以降のキャッチコピーを落とす。
  core = core.replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '').split(/[|｜]/)[0];
  return core.replace(/[\s　]+/g, '').trim();
}

/**
 * 「欧文名（日本語通称）」のような括弧書き併記形式を、括弧外・括弧内に分割する
 * （例: "TechAcademy（テックアカデミー）"）。全角・半角どちらの括弧にも対応する。
 */
function splitName(name) {
  const m = String(name).match(/^([^（(]*)[（(]([^）)]*)[）)]\s*$/);
  if (m) return { outside: m[1].trim(), inside: m[2].trim() };
  return { outside: String(name).trim(), inside: null };
}

/**
 * 照合に使う「主要部分」の候補一覧。括弧書き併記は括弧外・括弧内それぞれを別候補とし、
 * さらにサービス種別の接尾辞を落とした形も候補に加える（ページ側で「〇〇スクール」ではなく
 * 「〇〇」としか名乗っていないケースを拾うため）。ページ本文にいずれか1つでも含まれて
 * いれば一致とみなす。
 */
function candidateNameCores(name) {
  const { outside, inside } = splitName(name);
  const bases = [outside, inside].filter(Boolean).map(schoolNameCore);
  const cores = new Set();

  for (const base of bases) {
    if (base) cores.add(base);
    for (const suffix of SERVICE_SUFFIXES) {
      if (base.length > suffix.length && base.endsWith(suffix)) {
        cores.add(base.slice(0, -suffix.length));
      }
    }
  }

  // 2文字未満の断片はどんなページにも偶然含まれてしまい、照合の意味を失うため除外する。
  return [...cores].filter(core => core && core.length >= 2);
}

module.exports = { LEGAL_FORMS, SERVICE_SUFFIXES, schoolNameCore, splitName, candidateNameCores };
