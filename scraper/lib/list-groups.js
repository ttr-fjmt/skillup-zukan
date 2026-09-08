'use strict';

/**
 * 一覧の並べ方（どれをどの塊に、何件まで出すか）。
 *
 * 表示の都合とはいえ「どの講座がどこに出るか」を決めているので、
 * index.html に直接書かず lib に置いてテストで固定する。
 * このリポジトリは、書き写したコードとテスト済みのコードが食い違う事故を
 * 一度起こしているため（README・build-wizard-bundle.js の注記を参照）。
 */

const { GENRE } = require('./schema');

/** 1つの塊に出すカードの数。これを超える分は「すべて見る」に送る。 */
const DEFAULT_PREVIEW = 4;

/**
 * ジャンルごとの塊に分ける。
 *
 * 件数（items）は「そのジャンルを含むか」で数える。トップのジャンル別件数（○件）や
 * ジャンル別ページと同じ条件にしておかないと、数え方を疑われるため。
 *
 * 一方、実際に出すカード（preview）は、複数ジャンルの講座を上の塊で出していれば
 * 下の塊では出さない。同じ講座が1画面に2度3度出ると、掲載が重複しているように見える
 * （実際にトップの32枚のうち8枚が同じ講座の再掲になっていた）。
 * 件数と「すべて見る」の先は変わらないので、隠れた講座も必ずたどれる。
 *
 * @returns {{genre: string, items: object[], preview: object[], hidden: number}[]}
 *          該当が0件のジャンルは含めない。
 */
function groupByGenre(schools, options) {
  const opts = options || {};
  const limit = opts.preview || DEFAULT_PREVIEW;
  const genres = opts.genres || GENRE;
  // 同じ講座を2度出さないための控え。unique: false で従来どおり重複を許す。
  const unique = opts.unique !== false;
  const shown = new Set();

  return genres.map(genre => {
    const items = (schools || []).filter(s => (s.skill_genre || []).indexOf(genre) !== -1);
    let preview = unique ? items.filter(s => !shown.has(s.id)).slice(0, limit) : items.slice(0, limit);
    // 全部が上の塊で出ている場合でも、見出しだけの空の塊にはしない。
    // 講座があるジャンルが空欄で並ぶほうが、1件重なるより分かりにくい。
    if (preview.length === 0 && items.length > 0) preview = items.slice(0, 1);
    preview.forEach(s => shown.add(s.id));
    return { genre, items, preview, hidden: Math.max(0, items.length - preview.length) };
  }).filter(group => group.items.length > 0);
}

/**
 * 料金が確認できたものと「要問い合わせ」に分ける。
 *
 * 一覧は料金の安い順だが、金額が確認できていない講座は比べようがないので後ろにまとめている。
 * 区切りを入れないと「途中から並び順が壊れている」ように見えるため、境目を返す。
 */
function splitByPriceKnown(schools) {
  const list = schools || [];
  return {
    priced: list.filter(s => s.price && s.price.min_yen !== null && s.price.min_yen !== undefined),
    unpriced: list.filter(s => !s.price || s.price.min_yen === null || s.price.min_yen === undefined),
  };
}

module.exports = { DEFAULT_PREVIEW, groupByGenre, splitByPriceKnown };
