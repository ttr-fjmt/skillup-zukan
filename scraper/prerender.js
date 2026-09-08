'use strict';

/**
 * 講座詳細ページ（/school/{id}/）とジャンル別ページ（/category/{genre}/）を
 * 静的HTMLとして書き出す。agent-zukan / freelance-anken-zukan の prerender.js と同じ方式。
 *
 * 【なぜ必要か】
 * index.html はブラウザ側で描画するSPAなので、そのままだと検索エンジンや、JSを実行しない
 * クローラーには「空のページ」に見える。各講座のページが検索結果に出ないと、比較サイトとして
 * 成立しない。
 *
 * 【なぜNodeでHTMLを組み立てないのか】
 * テンプレートをNode側にもう1つ持つと、画面の見た目とSSGの出力が食い違う。診断ロジックを
 * bundleで1本化したのと同じ理由で、描画は index.html だけを正とし、それを実際のブラウザで
 * 動かした結果を保存する。
 *
 * ローカルに静的サーバーを立て、Puppeteer で各URLを開き、描画完了（body[data-ssg-ready]）を
 * 待ってからHTMLを保存する。
 *
 * 実行: node prerender.js
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const { GENRE } = require('./lib/schema');
const { readSchools } = require('./lib/schools-store');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PRERENDER_PORT || 8936);
const NAV_TIMEOUT = 30000;
const READY_TIMEOUT = 15000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * 静的サーバー。存在しないパスは index.html を返す（SPAのルーティングを再現するため）。
 * 保存先の /school/{id}/index.html が既にある場合でも、常に index.html を返して
 * 描画し直す（前回の出力を読み込んで二重に描画してしまわないように）。
 */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(ROOT, urlPath);
      const ext = path.extname(filePath);

      if (ext && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(filePath));
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(fs.readFileSync(path.join(ROOT, 'index.html')));
    });
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

/** 静的化のあいだ読み込ませない広告関連のホスト。 */
const AD_HOST_PATTERN = /googlesyndication\.com|doubleclick\.net|googleadservices\.com|google\.com\/recaptcha/;

/** 1ページ分を描画して保存する。戻り値は保存したかどうか。 */
async function renderPage(browser, urlPath, outDir) {
  const page = await browser.newPage();
  // 静的化中であることをページ側に伝える。ロゴの読み込みを待ち切れずに
  // 代替タイルへ切り替える処理（watchLogos）を、保存対象のHTMLに固定させないため。
  await page.evaluateOnNewDocument(() => { window.__PRERENDER__ = true; });

  // 広告配信スクリプトはここでは動かさない。
  // <head> の AdSense タグ（サイト所有権の確認に必要）はHTMLに残したいが、
  // 実行させると AdSense 自身が ins や iframe を差し込み、それが保存され続けてしまう
  // （実際に31ページへ焼き付いた）。読み込み自体を止めれば、タグは残り中身は入らない。
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (AD_HOST_PATTERN.test(req.url())) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });

  try {
    await page.goto(`http://localhost:${PORT}${urlPath}`, { waitUntil: 'networkidle0', timeout: NAV_TIMEOUT });
    await page.waitForSelector('body[data-ssg-ready]', { timeout: READY_TIMEOUT });

    let html = await page.content();
    // 静的HTMLを直接開いた場合、JSが同じ内容をもう一度描画する。二重描画自体は
    // 実害が無いが、クローラーに見せたいのは保存時点の中身なのでそのまま保存する。
    html = html.replace(/<body([^>]*)data-ssg-ready="[^"]*"/, '<body$1');

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    return true;
  } catch (err) {
    console.warn(`  ${urlPath} の描画に失敗しました: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  const schools = readSchools().filter(s => s.status === 'active');
  if (schools.length === 0) {
    console.log('掲載中のレコードがないため、静的化するページがありません。');
    return;
  }

  // 掲載のあるジャンルだけページを作る（0件のページを作っても検索結果で価値がない）。
  const genres = GENRE.filter(g => schools.some(s => s.skill_genre.includes(g)));

  console.log(`Prerendering ${schools.length} school page(s) and ${genres.length} category page(s)...`);

  const server = await startStaticServer();
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (err) {
    await new Promise(resolve => server.close(resolve));
    throw new Error(`puppeteer を起動できませんでした: ${err.message}`);
  }

  let written = 0;
  let failed = 0;

  try {
    for (const school of schools) {
      const ok = await renderPage(browser, `/school/${school.id}/`, path.join(ROOT, 'school', school.id));
      if (ok) written += 1; else failed += 1;
    }
    for (const genre of genres) {
      const ok = await renderPage(browser, `/category/${genre}/`, path.join(ROOT, 'category', genre));
      if (ok) written += 1; else failed += 1;
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  console.log(`Prerender finished: ${written} page(s) written, ${failed} failed.`);
  // 1ページでも落ちたら気づけるように、終了コードを非ゼロにする
  // （静かに古いページが残り続けるのを避ける）。
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, startStaticServer, renderPage, PORT };
