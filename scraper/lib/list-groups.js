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
 * 複数ジャンルを持つ講座は、そのすべての塊に出す。
 * トップのジャンル別件数（○件）と塊の件数がずれると、数え方を疑われるため
 * 「そのジャンルを含むか」という同じ条件で数える。
 *
 * @returns {{genre: string, items: object[], preview: object[], hidden: number}[]}
 *          該当が0件のジャンルは含めない。
 */
function groupByGenre(schools, options) {
  const opts = options || {};
  const limit = opts.preview || DEFAULT_PREVIEW;
  const genres = opts.genres || GENRE;

  return genres.map(genre => {
    const items = (schools || []).filter(s => (s.skill_genre || []).indexOf(genre) !== -1);
    return { genre, items, preview: items.slice(0, limit), hidden: Math.max(0, items.length - limit) };
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
