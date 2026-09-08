'use strict';

/**
 * 見た目まわり（ロゴURL・ジャンルアイコン・色）の共通ロジック。
 *
 * ここに置く理由:
 * ブラウザ側（index.html）と Node 側（テスト）で同じ関数を使うため。
 * build-wizard-bundle.js がこのファイルも assets/wizard.js に束ねるので、
 * サイトで動くのはテスト済みのコードそのものになる。
 *
 * 【画像の扱いについての方針】
 * 掲載スクールの「ロゴ（ファビコン）」だけを、Googleのアイコン配信サービス経由で表示する。
 * agent-zukan / freelance-anken-zukan と同じ方式。どのスクールかを見分けるための識別用途で、
 * 画像を当サイトのサーバーに複製しない。
 *
 * 一方、各スクールがSNS共有用に作っている大きな画像（og:image）は使わない。
 * 著作権が相手にあること、相手のサーバーの通信量を使うこと（ホットリンク）、
 * 差し替え・拒否設定でこちらの表示が勝手に壊れることが理由。
 * ジャンルアイコンは、その代わりに当サイトで描き起こしたもの（下の GENRE_ICONS）を使う。
 */

const { GENRE } = require('./schema');

/**
 * 公式サイトURLからロゴ（ファビコン）のURLを組み立てる。
 * 取得できるとは限らないので、表示側は必ず失敗時のフォールバックを用意すること。
 */
function buildFaviconUrl(officialUrl) {
  if (!officialUrl) return null;
  let hostname;
  try {
    hostname = new URL(officialUrl).hostname;
  } catch {
    return null;
  }
  if (!hostname) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
}

/**
 * ジャンルごとのアイコン（24x24・線画）。すべて当サイトで描き起こしたもの。
 * fill は使わず stroke="currentColor" 前提なので、文字色を変えれば色が変わる。
 */
const GENRE_ICONS = {
  programming:
    '<polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/>' +
    '<line x1="13.5" y1="4.5" x2="10.5" y2="19.5"/>',
  webdesign:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 9v11"/>',
  uiux:
    '<path d="M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/>' +
    '<path d="m14 12.5 7.5 4-3.2 1.1-1.1 3.2-3.2-8.3Z"/>',
  video_editing:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3V9Z"/>',
  web_marketing:
    '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  genai_dx:
    '<path d="M11 3 12.7 7.3 17 9l-4.3 1.7L11 15l-1.7-4.3L5 9l4.3-1.7L11 3Z"/>' +
    '<path d="m18.5 14.5.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"/>',
  language:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
    '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  certification:
    '<circle cx="12" cy="9" r="6"/><path d="M8.4 14.3 7 22l5-3 5 3-1.4-7.7"/>',
};

/**
 * ジャンルごとの色相（HSL の H）。一覧が全部同じ色にならないようにするためのもので、
 * 意味は持たせていない（色だけで情報を伝えないこと）。
 */
const GENRE_HUES = {
  programming: 210,
  webdesign: 330,
  uiux: 265,
  video_editing: 8,
  web_marketing: 150,
  genai_dx: 285,
  language: 190,
  certification: 40,
};

/** 24x24 の <svg> 要素まるごとを返す。見つからないジャンルは null。 */
function genreIconSvg(genre, className) {
  const body = GENRE_ICONS[genre];
  if (!body) return null;
  const cls = className ? ` class="${className}"` : '';
  return (
    `<svg${cls} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    `${body}</svg>`
  );
}

function genreHue(genre) {
  return Object.prototype.hasOwnProperty.call(GENRE_HUES, genre) ? GENRE_HUES[genre] : 30;
}

/**
 * ロゴが取得できなかったときに出す代替タイル用の1文字。
 * 英字なら大文字1文字、日本語ならそのまま1文字。
 */
function monogram(schoolName) {
  const name = String(schoolName || '').trim();
  if (!name) return '?';
  const ch = Array.from(name)[0];
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
}

module.exports = {
  buildFaviconUrl,
  GENRE_ICONS,
  GENRE_HUES,
  genreIconSvg,
  genreHue,
  monogram,
  // ジャンルを足したときにアイコン・色の追加漏れを検出できるよう、マスタも再輸出する。
  GENRE,
};
