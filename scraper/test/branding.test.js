'use strict';

/**
 * lib/branding.js（ロゴURL・ジャンルアイコン・代替タイル）の検証。
 *
 * ここでの一番の狙いは「ジャンルを足したときにアイコンと色の追加を忘れる」事故を落とすこと。
 * 忘れても画面は真っ白にならず、そのジャンルだけアイコンが消えるという気づきにくい壊れ方を
 * するため、テストで固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  buildFaviconUrl,
  GENRE_ICONS,
  GENRE_HUES,
  genreIconSvg,
  genreHue,
  monogram,
} = require('../lib/branding');
const { GENRE } = require('../lib/schema');

test('全ジャンルにアイコンと色相が定義されている', () => {
  for (const g of GENRE) {
    assert.ok(GENRE_ICONS[g], `${g} のアイコンが未定義`);
    assert.ok(Number.isFinite(GENRE_HUES[g]), `${g} の色相が未定義`);
  }
});

test('アイコン・色相にマスタ外のジャンルが紛れ込んでいない', () => {
  for (const key of Object.keys(GENRE_ICONS)) assert.ok(GENRE.includes(key), `未知のジャンル: ${key}`);
  for (const key of Object.keys(GENRE_HUES)) assert.ok(GENRE.includes(key), `未知のジャンル: ${key}`);
});

test('genreIconSvg は currentColor の線画SVGを返す', () => {
  const svg = genreIconSvg('programming', 'gicon');
  assert.match(svg, /^<svg class="gicon" viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /fill="none"/);
  // 装飾なので読み上げ対象から外す。
  assert.match(svg, /aria-hidden="true"/);
  assert.ok(svg.endsWith('</svg>'));
});

test('genreIconSvg は未知のジャンルでは null を返す（例外にしない）', () => {
  assert.strictEqual(genreIconSvg('unknown_genre'), null);
});

test('アイコンに外部リソースへの参照が含まれていない', () => {
  // 掲載スクール側の画像をホットリンクしない方針。アイコンは自前の線画のみ。
  for (const [g, body] of Object.entries(GENRE_ICONS)) {
    assert.ok(!/<image|xlink:href|url\(|https?:/i.test(body), `${g} が外部リソースを参照している`);
    assert.ok(!/<script/i.test(body), `${g} に script が含まれている`);
  }
});

test('genreHue は未知のジャンルでも数値を返す', () => {
  assert.strictEqual(typeof genreHue('unknown_genre'), 'number');
});

test('buildFaviconUrl はホスト名からGoogleのアイコンURLを組み立てる', () => {
  assert.strictEqual(
    buildFaviconUrl('https://www.sejuku.net/course/'),
    'https://www.google.com/s2/favicons?domain=www.sejuku.net&sz=128'
  );
});

test('buildFaviconUrl は不正な入力で null を返す', () => {
  assert.strictEqual(buildFaviconUrl(null), null);
  assert.strictEqual(buildFaviconUrl(''), null);
  assert.strictEqual(buildFaviconUrl('not a url'), null);
});

test('monogram は英字を大文字1文字、日本語はそのまま1文字にする', () => {
  assert.strictEqual(monogram('codecamp'), 'C');
  assert.strictEqual(monogram('SAMURAI ENGINEER'), 'S');
  assert.strictEqual(monogram('  スタディング'), 'ス');
  assert.strictEqual(monogram(''), '?');
  assert.strictEqual(monogram(null), '?');
});

test('index.html はスクールのog:image（大きな共有画像）をホットリンクしていない', () => {
  // 著作権と相手サーバーの負荷の観点から、掲載スクールの画像は
  // ロゴ（Googleのアイコン配信サービス）以外に増やさない。
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const externalImages = html.match(/<img[^>]+src=['"]?https?:[^'">]+/gi) || [];
  for (const tag of externalImages) {
    assert.match(
      tag,
      /google\.com\/s2\/favicons/,
      `想定外の外部画像を読み込んでいる: ${tag}`
    );
  }
});
