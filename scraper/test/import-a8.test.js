'use strict';

/**
 * import-a8.js（提携案件のExcel取り込み）の検証。
 *
 * このサイトは「公式サイトに書かれていないことは載せない」が大原則のため、
 * Excelから取り込むのは提携リンクだけで、掲載内容はExcelの記入から作らない。
 * その前提が崩れていないことをここで固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { extractAffiliateUrl, parseGenreHint } = require('../import-a8');
const { GENRE, GENRE_LABELS } = require('../lib/schema');

test('リンク欄のHTMLから提携リンクのURLを取り出す', () => {
  const cell =
    '<img src="https://www.rentracks.jp/adx/p.gifx?idx=0.1" border="0" height="1" width="1">' +
    '<a href="https://www.rentracks.jp/adx/r.html?idx=0.1&dna=2" rel="nofollow noopener" target="_blank">スタートAI</a>';
  assert.strictEqual(extractAffiliateUrl(cell), 'https://www.rentracks.jp/adx/r.html?idx=0.1&dna=2');
});

test('A8形式のリンクからも取り出せる', () => {
  const cell =
    '<a href="https://px.a8.net/svt/ejp?a8mat=ABC" rel="nofollow">講座名</a>\n' +
    '<img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=ABC" alt="">';
  assert.strictEqual(extractAffiliateUrl(cell), 'https://px.a8.net/svt/ejp?a8mat=ABC');
});

test('リンクの体裁でなくURLだけ書かれていても拾う', () => {
  assert.strictEqual(extractAffiliateUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
});

test('リンクが無ければ null を返す（例外にしない）', () => {
  assert.strictEqual(extractAffiliateUrl(''), null);
  assert.strictEqual(extractAffiliateUrl(null), null);
  assert.strictEqual(extractAffiliateUrl('リンク未定'), null);
});

test('ジャンル欄の日本語ラベルを、内部のジャンルに戻せる', () => {
  for (const g of GENRE) {
    assert.strictEqual(parseGenreHint(GENRE_LABELS[g]), g, `${g} を戻せない`);
  }
});

test('当サイトのジャンルに無い言葉は、無理に当てはめない', () => {
  // ヨガ・美容・投資など、8ジャンルに無いものが紛れ込むことがある。
  for (const word of ['ヨガ', '美容', 'FX投資', '', 'その他']) {
    assert.strictEqual(parseGenreHint(word), null, `${word} を当てはめてはいけない`);
  }
});

test('Excelの紹介文を掲載に使っていない', () => {
  // 既存2サイトはExcelの紹介文からレコードを作るが、このサイトはそれを禁じている。
  // 取り込み処理が「特徴」列を読んでいないことを、コード上で担保する。
  const src = fs.readFileSync(path.join(__dirname, '..', 'import-a8.js'), 'utf8');
  assert.ok(!src.includes("'特徴（A8の紹介文）'"), '紹介文の列を読んでいる');
  assert.match(src, /buildDiscoveredSchoolFields/, '公式サイトからの抽出を通していない');
  assert.match(src, /validateSchool/, 'スキーマ検証を通していない');
});

test('取り込んだ講座は提携（affiliate）として記録される', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'import-a8.js'), 'utf8');
  assert.match(src, /cta_type: 'affiliate'/, '提携として記録していない');
  assert.match(src, /cta_type = 'affiliate'/, '既存レコードの更新で提携にしていない');
});

test('取り込んだ講座の source が、スキーマの許容値になっている', () => {
  // 'a8-import' と書いたために14件すべてが弾かれた。値の取り違えは
  // 実行して初めて分かる種類の間違いなので、ここで固定する。
  const src = fs.readFileSync(path.join(__dirname, '..', 'import-a8.js'), 'utf8');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schema', 'school.schema.json'), 'utf8'));
  const allowed = schema.properties.source.enum;

  const used = [...src.matchAll(/^\s*source: '([^']+)',/gm)].map(m => m[1]);
  assert.ok(used.length > 0, 'source を設定している箇所が見つからない');
  for (const value of used) {
    assert.ok(allowed.includes(value), `source: '${value}' はスキーマの許容値でない（${allowed.join(', ')}）`);
  }
});

test('取り込んだ講座の status も、スキーマの許容値になっている', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'import-a8.js'), 'utf8');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schema', 'school.schema.json'), 'utf8'));
  const used = [...src.matchAll(/^\s*status: '([^']+)',/gm)].map(m => m[1]);
  for (const value of used) {
    assert.ok(schema.properties.status.enum.includes(value), `status: '${value}' は許容値でない`);
  }
});
