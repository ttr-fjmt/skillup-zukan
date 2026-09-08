'use strict';

/**
 * SNSのリリース告知用の縦長画像を書き出す（docs/article-images/）。
 * 図鑑シリーズ3サイト分をまとめて作る。
 *
 * 実際に公開中のサイトを撮影し、パソコンとスマホの枠にはめ込む。
 * 作り物の画面を描くと実物と食い違うので、必ず本物を撮る。
 *
 * 撮影のときは広告・アクセス解析を読み込ませない。
 * 広告が入らないと枠が空白のまま写り、告知画像としては見栄えが悪いため。
 *
 * 実行:
 *   cd scraper && node generate-sns-image.js            # 3サイトすべて
 *   SNS_ONLY=agent,freelance node generate-sns-image.js  # 一部だけ
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'article-images');
const ONLY = (process.env.SNS_ONLY || '').split(',').map(v => v.trim()).filter(Boolean);

/** 撮影中に読み込ませないホスト（広告・解析）。 */
const BLOCKED = /googlesyndication\.com|doubleclick\.net|googleadservices\.com|googletagmanager\.com|google-analytics\.com/;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/**
 * サイトごとの設定。ブランド色は各サイトの実際の色に合わせている
 * （3サイトで色を分ける方針のため、告知画像でも揃えない）。
 */
const SITES = [
  {
    key: 'skillup',
    url: 'https://skillup-zukan.net/',
    prefix: '06',
    name: 'スキルアップ', mark: '図鑑',
    tagline: '学び直しの講座選びに、もう迷わない',
    domain: 'skillup-zukan.net',
    note: 'プログラミング・動画編集・語学・資格まで、料金で比べられます',
    eyebrow: '公開しました',
    brand: '#E67E22', deep: '#B35C10',
    bg: 'linear-gradient(170deg,#FFFCF8 0%,#FDF1E4 58%,#F7DFC6 100%)',
    glow: 'rgba(230,126,34,.20)',
  },
  {
    key: 'agent',
    url: 'https://agent-zukan.net/',
    prefix: '08',
    name: '転職エージェント', mark: '図鑑',
    tagline: '全国のエージェントから、あなたに合う1社を',
    domain: 'agent-zukan.net',
    note: '全国のエージェントを、対応エリア・特化職種で比べられます',
    eyebrow: 'リニューアルしました',
    brand: '#1F6F63', deep: '#123F38',
    bg: 'linear-gradient(170deg,#FBFDFC 0%,#E9F3F1 58%,#D3E7E2 100%)',
    glow: 'rgba(31,111,99,.18)',
  },
  {
    key: 'freelance',
    url: 'https://freelance-anken-zukan.net/',
    prefix: '10',
    name: 'フリーランス案件', mark: '図鑑',
    tagline: '案件紹介サービスを、条件でまとめて比べる',
    domain: 'freelance-anken-zukan.net',
    note: 'フリーランス向けの案件紹介サービスを、特化職種・フィーで比べられます',
    eyebrow: 'リニューアルしました',
    brand: '#1D5FA8', deep: '#123A6B',
    bg: 'linear-gradient(170deg,#FBFCFE 0%,#E9F0F8 58%,#D2E1F1 100%)',
    glow: 'rgba(29,95,168,.18)',
  },
];

/** 縦長のサイズ違い。中身は同じで、余白と文字サイズだけ変える。 */
const VARIANTS = [
  {
    suffix: '4x5', width: 1080, height: 1350,
    label: '4:5・X/Instagramのフィード向け',
    layout: {
      glow1: '620px', glow1Top: '-8%', glow2: '520px',
      headTop: 104, eyebrow: 22, h1: 68, h1Gap: 30, tag: 27, tagGap: 22,
      stageTop: 424, stageH: 700,
      laptopLeft: 52, laptopW: 856, laptopRadius: 20, laptopBezel: 12,
      laptopBaseW: 936, laptopBaseH: 18,
      phoneRight: 42, phoneTop: 178, phoneW: 224, phoneRadius: 32, phoneBezel: 10,
      footBottom: 118, url: 30, note: 21,
    },
  },
  {
    suffix: '9x16', width: 1080, height: 1920,
    label: '9:16・ストーリーズ向け',
    layout: {
      glow1: '720px', glow1Top: '2%', glow2: '640px',
      headTop: 250, eyebrow: 24, h1: 82, h1Gap: 36, tag: 31, tagGap: 26,
      stageTop: 720, stageH: 900,
      laptopLeft: 52, laptopW: 880, laptopRadius: 22, laptopBezel: 13,
      laptopBaseW: 960, laptopBaseH: 20,
      phoneRight: 42, phoneTop: 196, phoneW: 246, phoneRadius: 34, phoneBezel: 11,
      footBottom: 250, url: 34, note: 24,
    },
  },
];

async function shoot(browser, url, viewport, mobile = false) {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (BLOCKED.test(req.url())) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    await page.setViewport({ ...viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    // ロゴの読み込みと描画が落ち着くのを待つ。
    await new Promise(r => setTimeout(r, 2500));
    const buf = await page.screenshot({ type: 'png' });
    return 'data:image/png;base64,' + buf.toString('base64');
  } finally {
    await page.close();
  }
}

/** 告知画像を組み立てる。端末の枠はCSSで描き、画面の中身だけ実物の写真を敷く。 */
function compose(site, variant, desktopSrc, mobileSrc) {
  const { width, height, layout } = variant;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${width}px;height:${height}px;overflow:hidden;position:relative;
    font-family:"Yu Gothic","Hiragino Sans","Noto Sans JP","Meiryo",sans-serif;
    background:${site.bg};-webkit-font-smoothing:antialiased;color:#2B2118}

  /* 背景の丸。淡くして、端末を邪魔しない程度に */
  .glow{position:absolute;border-radius:50%;background:radial-gradient(circle,${site.glow},transparent 70%)}
  .g1{width:${layout.glow1};height:${layout.glow1};top:${layout.glow1Top};right:-18%}
  .g2{width:${layout.glow2};height:${layout.glow2};bottom:-12%;left:-20%}

  .head{position:absolute;left:0;right:0;top:${layout.headTop}px;text-align:center;padding:0 60px}
  .eyebrow{display:inline-block;background:${site.brand};color:#fff;font-size:${layout.eyebrow}px;
    font-weight:700;letter-spacing:.08em;border-radius:999px;padding:10px 26px}
  h1{margin-top:${layout.h1Gap}px;font-size:${layout.h1}px;font-weight:700;letter-spacing:.01em;line-height:1.25}
  h1 .mark{color:${site.deep}}
  .tagline{margin-top:${layout.tagGap}px;font-size:${layout.tag}px;color:#6B5D50;line-height:1.6}

  .stage{position:absolute;left:0;right:0;top:${layout.stageTop}px;height:${layout.stageH}px}

  /* パソコン */
  .laptop{position:absolute;left:${layout.laptopLeft}px;top:0;width:${layout.laptopW}px}
  .laptop .screen{background:#2B2118;border-radius:${layout.laptopRadius}px;padding:${layout.laptopBezel}px;
    box-shadow:0 30px 70px rgba(60,50,40,.22)}
  .laptop .screen img{display:block;width:100%;border-radius:${layout.laptopRadius - 8}px}
  .laptop .base{margin:0 auto;width:${layout.laptopBaseW}px;height:${layout.laptopBaseH}px;
    background:linear-gradient(180deg,#E4E0DA,#C6C0B8);border-radius:0 0 ${layout.laptopBaseH}px ${layout.laptopBaseH}px}

  /* スマホ（ノッチは描かない。画面のヘッダーに重なって見苦しいため） */
  .phone{position:absolute;right:${layout.phoneRight}px;top:${layout.phoneTop}px;width:${layout.phoneW}px;
    background:#2B2118;border-radius:${layout.phoneRadius}px;padding:${layout.phoneBezel}px;
    box-shadow:0 26px 56px rgba(60,50,40,.28)}
  .phone img{display:block;width:100%;border-radius:${layout.phoneRadius - 10}px}

  .foot{position:absolute;left:0;right:0;bottom:${layout.footBottom}px;text-align:center;padding:0 50px}
  .url{font-size:${layout.url}px;font-weight:700;color:${site.deep};letter-spacing:.05em}
  .note{margin-top:12px;font-size:${layout.note}px;color:#8A7B6D}
</style></head><body>
  <div class="glow g1"></div><div class="glow g2"></div>

  <div class="head">
    <span class="eyebrow">${site.eyebrow}</span>
    <h1>${site.name}<span class="mark">${site.mark}</span></h1>
    <div class="tagline">${site.tagline}</div>
  </div>

  <div class="stage">
    <div class="laptop">
      <div class="screen"><img src="${desktopSrc}" alt=""></div>
      <div class="base"></div>
    </div>
    <div class="phone"><img src="${mobileSrc}" alt=""></div>
  </div>

  <div class="foot">
    <div class="url">${site.domain}</div>
    <div class="note">${site.note}</div>
  </div>
</body></html>`;
}

async function main() {
  const targets = ONLY.length ? SITES.filter(s => ONLY.includes(s.key)) : SITES;
  if (targets.length === 0) throw new Error(`SNS_ONLY="${ONLY.join(",")}" に一致するサイトがありません`);

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const site of targets) {
      console.log(`\n撮影中: ${site.url}`);
      const desktopSrc = await shoot(browser, site.url, DESKTOP, false);
      const mobileSrc = await shoot(browser, site.url, MOBILE, true);

      for (let i = 0; i < VARIANTS.length; i += 1) {
        const v = VARIANTS[i];
        const file = `${String(Number(site.prefix) + i).padStart(2, '0')}-sns-${site.key}-${v.suffix}.png`;
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: 1 });
          await page.setContent(compose(site, v, desktopSrc, mobileSrc), { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          await new Promise(r => setTimeout(r, 300));
          const buf = await page.screenshot({ type: 'png' });
          fs.writeFileSync(path.join(OUT_DIR, file), buf);
          console.log(`  ${file}  ${v.width}x${v.height}  ${(buf.length / 1024).toFixed(0)}KB  — ${v.label}`);
        } finally {
          await page.close();
        }
      }
    }
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

module.exports = { compose, SITES, VARIANTS, OUT_DIR };
