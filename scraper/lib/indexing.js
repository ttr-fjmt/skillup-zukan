'use strict';

/**
 * 検索エンジンに載せるページ（インデックス対象）を決める。
 *
 * 【なぜ必要になったか】
 * 姉妹サイトの転職エージェント図鑑が、AdSense の審査で「有用性の低いコンテンツ」と判定された。
 * このサイトでも、中身が確認できていないページを検索対象として送らないようにする。
 * 2026-10-02、このサイト自体も同じ理由で広告を配信できない状態になったため、線引きを一段強めた。
 *
 * 【判定の考え方】
 * 講座ページで読者の役に立つのは「どんな講座か（説明文）」と「いくらか（料金）／何が特徴か」である。
 * 説明文が無いページ、および料金も特徴もどちらも確認できなかったページは、
 * 読者が比べる材料を何も持っていないので検索対象から外す（サイトには残す）。
 * 2026-10 時点で、掲載中321件のうち17件が該当する。
 *
 * 出所や文字数では線を引かない。日々の収集で揺れ動かず、理由を説明できる条件にするため。
 */

const { NOT_DISCLOSED_TEXT, PRICE_NOT_DISCLOSED_TEXT } = require('./schema');

/** 検索対象から外すときに <head> に入れるタグ。リンクはたどってもらう（follow）。 */
const ROBOTS_NOINDEX = '<meta name="robots" content="noindex,follow">';

/** 公式サイトから料金を確認できたか。「要問い合わせ」は確認できなかった印なので数えない。 */
function hasPrice(school) {
  const display = school && school.price ? String(school.price.display || '') : '';
  return display !== '' && display !== PRICE_NOT_DISCLOSED_TEXT;
}

/** 公式サイトから特徴を1つ以上確認できたか。 */
function hasFeatures(school) {
  return Array.isArray(school && school.features) && school.features.length > 0;
}

/** 読者が比べられる材料（料金・特徴）を1つでも持っているか。 */
function hasComparableMaterial(school) {
  return hasPrice(school) || hasFeatures(school);
}

function isIndexableSchool(school) {
  if (!school || school.status !== 'active') return false;
  if (school.description === NOT_DISCLOSED_TEXT) return false;
  return hasComparableMaterial(school);
}

/** ジャンル別ページを検索対象にするか。中身のある講座が1件も無い一覧は外す。 */
function isIndexableGenre(schools, genre) {
  return (schools || []).some(s => s && (s.skill_genre || []).includes(genre) && isIndexableSchool(s));
}

/**
 * HTML の <head> に noindex を1つだけ入れる（既にあれば何もしない）。
 * 文字コード指定は <head> の先頭にある必要があるので、その直後に置く。
 */
function withRobotsNoindex(html) {
  const source = String(html);
  if (/<meta\s+name=["']robots["']/i.test(source)) return source;
  if (/<meta\s+charset=["'][^"']*["']\s*\/?>/i.test(source)) {
    return source.replace(/(<meta\s+charset=["'][^"']*["']\s*\/?>)/i, `$1\n${ROBOTS_NOINDEX}`);
  }
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/(<head[^>]*>)/i, `$1\n${ROBOTS_NOINDEX}`);
  }
  throw new Error('<head> が見つからないため noindex を入れられません');
}

module.exports = {
  ROBOTS_NOINDEX,
  isIndexableSchool,
  isIndexableGenre,
  hasComparableMaterial,
  withRobotsNoindex,
};
