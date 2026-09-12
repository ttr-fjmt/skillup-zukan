'use strict';

/**
 * 学び直しガイド（/guide/）のガード。
 * 「公式情報で確認できたことだけを書く」約束（DATA_QUALITY_POLICY.md）を記事にも機械的に適用する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { GUIDES, SOURCES } = require('../generate-guide-pages');

const ROOT = path.join(__dirname, '..', '..');
const BASE = 'https://skillup-zukan.net';
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const withoutScripts = html => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

test('記事が3本以上あり、すべて書き出されている', () => {
  assert.ok(GUIDES.length >= 3);
  assert.ok(fs.existsSync(path.join(ROOT, 'guide', 'index.html')), 'guide/index.html が無い（node generate-guide-pages.js を実行）');
  for (const g of GUIDES) {
    assert.ok(fs.existsSync(path.join(ROOT, 'guide', g.slug, 'index.html')), `guide/${g.slug}/ が無い`);
  }
});

test('記事ページは検索対象で、AdSense・アクセス解析・正しい canonical を持つ', () => {
  const pages = [['guide/index.html', `${BASE}/guide/`]]
    .concat(GUIDES.map(g => [`guide/${g.slug}/index.html`, `${BASE}/guide/${g.slug}/`]));
  for (const [rel, url] of pages) {
    const html = read(rel);
    assert.ok(html.includes('adsbygoogle.js?client=ca-pub-'), `${rel} に AdSense のタグが無い`);
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), `${rel} の canonical が違う`);
    assert.ok(!/name=["']robots["']/.test(html), `${rel} が検索対象外になっている`);
    assert.ok(html.includes("gtag('config', 'G-7EE8WZT75D')"), `${rel} にアクセス解析のタグが無い`);
  }
});

test('見出しの約束：h1 はページの主題ひとつだけ、サイト名は見出しにしない', () => {
  for (const rel of ['guide/index.html'].concat(GUIDES.map(g => `guide/${g.slug}/index.html`))) {
    const html = withoutScripts(read(rel));
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, `${rel} の h1 が1つではない`);
    assert.ok(html.includes('<p class="site-name">'), `${rel} のサイト名が p になっていない`);
  }
});

test('すべての記事に、公式情報の出典が付いている', () => {
  for (const g of GUIDES) {
    assert.ok(g.sources.length > 0, `${g.slug} に出典が無い`);
    for (const key of g.sources) {
      assert.ok(SOURCES[key], `${g.slug} の出典 ${key} が未定義`);
      assert.match(SOURCES[key].url, /^https:\/\/([a-z0-9-]+\.)*mhlw\.go\.jp\//, `${key} が公式のページではない`);
    }
    assert.ok(read(`guide/${g.slug}/index.html`).includes('出典・参考にした公式情報'), `${g.slug} に出典欄が出ていない`);
  }
});

test('記事の割合・金額・日付は、公式情報で確認済みのものだけ', () => {
  // 厚生労働省「教育訓練給付金」「令和6年10月から教育訓練給付金を拡充します」で確認した数字。
  // 新しい数字を書くときは、出典を確認してからここに足す。
  const allowed = new Set([
    '20%', '40%', '50%', '70%', '80%', '5%',
    '10万円', '20万円', '25万円', '40万円', '56万円', '64万円',
    '令和6年10月1日', '令和6年10月', '6か月',
  ]);
  for (const g of GUIDES) {
    const text = g.body.replace(/<[^>]+>/g, '');
    const found = text.match(/\d+(\.\d+)?\s*[%％]|\d[\d,]*\s*(円|万円)|令和\d+年\d+月(\d+日)?|\d+\s*(か月|ヶ月)/g) || [];
    for (const v of found) {
      const key = v.replace(/\s/g, '').replace('％', '%');
      assert.ok(allowed.has(key), `${g.slug} に未確認の数字「${v}」がある`);
    }
  }
});

test('記事どうし・固定ページからのリンクがつながっている', () => {
  for (const g of GUIDES) {
    const html = read(`guide/${g.slug}/index.html`);
    for (const other of GUIDES.filter(o => o.slug !== g.slug)) {
      assert.ok(html.includes(`/guide/${other.slug}/`), `${g.slug} から ${other.slug} へのリンクが無い`);
    }
  }
  for (const rel of ['index.html', 'faq.html', 'privacy.html']) {
    assert.ok(read(rel).includes('href="/guide/"'), `${rel} から学び直しガイドへのリンクが無い`);
  }
});

test('サイトマップと llms.txt に記事が載っている', () => {
  const sitemap = read('sitemap.xml');
  const llms = read('llms.txt');
  assert.ok(sitemap.includes(`${BASE}/guide/`), 'サイトマップに学び直しガイドが無い（node generate-sitemap.js を実行）');
  for (const g of GUIDES) {
    assert.ok(sitemap.includes(`${BASE}/guide/${g.slug}/`), `${g.slug} がサイトマップに無い`);
    assert.ok(llms.includes(`${BASE}/guide/${g.slug}/`), `${g.slug} が llms.txt に無い`);
  }
});
