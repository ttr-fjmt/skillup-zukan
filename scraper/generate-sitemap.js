'use strict';

/**
 * sitemap.xml と llms.txt を生成する。
 *
 * sitemap.xml は検索エンジン向け。llms.txt は、生成AIのクローラーに対して
 * 「このサイトは何で、どこに何があるか」を平文で伝えるためのもの（既存2サイトと同じ運用）。
 *
 * 実行: node generate-sitemap.js
 */

const fs = require('fs');
const path = require('path');

const { GENRE, GENRE_LABELS } = require('./lib/schema');
const { readSchools } = require('./lib/schools-store');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://skillup-zukan.net';

/** そのレコードの最終更新日（YYYY-MM-DD）。壊れていれば今日の日付にする。 */
function lastmod(school) {
  const t = Date.parse(school.updated_at || '');
  return new Date(Number.isNaN(t) ? Date.now() : t).toISOString().slice(0, 10);
}

function buildSitemap(schools, genres) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, lastmod: today, priority: '1.0', changefreq: 'daily' },
    ...genres.map(g => ({ loc: `${SITE}/category/${g}/`, lastmod: today, priority: '0.8', changefreq: 'weekly' })),
    ...schools.map(s => ({ loc: `${SITE}/school/${s.id}/`, lastmod: lastmod(s), priority: '0.7', changefreq: 'weekly' })),
    { loc: `${SITE}/faq.html`, lastmod: today, priority: '0.3', changefreq: 'monthly' },
    { loc: `${SITE}/privacy.html`, lastmod: today, priority: '0.3', changefreq: 'yearly' },
  ];

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u =>
      '  <url>\n' +
      `    <loc>${u.loc}</loc>\n` +
      `    <lastmod>${u.lastmod}</lastmod>\n` +
      `    <changefreq>${u.changefreq}</changefreq>\n` +
      `    <priority>${u.priority}</priority>\n` +
      '  </url>'
    ).join('\n') +
    '\n</urlset>\n';
}

function buildLlmsTxt(schools, genres) {
  const byGenre = genres.map(g => {
    const list = schools.filter(s => s.skill_genre.includes(g));
    return `- ${GENRE_LABELS[g]}（${list.length}件）: ${SITE}/category/${g}/`;
  });

  return [
    '# スキルアップ図鑑（skillup-zukan.net）',
    '',
    '社会人の学び直し・リスキリング講座を比較できるサイトです。',
    `プログラミング、Webデザイン、UI/UX、動画編集、Webマーケティング、生成AI・DX、語学、資格の8ジャンル、${schools.length}件を掲載しています。`,
    '',
    '## 掲載情報の作り方',
    '',
    '掲載内容は各スクールの公式サイトから自動収集しています。',
    '収集した値は、公式サイト本文に実際に書かれているかを機械的に照合してから掲載しており、',
    '確認できなかった項目は「要問い合わせ」「公式サイトで確認できず」と明示して、推測で埋めていません。',
    '料金・受講期間・給付金の対象可否は変更されることがあるため、最新の情報は各公式サイトでご確認ください。',
    '',
    '## ジャンル別の一覧',
    '',
    ...byGenre,
    '',
    '## 各講座のページ',
    '',
    `${SITE}/school/{id}/ の形式です。一覧は sitemap.xml を参照してください。`,
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n');
}

function main() {
  const schools = readSchools().filter(s => s.status === 'active');
  const genres = GENRE.filter(g => schools.some(s => s.skill_genre.includes(g)));

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), buildSitemap(schools, genres), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), buildLlmsTxt(schools, genres), 'utf8');

  console.log(`Wrote sitemap.xml (${schools.length + genres.length + 3} URLs) and llms.txt`);
}

if (require.main === module) {
  main();
}

module.exports = { buildSitemap, buildLlmsTxt, SITE };
