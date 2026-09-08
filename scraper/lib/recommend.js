'use strict';

/**
 * トップの「おすすめ講座」カルーセルに出す講座の選び方。
 *
 * 【方針】
 * 「おすすめ」といっても、当サイトは各スクールを実際に受講して評価しているわけではないし、
 * 広告費で順番を変えることもしない。ここで言うおすすめは
 * 「公式サイトから確認できた情報が充実していて、比較の材料がそろっている講座」のこと。
 * 料金が分からない講座を上位に出しても、利用者は比較のしようがないため。
 *
 * 掲載情報の充実度でスコアをつけて上位を候補に取り、その中から表示順をランダムに決める。
 * 順位を固定しないのは、同じ講座ばかりが露出し続けるのを避けるため。
 * この基準は faq.html にも書いてあるので、変えるときは両方を直すこと。
 */

/** 情報の充実度。掲載順の優劣ではなく「比較材料がどれだけあるか」を測る。 */
function recommendScore(school) {
  if (!school) return 0;
  let score = 0;

  // 料金が分かることの価値が一番大きい（比較サイトの中心的な情報のため）。
  if (school.price && school.price.min_yen !== null && school.price.min_yen !== undefined) score += 4;
  if (Array.isArray(school.plans) && school.plans.length >= 2) score += 1;

  score += Math.min((school.features || []).length, 3);
  if ((school.career_paths || []).length > 0) score += 1;
  if ((school.area || []).length > 0) score += 1;
  if (school.subsidy_eligible) score += 1;
  if (school.career_support) score += 1;
  if (typeof school.description === 'string' && school.description.length >= 60) score += 1;

  // 確認しきれなかった項目がある場合は、その分だけ差し引く。
  const flags = school.review_flags || [];
  if (flags.indexOf('price_scope_limited') !== -1) score -= 1;
  if (flags.indexOf('area_unconfirmed') !== -1) score -= 1;
  if (flags.indexOf('format_unconfirmed') !== -1) score -= 1;

  return score;
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
 * スコア上位 poolSize 件を候補にして、その中から limit 件をランダムな順で返す。
 * 同点の並びは id 順に固定する（実行のたびに候補の顔ぶれが変わらないようにするため）。
 */
function pickRecommended(schools, options) {
  const opts = options || {};
  const limit = opts.limit || 10;
  const poolSize = opts.poolSize || 14;

  const active = (schools || []).filter(s => s && s.status === 'active');
  const ranked = active
    .map(s => ({ school: s, score: recommendScore(s) }))
    .sort((a, b) => (b.score - a.score) || String(a.school.id).localeCompare(String(b.school.id)))
    .slice(0, poolSize)
    .map(x => x.school);

  return shuffle(ranked, opts.rng).slice(0, limit);
}

module.exports = { recommendScore, pickRecommended, shuffle };
