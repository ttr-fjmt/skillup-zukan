'use strict';

/**
 * 公開中の skillup-zukan.net が、リポジトリの状態どおりになっているかを確かめる。
 * 変更を main にマージして GitHub Pages の反映が終わったあとに実行する。
 *
 * 確かめること
 *   - サイトマップに、検索対象外（中身を確認できなかった講座）のページが混ざっていない
 *   - 検索対象外の講座ページには noindex、中身のある講座ページには無い
 *   - サイトマップと llms.txt に解説記事が載っている
 *   - 解説記事が開け、AdSense のタグがある
 *   - 固定ページに AdSense のタグと、解説記事へのリンクがある
 *
 * 確認対象は毎回 data/schools.json と lib/indexing.js から選ぶので、掲載が増えてもそのまま使える。
 * 反映直後は古いキャッシュが返ることがあるので、失敗したら数分おいて再実行する。
 *
 * 実行: cd scraper && npm run verify-live   （問題があれば終了コード1）
 */

const https = require('https');

const { readSchools } = require('./lib/schools-store');
const { isIndexableSchool } = require('./lib/indexing');
const { GUIDES } = require('./generate-guide-pages');

const BASE = 'https://skillup-zukan.net';

function get(url) {
  const sep = url.includes('?') ? '&' : '?';
  return new Promise((resolve, reject) => {
    https.get(`${url}${sep}nocache=${Date.now()}`, { headers: { 'user-agent': 'zukan-verify-live' } }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  let ok = true;
  const check = (label, cond, detail = '') => {
    console.log(`${cond ? '✔' : '✖'} ${label}${detail ? `  ${detail}` : ''}`);
    if (!cond) ok = false;
  };
  const NOINDEX = /<meta name="robots" content="noindex,follow">/;

  const schools = readSchools().filter(s => s.status === 'active');
  const excluded = schools.filter(s => !isIndexableSchool(s));
  const indexable = schools.filter(s => isIndexableSchool(s));

  const sitemap = await get(`${BASE}/sitemap.xml`);
  const leaked = excluded.filter(s => sitemap.body.includes(`/school/${s.id}/`));
  check('サイトマップに検索対象外の講座が無い', sitemap.status === 200 && leaked.length === 0,
    `${(sitemap.body.match(/<url>/g) || []).length} URL / 混入 ${leaked.length}`);
  check('サイトマップに解説記事がある', GUIDES.every(g => sitemap.body.includes(`${BASE}/guide/${g.slug}/`)));

  const llms = await get(`${BASE}/llms.txt`);
  check('llms.txt に解説記事がある', llms.status === 200 && GUIDES.every(g => llms.body.includes(`${BASE}/guide/${g.slug}/`)));

  for (const s of excluded) {
    const r = await get(`${BASE}/school/${s.id}/`);
    check(`検索対象外の講座に noindex（${s.id}）`, r.status === 200 && NOINDEX.test(r.body));
  }
  if (indexable.length) {
    const r = await get(`${BASE}/school/${indexable[0].id}/`);
    check('検索対象の講座に noindex が無い', r.status === 200 && !/name="robots"/.test(r.body), `/school/${indexable[0].id}/`);
  }

  for (const p of ['/guide/'].concat(GUIDES.map(g => `/guide/${g.slug}/`))) {
    const r = await get(BASE + p);
    check(`記事 ${p}`, r.status === 200 && r.body.includes('adsbygoogle.js') && !/name="robots"/.test(r.body), String(r.status));
  }
  for (const p of ['/', '/faq.html', '/privacy.html']) {
    const r = await get(BASE + p);
    check(`${p} に AdSense のタグと記事へのリンク`, r.status === 200 && r.body.includes('adsbygoogle.js') && r.body.includes('href="/guide/"'), String(r.status));
  }

  console.log(ok ? 'ALL OK' : 'NG あり（反映直後なら数分おいて再実行）');
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error(`確認できませんでした: ${err.message}`);
  process.exit(1);
});
