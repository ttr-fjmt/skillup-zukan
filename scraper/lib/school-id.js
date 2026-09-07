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

/** co.jp / ne.jp のような属性ラベルは識別に寄与しないため、slug化の対象から外す。 */
const IGNORED_LABELS = new Set([
  'www', 'com', 'net', 'org', 'jp', 'co', 'ne', 'or', 'ac', 'go', 'io', 'app', 'site', 'tokyo',
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
 * URLのホスト名から、識別に使えるラベル（属性ラベル・wwwを除いた最も左のもの）を選ぶ。
 * 例: "www.example-school.co.jp" → "example-school"、"schoo.jp" → "schoo"。
 */
function domainSlug(url) {
  let host;
  try {
    host = new URL(String(url).includes('://') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
  const labels = host.split('.').filter(l => l && !IGNORED_LABELS.has(l));
  if (labels.length === 0) return '';
  return slugify(labels[0]);
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
