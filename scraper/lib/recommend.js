'use strict';

/**
 * トップの「おすすめ講座」カルーセルに出す講座の選び方。
 *
 * 【方針】
 * ここに出すのは、提携（アフィリエイト）している講座だけ。`cta_type === 'affiliate'`
 * が目印で、A8などの提携データを取り込むときに立つ。
 * agent-zukan / freelance-anken-zukan の featured 枠と同じ考え方。
 *
 * 【表示するときの約束】
 * この枠は商業的な理由で選んでいるため、必ず「PR」の表示を添えること
 * （2023年10月からのステマ規制で、広告であることを隠すのは景品表示法違反になる）。
 * 一覧そのものの並び順は提携の有無で変えない。変えているのはこの枠だけ。
 * 説明は faq.html と privacy.html にも書いてあるので、変えるときは合わせて直すこと。
 *
 * 提携が1件も無いあいだは空配列を返す。呼び出し側は枠ごと隠すこと
 * （提携していない講座を「おすすめ」として出すと、この枠の意味と説明が食い違うため）。
 */

/** おすすめ枠に出してよい講座か。掲載中かつ提携済みのものだけ。 */
function isRecommendable(school) {
  return !!school && school.status === 'active' && school.cta_type === 'affiliate';
}

/** Fisher-Yates。rng は 0以上1未満を返す関数（テストから差し替えられるように引数にする）。 */
function shuffle(list, rng) {
  const random = rng || Math.random;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * おすすめ枠に出す講座を選ぶ。
 * 提携済みの講座から、ランダムな順で最大 limit 件を返す。
 * 順番を固定しないのは、特定の1社だけが常に先頭になるのを避けるため。
 */
function pickRecommended(schools, options) {
  const opts = options || {};
  const limit = opts.limit || 10;
  return shuffle((schools || []).filter(isRecommendable), opts.rng).slice(0, limit);
}

module.exports = { isRecommendable, pickRecommended, shuffle };
