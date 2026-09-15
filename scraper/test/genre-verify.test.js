'use strict';

/**
 * lib/genre-verify.js（ジャンルの本文照合）の検証。
 *
 * 他の項目はすべて本文照合しているのに skill_genre だけ照合が無く、
 * 当サイトの守備範囲外の講座が近そうなジャンルへ押し込まれていた。
 * その再発をここで止める。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { GENRE_EVIDENCE, MIN_JUDGABLE_LENGTH, verifyGenres, genreEvidence } = require('../lib/genre-verify');
const { GENRE } = require('../lib/schema');

const pad = text => text + 'あ'.repeat(MIN_JUDGABLE_LENGTH);

test('全ジャンルに裏付け語が定義されている', () => {
  for (const g of GENRE) {
    assert.ok(GENRE_EVIDENCE[g] && GENRE_EVIDENCE[g].length > 0, `${g} の裏付け語が無い`);
  }
});

test('裏付けの無いジャンルは落とす', () => {
  // 実際に起きた取り違え: 美容の施術講座が「UI/UXデザイン」になっていた。
  const page = pad('剥けないハーブピーリングを自宅で学べるスターターキット講座。エステサロンと同等の施術。');
  const { genres, dropped, judged } = verifyGenres(['uiux'], page);
  assert.ok(judged);
  assert.deepStrictEqual(genres, []);
  assert.deepStrictEqual(dropped, ['uiux']);
});

test('裏付けのあるジャンルは残す', () => {
  const page = pad('Webデザインとコーディングを学べるスクール。Photoshopも扱います。');
  const { genres, dropped } = verifyGenres(['webdesign', 'uiux'], page);
  assert.deepStrictEqual(genres, ['webdesign']);
  assert.deepStrictEqual(dropped, ['uiux']);
});

test('資格名だけで書かれた資格スクールも裏付けられる', () => {
  // 実際に起きた取りこぼし: EBA中小企業診断士スクールの紹介文は「中小企業診断士試験」
  // とは書くが「資格」「検定」とは書かず、裏付けゼロになって日次ワークフローが止まった。
  const page = pad('過去問や再現答案等のデータ分析に基づき、中小企業診断士試験合格に向けたカリキュラムを提供しています。');
  const { genres, dropped } = verifyGenres(['certification'], page);
  assert.deepStrictEqual(genres, ['certification']);
  assert.deepStrictEqual(dropped, []);
});

test('塾でも出る言葉だけでは資格とみなさない', () => {
  // 「試験」「合格」「講座」「受験」「過去問」を裏付けにすると、中高生向けの学習塾が
  // 「資格」として通ってしまう。資格名が無いものは落とし続ける。
  const page = pad('中学生・高校生向けの学習塾。志望校合格に向けた受験指導と、過去問演習の講座を行っています。');
  const { genres, dropped, judged } = verifyGenres(['certification'], page);
  assert.ok(judged);
  assert.deepStrictEqual(genres, []);
  assert.deepStrictEqual(dropped, ['certification']);
});

test('本文が短すぎるときは何も落とさない', () => {
  // JavaScriptで描画するサイトは本文がほとんど取れない。そこで落とすと、
  // 実在のスクール（SHElikes）が掲載できなくなる。
  const { genres, dropped, judged } = verifyGenres(['webdesign', 'video_editing'], '短い本文');
  assert.strictEqual(judged, false);
  assert.deepStrictEqual(genres, ['webdesign', 'video_editing']);
  assert.deepStrictEqual(dropped, []);
});

test('空の入力でも例外にならない', () => {
  assert.deepStrictEqual(verifyGenres(null, null).genres, []);
  assert.deepStrictEqual(verifyGenres([], pad('本文')).genres, []);
});

test('掲載中の実データで、付与済みジャンルが説明文から裏付けられる', () => {
  // 較正の前提が崩れていないかの目安。ページ本文の代わりに、
  // 本文から作られた説明文・特徴で確認する（テストで通信しないため）。
  const schools = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'schools.json'), 'utf8'));
  const { NOT_DISCLOSED_TEXT } = require('../lib/schema');
  const suspicious = [];
  for (const s of schools.filter(x => x.status === 'active')) {
    // 公式サイトの本文をそもそも取得できず、何も確認できていないレコードは判定しない
    // （判定できないものを落とすと、実在のスクールを消してしまう）。
    if (s.description === NOT_DISCLOSED_TEXT && (s.features || []).length === 0) continue;
    const text = pad([s.school_name, s.description, ...(s.features || []), ...(s.career_paths || [])].join(' '));
    // 説明文がどのジャンルの語も含まない（例:「全国展開するパソコン教室」のような
    // 汎用的な紹介文）レコードは、この代用テキストでは判定しようがない。
    // 本番の照合はページ本文に対して行う（発見時と recheck-guards）。
    const informative = GENRE.some(g => (GENRE_EVIDENCE[g] || []).some(w => text.includes(w)));
    if (!informative) continue;
    const { dropped } = verifyGenres(s.skill_genre, text);
    // 説明文は本文の要約なので、すべてのジャンルが裏付けられるとは限らない。
    // 「1つも裏付けられない」レコードだけを問題とみなす。
    if (dropped.length === s.skill_genre.length) suspicious.push(`${s.id}(${s.skill_genre.join(',')})`);
  }
  assert.deepStrictEqual(suspicious, [], `ジャンルの裏付けが1つも無いレコード: ${suspicious.join(' / ')}`);
});

test('ジャンルの照合が発見パイプラインに組み込まれている', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'school-discovery.js'), 'utf8');
  assert.match(src, /verifyGenres\(result\.skill_genre, pageText\)/, '本文照合が呼ばれていない');
  // 判定できたうえで0件になったものを、発見時のジャンルで埋め戻してはいけない。
  assert.match(src, /!genreCheck\.judged/, '判定済みでも補完してしまう');
});
