'use strict';

/**
 * faq.html の「よくある質問」から、FAQPage の構造化データを組み立てて同じファイルに埋め込む。
 *
 * 【なぜ手書きしないか】
 * 構造化データは、検索結果やAIの回答にそのまま引用される。手で書くと、ページ本文を直したのに
 * 構造化データだけ古いまま、という食い違いが必ず起きる。それは「ページに書いていないことを
 * 外に出す」ことそのものなので、本文から機械的に作り、ズレていないかをテストで確かめる。
 *
 * 実行: cd scraper && node build-faq-jsonld.js
 * 確認: npm test（test/faq-jsonld.test.js がこのファイルの出力と faq.html を突き合わせる）
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const FAQ_PATH = path.join(ROOT, 'faq.html');
const SITE_URL = 'https://skillup-zukan.net';
const SCRIPT_ID = 'faq-ld';

/** 本文から質問と回答を取り出す。回答は .qa 内の段落・箇条書きをそのまま連ねたもの。 */
function extractQa(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.qa').each((_, el) => {
    const block = $(el);
    const question = block.find('h2').first().text().trim();
    const parts = [];
    block.find('p, li').each((__, node) => {
      const text = $(node).text().replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    });
    if (question && parts.length) items.push({ question, answer: parts.join('\n') });
  });
  return items;
}

function buildFaqLd(html) {
  const items = extractQa(html);
  if (items.length === 0) throw new Error('faq.html から質問を取り出せませんでした');

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: 'よくある質問', item: `${SITE_URL}/faq.html` },
        ],
      },
      {
        '@type': 'FAQPage',
        url: `${SITE_URL}/faq.html`,
        inLanguage: 'ja',
        mainEntity: items.map(item => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
    ],
  };
}

/** 構造化データのタグを差し替えた（または追加した）HTMLを返す。 */
function applyFaqLd(html) {
  const tag = `<script type="application/ld+json" id="${SCRIPT_ID}">` +
    JSON.stringify(buildFaqLd(html)) + '</script>';
  const existing = new RegExp(
    `<script type="application/ld\\+json" id="${SCRIPT_ID}">[\\s\\S]*?</script>`
  );
  if (existing.test(html)) return html.replace(existing, tag);
  return html.replace('</head>', `${tag}\n</head>`);
}

function main() {
  const html = fs.readFileSync(FAQ_PATH, 'utf8');
  const next = applyFaqLd(html);
  if (next === html) {
    console.log('faq.html の構造化データは最新です。');
    return;
  }
  fs.writeFileSync(FAQ_PATH, next, 'utf8');
  console.log(`faq.html に FAQPage を書き込みました（質問 ${extractQa(html).length} 件）。`);
}

if (require.main === module) main();

module.exports = { extractQa, buildFaqLd, applyFaqLd, FAQ_PATH, SCRIPT_ID };
