'use strict';

/**
 * ページ側のSEO/AEOのガード。
 *
 * - 見出しは1ページにh1が1つだけ。h1 はそのページの主題（トップ＝キャッチコピー、
 *   詳細＝スクール名、よくある質問＝よくある質問）にする。
 * - よくある質問の構造化データは faq.html の本文から作る。手で足した文言が
 *   混ざっていないことを、本文と突き合わせて確かめる。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..', '..');
const { extractQa, buildFaqLd, applyFaqLd, SCRIPT_ID } = require('../build-faq-jsonld');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

/** index.html は本文とスクリプトが同居しているので、見出しを数える前にJSを外す。 */
function markupOnly(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
}

test('付随ページの h1 は、そのページの主題ひとつだけ', () => {
  const expected = {
    'faq.html': 'よくある質問',
    'privacy.html': 'プライバシーポリシー',
    '404.html': 'ページが見つかりません',
  };
  for (const [file, heading] of Object.entries(expected)) {
    const $ = cheerio.load(markupOnly(read(file)));
    const h1 = $('h1');
    assert.strictEqual(h1.length, 1, `${file}: h1 が ${h1.length} 個ある`);
    assert.strictEqual(h1.first().text().trim(), heading, `${file}: h1 の中身が違う`);
  }
});

test('ヘッダーのサイト名は見出しにしない（全ページ共通の看板のため）', () => {
  for (const file of ['index.html', 'faq.html', 'privacy.html', '404.html']) {
    const html = markupOnly(read(file));
    assert.ok(
      !/<h1[^>]*>[\s\S]{0,40}スキルアップ<span class="mark">図鑑<\/span>/.test(html),
      `${file}: ヘッダーのサイト名が h1 のままになっている`
    );
  }
});

test('index.html の静的HTMLに h1 は書かれていない（表示中のページに応じてJSが1つだけ入れる）', () => {
  const $ = cheerio.load(markupOnly(read('index.html')));
  assert.strictEqual($('h1').length, 0);
});

test('index.html は表示を切り替えるたびに h1 と構造化データを入れ替えている', () => {
  const html = read('index.html');
  for (const call of ['setLd(Z.buildSchoolLd(s))', 'setLd(Z.buildCategoryLd(genre, inGenre))', 'Z.buildHomeLd(schools)']) {
    assert.ok(html.includes(call), `${call} が index.html に無い`);
  }
  // 詳細ページでは一覧側の見出しを空にする（h1 が2つ並ばないようにするため）。
  assert.ok(html.includes('setHero(null, null)'), '詳細表示で一覧の見出しを空にしていない');
});

test('講座詳細ではスクール名が h1 になる', () => {
  const html = read('index.html');
  assert.ok(html.includes("'<div><h1>' + esc(s.school_name) + '</h1>'"), '詳細のスクール名が h1 ではない');
});

test('faq.html の FAQPage は、本文から作ったものと一致している', () => {
  const html = read('faq.html');
  assert.strictEqual(applyFaqLd(html), html, 'faq.html の構造化データが古い（node build-faq-jsonld.js を実行）');
});

test('FAQPage の質問と回答は、すべて faq.html の本文にある文字列だけでできている', () => {
  const html = read('faq.html');
  const bodyText = cheerio.load(html)('main').text().replace(/\s+/g, '');
  const faq = buildFaqLd(html)['@graph'].find(n => n['@type'] === 'FAQPage');

  assert.ok(faq.mainEntity.length >= 5, '質問が少なすぎる（取り出しに失敗している可能性）');
  for (const item of faq.mainEntity) {
    assert.ok(bodyText.includes(item.name.replace(/\s+/g, '')),
      `本文に無い質問が構造化データに入っている: ${item.name}`);
    for (const line of item.acceptedAnswer.text.split('\n')) {
      assert.ok(bodyText.includes(line.replace(/\s+/g, '')),
        `本文に無い回答が構造化データに入っている: ${line.slice(0, 40)}`);
    }
  }
});

test('本文の質問の数と、構造化データの質問の数が一致する', () => {
  const html = read('faq.html');
  const $ = cheerio.load(html);
  assert.strictEqual(extractQa(html).length, $('.qa').length);
});

test('faq.html と privacy.html にパンくずが入っている', () => {
  const cases = [['faq.html', SCRIPT_ID, 'よくある質問'], ['privacy.html', 'breadcrumb-ld', 'プライバシーポリシー']];
  for (const [file, id, leaf] of cases) {
    const html = read(file);
    const match = html.match(new RegExp(`<script type="application/ld\\+json" id="${id}">([\\s\\S]*?)</script>`));
    assert.ok(match, `${file}: 構造化データのタグが無い`);
    const data = JSON.parse(match[1]);
    const nodes = data['@graph'] || [data];
    const crumb = nodes.find(n => n['@type'] === 'BreadcrumbList');
    assert.ok(crumb, `${file}: BreadcrumbList が無い`);
    assert.deepStrictEqual(crumb.itemListElement.map(i => i.name), ['ホーム', leaf]);
  }
});
