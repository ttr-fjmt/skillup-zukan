'use strict';

/**
 * 検索エンジンに載せるページ（インデックス対象）を決める。
 *
 * 【なぜ必要になったか】
 * 姉妹サイトの転職エージェント図鑑が、AdSense の審査で「有用性の低いコンテンツ」と判定された。
 * このサイトでも、中身が確認できていないページを検索対象として送らないようにする。
 *
 * 【判定の考え方】
 * 公式サイトの本文から説明文を確認できなかった講座（説明文が NOT_DISCLOSED_TEXT のまま）は、
 * ページに載せられる独自の情報がほとんど無いので検索対象から外す（サイトには残す）。
 * 2026-09 時点で、掲載中141件のうち2件が該当した。
 *
 * 出所や文字数では線を引かない。日々の収集で揺れ動かず、理由を説明できる条件にするため。
 */

const { NOT_DISCLOSED_TEXT } = require('./schema');

/** 検索対象から外すときに <head> に入れるタグ。リンクはたどってもらう（follow）。 */
const ROBOTS_NOINDEX = '<meta name="robots" content="noindex,follow">';

function isIndexableSchool(school) {
  return !!school && school.status === 'active' && school.description !== NOT_DISCLOSED_TEXT;
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

module.exports = { ROBOTS_NOINDEX, isIndexableSchool, isIndexableGenre, withRobotsNoindex };
