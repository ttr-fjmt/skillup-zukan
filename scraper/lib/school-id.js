'use strict';

/**
 * School.id（slug形式）と click_tracking_id の採番。
 *
 * 既存2サイト（agent-zukan / freelance-anken-zukan）は連番の数値idを使っていたが、
 * 本サイトは講座詳細ページのURLを /school/{id}/ という読めるパスにする前提のため、
 * slug形式とする。名前は日本語が主でそのままslugにできないため、公式サイトの
 * ドメインのラベル部分から導出する（例: https://www.example-school.co.jp/ → "example-school"）。
 *
 * ドメインから使える文字が取れない場合のみ、名前のハッシュを使ったフォールバックに
 * 落とす（読めないidになるが、id自体が採番できずレコードを落とすよりはよい）。
 */

const crypto = require('crypto');

/**
 * co.jp / ne.jp のような属性ラベル（第2レベルドメイン）。TLDを落としたあとに
 * これが末尾に来ていたら、それも落として「登録可能ドメインのラベル」を得る。
 */
const SECOND_LEVEL_LABELS = new Set([
  'co', 'ne', 'or', 'ac', 'go', 'ed', 'gr', 'lg', 'com', 'net', 'org', 'gov', 'edu',
]);

/** 任意の文字列を、[a-z0-9-] のみからなるslug断片に正規化する（使えない文字は区切りに潰す）。 */
function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * URLのホスト名から、識別に使えるラベル（登録可能ドメインのラベル）を選ぶ。
 *
 * 以前は「左端のラベル」を採っていたが、動画編集ジャンルの初回実行で
 * school.dhw.co.jp と school.vook.vc が両方とも id="school" になった
 * （2件目は衝突回避で "school-2"）。サブドメインは "school" "www" "lp" 等の
 * 汎用語であることが多く、識別子にならない。
 *
 * そこで右から数える方式にする。TLDを落とし、続けて属性ラベル（co/ne/or等）が
 * 来ていればそれも落として、残った末尾のラベルを使う。
 *   school.dhw.co.jp   → dhw
 *   school.vook.vc     → vook
 *   www.sejuku.net     → sejuku
 *   techacademy.jp     → techacademy
 *   tech-camp.in       → tech-camp
 */
function domainSlug(url) {
  let host;
  try {
    host = new URL(String(url).includes('://') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 1) return slugify(labels[0] || '');

  labels.pop(); // TLD
  if (labels.length > 1 && SECOND_LEVEL_LABELS.has(labels[labels.length - 1])) {
    labels.pop(); // co.jp 等の属性ラベル
  }
  return slugify(labels[labels.length - 1] || '');
}

/**
 * 候補1件のidを決める。ドメイン由来のslugが取れなければ、名前をslug化したもの、
 * それも空なら名前のsha1先頭8桁を使う。
 * existingIds に既にある場合は -2, -3 ... のサフィックスを付けて衝突を避ける
 * （別法人が似たドメインを使っているケースがあるため、上書きは絶対に行わない）。
 */
function buildSchoolId(name, url, existingIds) {
  const base =
    domainSlug(url) ||
    slugify(name) ||
    `school-${crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 8)}`;

  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  if (!taken.has(base)) return base;

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 100件も同一ドメイン由来のslugが並ぶことは想定していないが、返せないよりはハッシュで逃がす。
  return `${base}-${crypto.createHash('sha1').update(`${name}${url}`).digest('hex').slice(0, 6)}`;
}

/** CTAクリック計測用のID。idと1対1で対応させ、集計時にレコードへ突き合わせられるようにする。 */
function buildClickTrackingId(id) {
  return `click-${id}`;
}

module.exports = { slugify, domainSlug, buildSchoolId, buildClickTrackingId };
