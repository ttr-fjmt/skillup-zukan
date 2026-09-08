'use strict';

/**
 * SNS共有用の画像（ogp-image.png / 1200x630）を作る。
 *
 * 既存2サイト（agent-zukan / freelance-anken-zukan）の画像に見た目を合わせている。
 * 手で画像を作らずスクリプトにしているのは、キャッチコピーやブランド色を変えたときに
 * 同じ手順で作り直せるようにするため。
 *
 * 日本語フォントが入っている環境で実行すること（Windows/macOSのローカルを想定）。
 * フォントの無いCI上で走らせると、文字が豆腐になった画像が出来てしまう。
 *
 * 実行: cd scraper && node generate-ogp.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'ogp-image.png');

const WIDTH = 1200;
const HEIGHT = 630;

/** favicon.svg と同じ「開いた本＋右肩上がりの線」のマーク。 */
const MARK = `
  <path d="M12 20h16c2.2 0 4 1.8 4 4v24c0-2.2-1.8-4-4-4H12z" fill="#fff"/>
  <path d="M52 20H36c-2.2 0-4 1.8-4 4v24c0-2.2 1.8-4 4-4h16z" fill="#fff" opacity=".82"/>
  <path d="M18 40l6-7 5 4 8-11" stroke="#B35C10" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
`;

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;
    font-family:"Yu Gothic","Hiragino Sans","Noto Sans JP","Meiryo",sans-serif;
    background:linear-gradient(135deg,#E67E22 0%,#C4661A 55%,#9E4E0C 100%);
    position:relative;color:#fff}
  .blob{position:absolute;border-radius:50%;background:rgba(255,255,255,.07)}
  .b1{width:520px;height:520px;top:-180px;right:-120px}
  .b2{width:300px;height:300px;bottom:-120px;left:-80px}
  .b3{width:170px;height:170px;bottom:120px;left:180px;background:rgba(255,255,255,.05)}
  .inner{position:absolute;inset:0;display:flex;align-items:center;gap:44px;padding:0 96px}
  .mark{width:158px;height:158px;border-radius:38px;background:rgba(255,255,255,.15);
    display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .mark svg{width:126px;height:126px}
  h1{font-size:76px;font-weight:700;letter-spacing:.02em;line-height:1.15;margin-bottom:18px}
  .tagline{font-size:30px;font-weight:500;opacity:.95;letter-spacing:.01em}
  .chips{display:flex;gap:14px;margin-top:30px}
  .chip{background:rgba(255,255,255,.18);border-radius:999px;padding:11px 24px;
    font-size:23px;font-weight:500;white-space:nowrap}
  .domain{position:absolute;left:0;right:0;bottom:46px;text-align:center;
    font-size:23px;letter-spacing:.06em;opacity:.8}
</style></head><body>
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
  <div class="inner">
    <div class="mark"><svg viewBox="8 14 48 40">${MARK}</svg></div>
    <div>
      <h1>スキルアップ図鑑</h1>
      <div class="tagline">学び直しの講座選びに、もう迷わない</div>
      <div class="chips">
        <span class="chip">料金・受講期間で比較</span>
        <span class="chip">あなたに合う講座を診断</span>
      </div>
    </div>
  </div>
  <div class="domain">skillup-zukan.net</div>
</body></html>`;
}

async function main() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(buildHTML(), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(OUT_PATH, buf);
    console.log(`Wrote ${path.basename(OUT_PATH)} (${WIDTH}x${HEIGHT}, ${(buf.length / 1024).toFixed(1)}KB)`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildHTML, OUT_PATH, WIDTH, HEIGHT };
