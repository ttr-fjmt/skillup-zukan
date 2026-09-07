'use strict';

/**
 * official_name の合成防止（回帰テスト）。
 *
 * 【背景】初回の本番実行（run 34134500873）で、3件すべての公式サイト本文に「株式会社」が
 * 含まれていなかったにもかかわらず、AIがフッターの著作権表記 "© 2026 Brewus,Inc." から
 * 「株式会社Brewus」を合成した。正しくは「株式会社ブリューアス」で、実在の法人についての
 * 誤情報になっていた。
 *
 * プロンプト側の禁止指示だけでは同じ誤りが再発しうる（当時のプロンプトにも
 * 「本文から読み取れなければ null」とは書いてあった）ため、verifyCandidate() が
 * スクール名の実在をページ本文で機械的に照合するのと同じやり方で、出力を本文と
 * 突き合わせる層を入れてある。このテストはその層を固定する。
 */

const test = require('node:test');
const assert = require('node:assert');

const { verifyOfficialName, normalizeStructuredFields } = require('../lib/school-discovery');

const baseFields = {
  skill_genre: ['programming'],
  purpose: ['career_change'],
  target_level: 'beginner',
  format: 'online',
  area: [],
};

test('verifyOfficialName: 本文に一字一句あればそのまま採用する', () => {
  const pageText = '会社概要 会社名 株式会社ブリューアス 所在地 東京都渋谷区';
  assert.strictEqual(verifyOfficialName('株式会社ブリューアス', pageText), '株式会社ブリューアス');
});

test('verifyOfficialName: 本文に無い表記は null にする', () => {
  const pageText = 'プログラミングスクールの紹介 © 2026 Brewus,Inc. All Rights Reserved.';
  assert.strictEqual(verifyOfficialName('株式会社Brewus', pageText), null);
});

test('verifyOfficialName: 著作権表記の英語社名からの日本語法人格の合成を弾く（実際に起きた誤り）', () => {
  const cases = [
    ['株式会社Brewus', '© 2026 Brewus,Inc. All Rights Reserved.'],
    ['株式会社SAMURAI', '© SAMURAI, Inc. All Rights Reserved.'],
    ['株式会社div', '© div, Inc.All Rights Reserved.'],
  ];
  for (const [synthesized, pageText] of cases) {
    assert.strictEqual(verifyOfficialName(synthesized, pageText), null, synthesized);
  }
});

test('verifyOfficialName: カタカナ⇔英字の変換も弾く', () => {
  assert.strictEqual(verifyOfficialName('株式会社ブリューアス', '© 2026 Brewus,Inc.'), null);
  assert.strictEqual(verifyOfficialName('Brewus, Inc.', '会社名 株式会社ブリューアス'), null);
});

test('verifyOfficialName: 空白・全角空白の違いは無視して照合する', () => {
  assert.strictEqual(verifyOfficialName('株式会社 サンプル', '会社名　株式会社サンプル 設立'), '株式会社 サンプル');
});

test('verifyOfficialName: null はそのまま null', () => {
  assert.strictEqual(verifyOfficialName(null, '会社名 株式会社サンプル'), null);
  assert.strictEqual(verifyOfficialName('', '会社名 株式会社サンプル'), null);
});

test('verifyOfficialName: pageText が無ければ照合をスキップする（既存の呼び出しを壊さない）', () => {
  assert.strictEqual(verifyOfficialName('株式会社サンプル', undefined), '株式会社サンプル');
});

test('normalizeStructuredFields: 本文に無い official_name は null に落ちる', () => {
  const result = normalizeStructuredFields(
    { ...baseFields, official_name: '株式会社Brewus' },
    'programming',
    'オンラインスクールです。© 2026 Brewus,Inc.'
  );
  assert.strictEqual(result.official_name, null);
});

test('normalizeStructuredFields: 本文にある official_name は残る', () => {
  const result = normalizeStructuredFields(
    { ...baseFields, official_name: '株式会社ブリューアス' },
    'programming',
    '会社名 株式会社ブリューアス 事業内容 プログラミング教育事業'
  );
  assert.strictEqual(result.official_name, '株式会社ブリューアス');
});

test('掲載中のレコードの official_name に、英語の法人格表記がそのまま残っていない', () => {
  const schools = require('../../data/schools.json');
  // ルール上、英語表記しか確認できない場合は null にする（英語表記をそのまま載せない）。
  // なお「株式会社+ASCII」を合成の目印にはできない — 株式会社SAMURAI のように、
  // ASCII を含む正式名称が実在するため（このテストを最初にその形で書いて誤検知した）。
  for (const school of schools) {
    if (!school.official_name) continue;
    assert.ok(
      !/(,\s*)?(Inc\.|Co\.,?\s*Ltd\.|LLC|Corp\.)$/i.test(school.official_name),
      `${school.id}: official_name "${school.official_name}" が英語法人格のままです`
    );
  }
});
