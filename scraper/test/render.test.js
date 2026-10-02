'use strict';

/**
 * ブラウザで開いてからHTMLを読む仕組み（lib/render.js）のガード。
 *
 * 2026-10-02、料金の後追い補完が57校すべてで空振りした。原因は、メニューも料金表も
 * JavaScript で組み立てるサイトが多く、HTMLをそのまま取ると
 * 「プライバシーポリシー」「特定商取引法に基づく表記」しか入っていなかったこと。
 * ここでは、まさにその形のページを手元に立てて、ブラウザ経由なら読めることを固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { fetchRenderedHtml, closeBrowser } = require('../lib/render');
const cheerio = require('cheerio');
const { extractPageLinks } = require('../lib/price-detail');

/** price-detail.js が詳細ページから本文を取り出すときと同じ手順。 */
const bodyText = html => {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text();
};

/** JavaScript を動かして初めてメニューと料金表が現れるページ。 */
const PAGE = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>テストスクール</title></head>
<body>
  <a href="/privacy">プライバシーポリシー</a>
  <a href="/tokushoho">特定商取引法に基づく表記</a>
  <div id="app"></div>
  <script>
    document.getElementById('app').innerHTML =
      '<nav>' +
      '<a href="/price">料金</a>' +
      '<a href="/course">コース一覧</a>' +
      '<a href="/plan">プラン</a>' +
      '<a href="/about">スクールについて</a>' +
      '<a href="/faq">よくある質問</a>' +
      '<a href="/access">アクセス</a>' +
      '<a href="/contact">お問い合わせ</a>' +
      '</nav><p>受講料 328,000円（税込）</p>';
  </script>
</body></html>`;

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Chromium が入っていない環境ではこのテストを飛ばす。
 * npm test は記事公開など Chromium を使わないワークフローからも走るため
 * （publish-article.yml は npm ci --ignore-scripts で入れていない）、
 * ここで落とすとブラウザと関係のない処理まで止まってしまう。
 * ブラウザを使う enrich-prices.yml では、テストの前に Chromium を入れて実際に走らせる。
 */
test('JavaScriptで組み立てるページでも、ブラウザ経由ならリンクと金額を読める', async t => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  t.after(async () => {
    await closeBrowser();
    await new Promise(resolve => server.close(resolve));
  });

  // Chromium が入っていない環境では飛ばす。executablePath() はバージョンによって
  // Promise を返したり実体の無いパスを返したりするので、実際に1回開いて確かめる。
  let rendered;
  try {
    rendered = await fetchRenderedHtml(base);
  } catch (err) {
    t.skip(`Chromium を起動できないため飛ばします: ${err.message}`);
    return;
  }

  // まずHTMLをそのまま読んだ場合：フッターの2本しか見えない。
  const plain = await fetch(base).then(r => r.text());
  const plainLinks = extractPageLinks(plain, base);
  assert.strictEqual(plainLinks.length, 2, 'HTMLそのままではフッターの2本だけ見えるはず');
  assert.ok(!/328,000円/.test(bodyText(plain)), 'HTMLそのままでは本文に金額が入っていないはず');

  // ブラウザで開いた場合：メニューも金額も読める。
  const renderedLinks = extractPageLinks(rendered, base);
  assert.ok(renderedLinks.length >= 9, `ブラウザ経由ならリンクが9本以上見えるはず（実際は${renderedLinks.length}本）`);
  assert.ok(
    renderedLinks.some(l => l.text === '料金'),
    '「料金」リンクが読めていない'
  );
  assert.ok(/328,000円/.test(bodyText(rendered)), 'ブラウザ経由なら本文から金額が読めるはず');

  // 料金の手がかりを持つリンクが先頭に寄っていること（AIに渡す順番）。
  assert.ok(
    ['料金', 'コース一覧', 'プラン'].includes(renderedLinks[0].text),
    `料金の手がかりを持つリンクが先頭に来ていない（先頭は「${renderedLinks[0].text}」）`
  );
});
