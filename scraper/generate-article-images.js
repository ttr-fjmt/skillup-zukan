'use strict';

/**
 * note記事用のイラストを書き出す（docs/article-images/）。
 *
 * 画像生成AIではなくSVGを組み立てて描いている。日本語が崩れないこと、
 * 文言や数字をあとから直せること、記事の内容とずれないことを優先した。
 *
 * 方針: 文字は見出しと短いラベルだけにして、状況はイラストで見せる。
 *
 * 実行: cd scraper && node generate-article-images.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'article-images');

const C = {
  brand: '#E67E22',
  brandDeep: '#B35C10',
  brandSoft: '#FBE3CB',
  ink: '#2B2118',
  sub: '#7A6C5F',
  paper: '#FFFCF8',
  card: '#FFFFFF',
  line: '#E3D9CD',
  grey: '#EFE9E1',
  ng: '#C0392B',
  ngSoft: '#FBE0DC',
  ok: '#2E7D5B',
  okSoft: '#DCEFE4',
  robot: '#5B6B7A',
  robotDark: '#3D4A56',
};

/* ── 部品 ───────────────────────────────────────────── */

/** ロボット（AI役）。size=1 で幅約120px。 */
function robot(x, y, size = 1, opts = {}) {
  const s = size;
  const face = opts.confused
    ? `<path d="M-22 34 Q0 24 22 34" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>`
    : `<path d="M-22 30 Q0 44 22 30" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  return `<g transform="translate(${x},${y}) scale(${s})">
    <line x1="0" y1="-58" x2="0" y2="-38" stroke="${C.robot}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="0" cy="-64" r="9" fill="${C.brand}"/>
    <rect x="-52" y="-38" width="104" height="92" rx="26" fill="${C.robot}"/>
    <circle cx="-20" cy="4" r="9" fill="#fff"/><circle cx="20" cy="4" r="9" fill="#fff"/>
    ${face}
    <rect x="-64" y="-6" width="14" height="34" rx="7" fill="${C.robotDark}"/>
    <rect x="50" y="-6" width="14" height="34" rx="7" fill="${C.robotDark}"/>
    <rect x="-36" y="58" width="72" height="40" rx="14" fill="${C.robotDark}"/>
  </g>`;
}

/** 人（運営者役）。 */
function person(x, y, size = 1) {
  return `<g transform="translate(${x},${y}) scale(${size})">
    <circle cx="0" cy="-46" r="26" fill="${C.brandDeep}"/>
    <path d="M-40 44 Q-40 -6 0 -6 Q40 -6 40 44 Z" fill="${C.brand}"/>
  </g>`;
}

/** ブラウザーの窓。中身は行で表す。 */
function browserWindow(x, y, w, h, opts = {}) {
  const lines = [];
  const top = 46;
  const rows = Math.floor((h - top - (opts.footer ? 60 : 24)) / 22);
  for (let i = 0; i < rows; i += 1) {
    const lw = (w - 48) * (0.55 + ((i * 37) % 40) / 100);
    lines.push(`<rect x="24" y="${top + 14 + i * 22}" width="${lw}" height="9" rx="4.5" fill="${C.grey}"/>`);
  }
  const footer = opts.footer
    ? `<rect x="24" y="${h - 46}" width="${w - 48}" height="30" rx="8" fill="${C.brandSoft}"/>
       <text x="${w / 2}" y="${h - 25}" text-anchor="middle" font-size="17" font-weight="700" fill="${C.brandDeep}">${opts.footer}</text>`
    : '';
  return `<g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${w}" height="${h}" rx="16" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
    <path d="M0 16 Q0 0 16 0 H${w - 16} Q${w} 0 ${w} 16 V${top} H0 Z" fill="${C.grey}"/>
    <circle cx="24" cy="23" r="6" fill="#D9CFC4"/><circle cx="44" cy="23" r="6" fill="#D9CFC4"/><circle cx="64" cy="23" r="6" fill="#D9CFC4"/>
    ${lines.join('')}${footer}
  </g>`;
}

/** 吹き出し（下向きのしっぽ）。 */
function bubble(x, y, w, h, text, opts = {}) {
  const bg = opts.bg || C.card;
  const stroke = opts.stroke || C.line;
  const color = opts.color || C.ink;
  return `<g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="${bg}" stroke="${stroke}" stroke-width="2"/>
    <path d="M${w / 2 - 14} ${h} L${w / 2} ${h + 22} L${w / 2 + 14} ${h} Z" fill="${bg}" stroke="${stroke}" stroke-width="2"/>
    <rect x="${w / 2 - 15}" y="${h - 2}" width="30" height="4" fill="${bg}"/>
    <text x="${w / 2}" y="${h / 2 + 11}" text-anchor="middle" font-size="${opts.size || 30}" font-weight="700" fill="${color}">${text}</text>
  </g>`;
}

/** 書類カード（項目と値の行）。 */
function docCard(x, y, w, rows, opts = {}) {
  const h = 62 + rows.length * 52;
  const items = rows.map((r, i) => `
    <text x="26" y="${74 + i * 52}" font-size="21" fill="${C.sub}">${r[0]}</text>
    <text x="${w - 26}" y="${74 + i * 52}" text-anchor="end" font-size="22" font-weight="700" fill="${r[2] || C.ink}">${r[1]}</text>
    ${i < rows.length - 1 ? `<line x1="26" y1="${92 + i * 52}" x2="${w - 26}" y2="${92 + i * 52}" stroke="${C.line}" stroke-width="1.5"/>` : ''}`).join('');
  return `<g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${w}" height="${h}" rx="16" fill="${opts.bg || C.card}" stroke="${opts.stroke || C.line}" stroke-width="2"/>
    <rect x="26" y="24" width="${opts.titleWidth || 150}" height="14" rx="7" fill="${opts.accent || C.grey}"/>
    ${items}
  </g>`;
}

function badgeCircle(x, y, r, fill, mark, markColor = '#fff', size = 34) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
    <text x="${x}" y="${y + size * 0.36}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${markColor}">${mark}</text>`;
}

function arrow(x, y, len = 90, color = C.brand) {
  return `<g transform="translate(${x},${y})">
    <line x1="0" y1="0" x2="${len - 16}" y2="0" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
    <path d="M${len - 20} -11 L${len} 0 L${len - 20} 11 Z" fill="${color}"/>
  </g>`;
}

/** ふるい（フィルター）。 */
function funnel(x, y, w = 260, h = 150) {
  return `<g transform="translate(${x},${y})">
    <path d="M0 0 H${w} L${w / 2 + 34} ${h} H${w / 2 - 34} Z" fill="${C.brandSoft}" stroke="${C.brand}" stroke-width="4" stroke-linejoin="round"/>
    ${[0, 1, 2].map(i => `<line x1="${34 + i * 30}" y1="${34 + i * 22}" x2="${w - 34 - i * 30}" y2="${34 + i * 22}" stroke="${C.brand}" stroke-width="4" stroke-linecap="round" opacity=".55"/>`).join('')}
  </g>`;
}

/** 箱（受け皿・ゴミ箱）。 */
function bin(x, y, w = 180, h = 96, color = C.grey, stroke = C.line) {
  return `<g transform="translate(${x},${y})">
    <path d="M0 0 H${w} L${w - 18} ${h} H18 Z" fill="${color}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>
  </g>`;
}

/** 小さなデータの札。 */
function chipCard(x, y, w = 92, h = 40, fill = C.card, stroke = C.line, rotate = 0) {
  return `<g transform="translate(${x},${y}) rotate(${rotate})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
    <rect x="${-w / 2 + 14}" y="-8" width="${w - 40}" height="7" rx="3.5" fill="${C.grey}"/>
    <rect x="${-w / 2 + 14}" y="4" width="${w - 54}" height="7" rx="3.5" fill="${C.grey}"/>
  </g>`;
}

/** 虫めがね。 */
function magnifier(x, y, r = 34, color = C.brandDeep) {
  return `<g transform="translate(${x},${y})">
    <circle cx="0" cy="0" r="${r}" fill="#fff" fill-opacity=".9" stroke="${color}" stroke-width="7"/>
    <line x1="${r * 0.72}" y1="${r * 0.72}" x2="${r * 1.5}" y2="${r * 1.5}" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
  </g>`;
}

/* ── 図の共通枠 ─────────────────────────────────────── */

function canvas(width, height, inner, opts = {}) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0}
    body{width:${width}px;height:${height}px;overflow:hidden;background:${opts.bg || C.paper}}
    svg{display:block}
    text{font-family:"Yu Gothic","Hiragino Sans","Noto Sans JP","Meiryo",sans-serif}
  </style></head><body>
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${inner}
  </svg></body></html>`;
}

function title(x, y, main, accent = '', size = 48) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="${C.ink}">${main}<tspan fill="${C.brandDeep}">${accent}</tspan></text>`;
}

function caption(x, y, text, size = 24, anchor = 'start') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${C.sub}">${text}</text>`;
}

/* ── 各図 ───────────────────────────────────────────── */

/** 1枚目：AIが、書かれていない社名を作ってしまう場面。 */
function imageLie() {
  return canvas(1600, 900, `
    ${title(96, 108, 'AIは、', '平気で嘘をつく')}

    ${browserWindow(96, 210, 460, 470, { footer: '© 2026 Brewus,Inc.' })}
    ${magnifier(520, 640, 40)}
    ${caption(96, 726, '公式サイトに書いてあるのは、これだけ')}

    ${arrow(600, 430, 110)}

    ${robot(830, 400, 1.05, { confused: false })}
    ${bubble(700, 190, 260, 84, '株式会社Brewus', { bg: C.ngSoft, stroke: '#EFC0B8', color: C.ng, size: 27 })}
    ${caption(830, 640, 'AIが自分で組み立てた', 24, 'middle')}

    ${arrow(990, 430, 110)}

    <g transform="translate(1150,300)">
      <rect x="0" y="0" width="360" height="250" rx="20" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
      ${badgeCircle(180, 74, 34, C.okSoft, '✓', C.ok, 34)}
      <text x="180" y="150" text-anchor="middle" font-size="22" fill="${C.sub}">正しい社名</text>
      <text x="180" y="196" text-anchor="middle" font-size="30" font-weight="700" fill="${C.ink}">株式会社ブリューアス</text>
    </g>

    <g transform="translate(96,790)">
      <rect x="0" y="0" width="188" height="46" rx="23" fill="${C.brand}"/>
      <text x="94" y="31" text-anchor="middle" font-size="22" font-weight="700" fill="#fff">3件中3件</text>
      <text x="212" y="31" font-size="24" fill="${C.sub}">すべて同じ作られ方をしていました</text>
    </g>
  `);
}

/** 2枚目：お願いはすり抜ける／ふるいは通さない。 */
function imageGuard() {
  const column = (cx, label, middle, bin_, mark, markColor, cap1, cap2) => `
    <g>
      ${robot(cx, 268, 0.66)}
      ${caption(cx, 372, label, 23, 'middle')}
      ${chipCard(cx - 62, 424, 92, 40, C.ngSoft, '#EFC0B8', -7)}
      ${chipCard(cx + 62, 424, 92, 40, C.card, C.line, 6)}
      ${middle}
      ${bin_}
      ${badgeCircle(cx, 736, 28, markColor, mark, '#fff', 30)}
      ${caption(cx, 822, cap1, 26, 'middle')}
      ${caption(cx, 858, cap2, 20, 'middle')}
    </g>`;

  // 左：お願いの紙。札はその上を素通りする。
  const requestPaper = `
    <g>
      <rect x="290" y="482" width="300" height="112" rx="16" fill="none"
        stroke="${C.line}" stroke-width="3" stroke-dasharray="9 9"/>
      <text x="440" y="522" text-anchor="middle" font-size="23" fill="${C.sub}">「嘘を書かないで」</text>
      ${chipCard(378, 576, 92, 40, C.ngSoft, '#EFC0B8', -9)}
      ${chipCard(502, 576, 92, 40, C.card, C.line, 7)}
    </g>`;

  // 右：ふるい。赤い札は外へ落ちる。
  const filter = `
    <g>
      ${funnel(1030, 476, 260, 116)}
      ${caption(1160, 628, '本文と突き合わせる', 22, 'middle')}
      ${chipCard(936, 592, 92, 40, C.ngSoft, '#EFC0B8', -22)}
      <text x="936" y="546" text-anchor="middle" font-size="30" font-weight="700" fill="${C.ng}">×</text>
    </g>`;

  return canvas(1600, 900, `
    ${title(96, 100, 'お願いするのではなく、', '通らないようにする')}

    ${column(440, '指示文でお願いする', requestPaper,
      bin(350, 664, 180, 92, C.ngSoft, '#EFC0B8'), '×', C.ng,
      'そのまま世に出る', '95件は守る。破った5件は誰も気づかない')}

    <line x1="800" y1="180" x2="800" y2="820" stroke="${C.line}" stroke-width="3" stroke-dasharray="10 10"/>

    ${column(1160, '機械的に照合する', filter,
      bin(1070, 664, 180, 92, C.okSoft, '#BEE0CD'), '✓', C.ok,
      '確認できたものだけ載る', 'お願いではないので、毎回そのとおりに動く')}
  `);
}

/** 3枚目：埋めるか、空欄にするか。 */
function imageBlank() {
  return canvas(1600, 900, `
    ${title(96, 104, '確認できないものは、', '埋めない')}
    ${caption(96, 152, '全部の欄が埋まっているほうが見栄えはします。それでも空欄にしました。', 25)}

    ${person(240, 500, 1.1)}
    ${caption(240, 620, '運営者', 22, 'middle')}

    ${arrow(340, 400, 90)}
    ${arrow(340, 560, 90)}

    <g opacity=".55">
      ${docCard(470, 250, 440, [['料金', '約30万円', C.ng], ['受講期間', '3ヶ月', C.ng], ['通学エリア', '東京都', C.ng]],
        { bg: C.ngSoft, stroke: '#EFC0B8', accent: '#EFC0B8' })}
      ${badgeCircle(910, 258, 32, C.ng, '×', '#fff', 34)}
      ${caption(690, 516, 'それらしい数字で埋める', 24, 'middle')}
    </g>

    ${docCard(1010, 250, 440, [['料金', '要問い合わせ', C.ok], ['受講期間', '要問い合わせ', C.ok], ['通学エリア', 'オンラインのみ', C.ok]],
      { bg: C.okSoft, stroke: '#BEE0CD', accent: '#BEE0CD' })}
    ${badgeCircle(1450, 258, 32, C.ok, '✓', '#fff', 34)}
    ${caption(1230, 516, '確認できたものだけ書く', 24, 'middle')}

    <g transform="translate(470,606)">
      <rect x="0" y="0" width="980" height="164" rx="20" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
      <text x="44" y="70" font-size="42" font-weight="700" fill="${C.brandDeep}">50件中25件</text>
      <text x="44" y="122" font-size="23" fill="${C.sub}">料金がはっきり分かったのは半分でした</text>
      ${Array.from({ length: 10 }, (_, i) =>
        `<rect x="${560 + i * 40}" y="${44}" width="30" height="38" rx="7" fill="${i < 5 ? C.brand : C.grey}"/>`).join('')}
      <text x="560" y="124" font-size="21" fill="${C.sub}">2件に1件は「要問い合わせ」と表示しています</text>
    </g>
  `);
}

/** 4枚目：全体のしくみ。 */
function imageOverview() {
  // 番号は左上に置く（中央だと絵と重なる）。絵は箱の中央、名前は下。
  const stepBox = (x, n, label, art) => `
    <g transform="translate(${x},0)">
      <rect x="0" y="0" width="212" height="214" rx="20" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
      ${badgeCircle(34, 34, 21, C.brand, String(n), '#fff', 22)}
      <g transform="translate(106,108)">${art}</g>
      <text x="106" y="192" text-anchor="middle" font-size="22" font-weight="700" fill="${C.ink}">${label}</text>
    </g>`;

  return canvas(1600, 900, `
    ${title(96, 100, 'スキルアップ図鑑の', 'しくみ')}

    <g transform="translate(96,190)">
      ${stepBox(0, 1, 'AIが探す', robot(0, -12, 0.4))}
      ${arrow(226, 108, 66)}
      ${stepBox(312, 2, '実在するか確認',
        `${browserWindow(-54, -48, 108, 86)}${magnifier(34, 30, 19)}`)}
      ${arrow(538, 108, 66)}
      ${stepBox(624, 3, '本文から抜き出す',
        `${chipCard(-26, -12, 80, 34, C.card, C.line, -7)}${chipCard(26, 12, 80, 34, C.card, C.line, 6)}`)}
      ${arrow(850, 108, 66)}
      ${stepBox(936, 4, '13のチェック', funnel(-66, -44, 132, 80))}
      ${arrow(1162, 108, 66)}
      ${stepBox(1248, 5, '掲載',
        `${browserWindow(-54, -48, 108, 86)}${badgeCircle(40, 34, 18, C.ok, '✓', '#fff', 20)}`)}
    </g>

    <!-- 落ちたものが下の箱へ -->
    <g>
      <path d="M1138 418 Q1138 486 1040 486 L560 486 Q470 486 470 552" stroke="${C.line}" stroke-width="4"
        stroke-dasharray="10 10" fill="none"/>
      ${chipCard(700, 470, 84, 36, C.ngSoft, '#EFC0B8', -8)}
      ${chipCard(880, 470, 84, 36, C.ngSoft, '#EFC0B8', 7)}
      ${bin(380, 560, 180, 96, C.ngSoft, '#EFC0B8')}
      <text x="470" y="700" text-anchor="middle" font-size="30" font-weight="700" fill="${C.ng}">通らなかった 22件</text>
      <text x="470" y="740" text-anchor="middle" font-size="21" fill="${C.sub}">名前が本文にない／取得できない／</text>
      <text x="470" y="770" text-anchor="middle" font-size="21" fill="${C.sub}">ポータル／代行会社／ジャンル対象外</text>
    </g>

    <g transform="translate(880,560)">
      <rect x="0" y="0" width="620" height="230" rx="20" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
      <text x="40" y="66" font-size="24" font-weight="700" fill="${C.ink}">いま動いているもの</text>
      <text x="40" y="122" font-size="40" font-weight="700" fill="${C.brandDeep}">掲載 50件</text>
      <text x="300" y="122" font-size="40" font-weight="700" fill="${C.brandDeep}">テスト 349件</text>
      <text x="40" y="180" font-size="23" fill="${C.sub}">毎朝5時に、新しい講座を自動で探しています</text>
    </g>
  `);
}

/** 5枚目：サムネイル。 */
function imageThumbnail() {
  return canvas(1280, 670, `
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#E67E22"/><stop offset="55%" stop-color="#C4661A"/><stop offset="100%" stop-color="#9E4E0C"/>
    </linearGradient></defs>
    <rect x="0" y="0" width="1280" height="670" fill="url(#g)"/>
    <circle cx="1140" cy="90" r="240" fill="#fff" fill-opacity=".07"/>
    <circle cx="120" cy="600" r="170" fill="#fff" fill-opacity=".07"/>

    <g transform="translate(0,-6)">
      ${robot(1010, 320, 1.15)}
      <g transform="translate(1010,300)">
        <rect x="-150" y="-190" width="300" height="88" rx="18" fill="#fff"/>
        <path d="M-16 -102 L0 -78 L16 -102 Z" fill="#fff"/>
        <text x="0" y="-133" text-anchor="middle" font-size="30" font-weight="700" fill="${C.ng}">株式会社Brewus</text>
      </g>
      ${magnifier(866, 430, 30, '#fff')}
    </g>

    <text x="76" y="222" font-size="26" font-weight="700" fill="#fff" fill-opacity=".92">非エンジニアがAIと2日で作った</text>
    <text x="76" y="316" font-size="54" font-weight="700" fill="#fff">AIに比較サイトを</text>
    <text x="76" y="384" font-size="54" font-weight="700" fill="#fff">作らせたら、</text>
    <text x="76" y="452" font-size="54" font-weight="700" fill="#fff">嘘を書いてきた</text>
    <text x="76" y="516" font-size="25" fill="#fff" fill-opacity=".9">それらしい嘘を、どうやって止めたか</text>
    <text x="76" y="620" font-size="22" fill="#fff" fill-opacity=".8">skillup-zukan.net</text>
  `, { bg: '#9E4E0C' });
}

const IMAGES = [
  { file: '01-ai-no-uso.png', width: 1600, height: 900, html: imageLie, label: '記事内1：AIが書かれていない社名を作る' },
  { file: '02-shikumi-de-tomeru.png', width: 1600, height: 900, html: imageGuard, label: '記事内2：お願いはすり抜ける／ふるいは通さない' },
  { file: '03-umenai.png', width: 1600, height: 900, html: imageBlank, label: '記事内3：埋めるか、空欄にするか' },
  { file: '04-zentai-zukai.png', width: 1600, height: 900, html: imageOverview, label: '全体の図解' },
  { file: '05-thumbnail.png', width: 1280, height: 670, html: imageThumbnail, label: 'サムネイル' },
];

async function main() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const img of IMAGES) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: img.width, height: img.height, deviceScaleFactor: 1 });
        await page.setContent(img.html(), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const buf = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(OUT_DIR, img.file), buf);
        console.log(`${img.file}  ${img.width}x${img.height}  ${(buf.length / 1024).toFixed(0)}KB  — ${img.label}`);
      } finally {
        await page.close();
      }
    }
    console.log(`\nWrote ${IMAGES.length} image(s) to ${path.relative(ROOT, OUT_DIR)}`);
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

module.exports = { IMAGES, OUT_DIR };
