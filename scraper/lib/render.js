'use strict';

/**
 * ページをブラウザで開いてからHTMLを取り出す。
 *
 * 【なぜ必要になったか】
 * 2026-10-02、料金が「要問い合わせ」のまま止まっている57校に料金の後追い補完を
 * かけたところ、1件も取れなかった（概算 $0.228）。ログを読むと、AIに渡した
 * リンク候補が「プライバシーポリシー」「特定商取引法に基づく表記」だけ、という
 * 校が大半だった。メニューや料金表をJavaScriptで組み立てるサイトでは、HTMLを
 * そのまま取ってもリンクも金額も入っていないためである。
 *
 * prerender.js と同じ puppeteer を使い、JavaScript を動かしたあとのHTMLを返す。
 * 1回起動したブラウザは使い回し、最後に closeBrowser() で閉じる。
 *
 * 【使いどころ】
 * 日次の発見処理（discover-schools.js）は件数が多く速さが要るので、これまでどおり
 * HTMLをそのまま読む。ブラウザを使うのは、取りこぼしを後から埋める
 * enrich-prices.js のような後追い処理に限る。
 */

const { VERIFY_UA } = require('./http');

/** ページの読み込みを待つ上限。これを過ぎたら、その時点のHTMLを使う。 */
const NAV_TIMEOUT_MS = Number(process.env.RENDER_NAV_TIMEOUT_MS || 30000);

let browserPromise = null;

function launchBrowser() {
  const puppeteer = require('puppeteer');
  return puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

async function getBrowser() {
  if (!browserPromise) browserPromise = launchBrowser();
  return browserPromise;
}

/**
 * URL をブラウザで開き、JavaScript が動いたあとのHTMLを返す。
 * 画像・動画・フォントは読み込まない（リンクと本文だけが目的のため）。
 */
async function fetchRenderedHtml(url, { timeoutMs = NAV_TIMEOUT_MS } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(VERIFY_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en;q=0.5' });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (type === 'image' || type === 'media' || type === 'font') req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    } catch (err) {
      // 読み込みが終わり切らなくても、その時点で組み上がっているHTMLは使える。
      // ここで諦めると、重い広告タグを積んだサイトを丸ごと取りこぼす。
      console.warn(`  ブラウザでの読み込みが時間内に終わりませんでした（その時点のHTMLを使います）: ${err.message}`);
    }
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

/** 開いたままのブラウザを閉じる。処理の最後に必ず呼ぶ。 */
async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

module.exports = { fetchRenderedHtml, closeBrowser, NAV_TIMEOUT_MS };
