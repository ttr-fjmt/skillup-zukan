'use strict';

/**
 * ポータル・マーケットプレイスの除外判定。
 *
 * 掲載対象は「自社で講座を提供しているスクール」に限る（他社の講座を集めたサイトは、
 * 講座ごとに料金も期間も違い、この図鑑の比較軸が埋まらないため）。
 *
 * このテストで一番大事なのは誤判定を出さないこと。キーワードは掲載中の実データ19件で
 * 較正し、スクール17件に1件もヒットしないものだけを採用している。
 */

process.env.SCRAPER_MIN_DELAY_MS = '0';
process.env.SCRAPER_JITTER_MS = '0';

const test = require('node:test');
const assert = require('node:assert');

const { looksLikePortal, portalMarkers, PORTAL_MARKERS } = require('../lib/portal-filter');
const discovery = require('../lib/school-discovery');

const pageWith = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

test('looksLikePortal: 講座検索ポータルを検出する（マナビDXの実例）', () => {
  const text = 'マナビDX デジタルスキル標準に対応した講座検索。講座を掲載したい事業者の方へ。掲載講座一覧。';
  assert.strictEqual(looksLikePortal(text), true);
  assert.ok(portalMarkers(text).includes('講座検索'));
});

test('looksLikePortal: 講座出品型のマーケットプレイスを検出する（ストアカの実例）', () => {
  const text = 'まなびのマーケット。先生を探す / 先生になる / 教えたい方はこちら。掲載講座 36,994件。';
  assert.strictEqual(looksLikePortal(text), true);
});

test('looksLikePortal: 自社で講座を提供するスクールは検出しない', () => {
  const cases = [
    '現役エンジニアがマンツーマンで指導するプログラミングスクール。転職サポートあり。',
    '全国に教室を展開。目的別のコースから選べます。無料体験受付中。',
    '短期集中スタイルと夜間・休日スタイルの2つの学習スタイルを提供。',
  ];
  for (const text of cases) assert.strictEqual(looksLikePortal(text), false, text);
});

test('「講座を探す」は判定に使わない（実在のスクールにもヒットするため）', () => {
  // Winスクール（全国に教室を持つ実在のスクール）のトップページに存在する語。
  // 較正でスクール側にヒットしたため、キーワードから外している。
  assert.ok(!PORTAL_MARKERS.includes('講座を探す'));
  assert.strictEqual(looksLikePortal('お近くの教室で受講できる講座を探す'), false);
});

test('looksLikePortal: 空文字・null でも例外を投げない', () => {
  assert.strictEqual(looksLikePortal(''), false);
  assert.strictEqual(looksLikePortal(null), false);
});

test('discoverCandidates: ポータルは実在照合を通ってもスキップされ、理由が記録される', async () => {
  const originals = {
    searchGenreCandidates: discovery.searchGenreCandidates,
    fetchWithVerifyUA: discovery.fetchWithVerifyUA,
  };
  discovery.searchGenreCandidates = async () => [
    { name: '講座ポータル', website: 'https://portal.example.com/' },
    { name: '普通のスクール', website: 'https://school.example.com/' },
  ];
  discovery.fetchWithVerifyUA = async url =>
    url.includes('portal')
      ? pageWith('講座ポータル', '講座ポータルです。講座を掲載したい方へ。掲載講座の一覧。'.repeat(10))
      : pageWith('普通のスクール', '普通のスクールが自社で講座を提供しています。'.repeat(20));

  try {
    const { verified, skipped } = await discovery.discoverCandidates(['genai_dx'], [], 10);
    assert.deepStrictEqual(verified.map(v => v.candidate.name), ['普通のスクール']);
    assert.deepStrictEqual(skipped.map(s => [s.candidate.name, s.reason]), [['講座ポータル', 'portal_or_marketplace']]);
  } finally {
    Object.assign(discovery, originals);
  }
});

test('発見プロンプトにポータル除外の指示が含まれている', () => {
  // 指示と機械チェックの二重で守る（プロンプトだけでは守られなかった実例が複数ある）。
  assert.match(discovery.DISCOVERY_COMMON_RULES, /ポータル・講座検索サイト・マーケットプレイスは/);
});
