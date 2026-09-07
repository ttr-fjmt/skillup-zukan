'use strict';

/**
 * 口コミ要約パイプラインのユニットテスト。
 *
 * 最も重要なのは fail-closed の検証: 人力での robots.txt / 利用規約の確認が済んでいない
 * サイトに対して、絶対にHTTPリクエストが飛ばないこと。ここが緩むと、確認前に本番を
 * 回してしまう事故が起きうるので、テストで固定する。
 */

process.env.REVIEW_MIN_DELAY_MS = '0';
process.env.REVIEW_JITTER_MS = '0';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { checkUrlAllowed, findSourceForUrl, enabledSources, loadReviewSources } = require('../lib/review-sources');
const { extractReviewTexts, fetchReviewPage, assembleReviewSummary, MIN_REVIEWS_FOR_SUMMARY } = require('../lib/review-summary');
const { selectTargets } = require('../summarize-reviews');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'review-sources.json');

const disabled = { source_name: '未確認サイト', host: 'unchecked.example.com', enabled: false, robots_txt_ok: null, terms_ok: null, checked_by_human_at: null };
const enabled = { source_name: '確認済みサイト', host: 'checked.example.com', enabled: true, robots_txt_ok: true, terms_ok: true, checked_by_human_at: '2026-03-01' };

test('リポジトリに入っている review-sources.json は、全サイトが未確認（enabled=false）である', () => {
  const sources = loadReviewSources(CONFIG_PATH);
  assert.ok(sources.length >= 3);
  for (const source of sources) {
    assert.strictEqual(source.enabled, false, `${source.source_name} が enabled=true になっている`);
    assert.strictEqual(source.checked_by_human_at, null, `${source.source_name} に人力確認の記録が入っている`);
  }
  assert.deepStrictEqual(enabledSources(sources), []);
});

test('許可リストに無いホストは拒否される', () => {
  const result = checkUrlAllowed('https://somewhere.example.org/reviews', [enabled]);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'not_in_allowlist');
});

test('許可リストにあっても enabled=false なら拒否される', () => {
  const result = checkUrlAllowed('https://unchecked.example.com/reviews', [disabled]);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'disabled');
});

test('enabled=true でも robots_txt_ok / terms_ok / checked_by_human_at が欠けていれば拒否される', () => {
  const cases = [
    [{ ...enabled, robots_txt_ok: null }, 'robots_txt_not_confirmed'],
    [{ ...enabled, terms_ok: false }, 'terms_not_confirmed'],
    [{ ...enabled, checked_by_human_at: null }, 'human_check_missing'],
  ];
  for (const [source, expected] of cases) {
    const result = checkUrlAllowed('https://checked.example.com/reviews', [source]);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, expected);
  }
});

test('4つの条件がすべて揃ったホストだけが許可される', () => {
  assert.strictEqual(checkUrlAllowed('https://checked.example.com/reviews', [enabled]).allowed, true);
});

test('サブドメイン・www. は親ホストの設定に従う', () => {
  assert.strictEqual(checkUrlAllowed('https://www.checked.example.com/x', [enabled]).allowed, true);
  assert.strictEqual(checkUrlAllowed('https://reviews.checked.example.com/x', [enabled]).allowed, true);
  // 似ているだけの別ドメインは一致させない。
  assert.strictEqual(findSourceForUrl('https://notchecked.example.com/x', [enabled]), null);
});

test('fetchReviewPage: 未確認サイトには1度もHTTPリクエストを送らない', async () => {
  let called = 0;
  const result = await fetchReviewPage('https://unchecked.example.com/reviews', {
    fetchImpl: async () => { called += 1; return '<html></html>'; },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'not_in_allowlist');
  assert.strictEqual(called, 0, '未確認サイトにfetchが飛んでいる');
});

test('extractReviewTexts: 口コミらしいブロックを複数取り出す', () => {
  const html = `<html><body><div class="review-list">
    <p>${'この講座は課題の量が多く、毎週の締め切りに追われましたが力は付きました。'}</p>
    <p>${'メンターの返信が早く、詰まったところをその日のうちに解消できました。'}</p>
    <p>${'料金は他社と比べると高めで、そこは検討する必要があると感じました。'}</p>
    <p>星5</p>
  </div></body></html>`;
  const texts = extractReviewTexts(html);
  assert.strictEqual(texts.length, 3, '短すぎる断片が混ざっている');
  assert.ok(texts.every(t => t.length >= 30));
});

test('extractReviewTexts: 同じ文言の重複は1件に畳む（テンプレートの繰り返しを水増しに使わない）', () => {
  const dup = 'メンターの返信が早く、詰まったところをその日のうちに解消できました。';
  const others = [
    'この講座は課題の量が多く、毎週の締め切りに追われましたが力は付きました。',
    '料金は他社と比べると高めで、そこは検討する必要があると感じました。',
  ];
  const html =
    '<html><body><article>' +
    [dup, dup, dup, ...others].map(t => `<p>${t}</p>`).join('') +
    '</article></body></html>';

  const texts = extractReviewTexts(html);
  assert.strictEqual(texts.length, 3);
  assert.strictEqual(texts.filter(t => t === dup).length, 1);
});

test('extractReviewTexts: 重複を除いた結果が最低件数に満たなければ、そのページは材料にしない', () => {
  const line = 'メンターの返信が早く、詰まったところをその日のうちに解消できました。';
  const html = `<html><body><article>${`<p>${line}</p>`.repeat(5)}</article></body></html>`;
  assert.deepStrictEqual(extractReviewTexts(html), []);
});

test('extractReviewTexts: 口コミが見つからないページでは空配列を返す（本文をかき集めない）', () => {
  const html = '<html><body><nav>ホーム</nav><footer>会社概要</footer></body></html>';
    assert.deepStrictEqual(extractReviewTexts(html), []);
});

test('fetchReviewPage: 口コミが最低件数に満たないページは要約の材料にしない', async () => {
  const allowedSources = [{ ...enabled, host: 'checked.example.com' }];
  const html = `<html><body><article><p>${'この講座はとても分かりやすく、初学者でも進めやすい内容でした。'}</p></article></body></html>`;

  // 許可判定だけを差し替えるのではなく、実際の許可リストを使いたいので環境変数で差し替える。
  const original = process.env.REVIEW_SOURCES_PATH;
  const tmpPath = path.join(__dirname, 'tmp-review-sources.json');
  fs.writeFileSync(tmpPath, JSON.stringify({ sources: allowedSources }), 'utf8');
  process.env.REVIEW_SOURCES_PATH = tmpPath;
  delete require.cache[require.resolve('../lib/review-sources')];
  delete require.cache[require.resolve('../lib/review-summary')];
  const { fetchReviewPage: fetchWithTmp } = require('../lib/review-summary');

  try {
    const result = await fetchWithTmp('https://checked.example.com/reviews', {
      fetchImpl: async () => html,
    });
    assert.strictEqual(result.ok, false);
    // robots.txt の実取得は行われるため、ネットワークが無い環境では robots_check_failed になる。
    assert.ok(['too_few_reviews', 'robots_check_failed', 'robots_disallow'].includes(result.reason), result.reason);
  } finally {
    fs.unlinkSync(tmpPath);
    if (original === undefined) delete process.env.REVIEW_SOURCES_PATH;
    else process.env.REVIEW_SOURCES_PATH = original;
    delete require.cache[require.resolve('../lib/review-sources')];
    delete require.cache[require.resolve('../lib/review-summary')];
  }
});

test('assembleReviewSummary: 出典が1件も無ければ例外を投げる（要約の単独保存を防ぐ）', () => {
  assert.throws(() => assembleReviewSummary('傾向の要約文。', []), /出典が1件も無い/);
});

test('assembleReviewSummary: 要約文と出典（名前・URL・取得日時）をセットで返す', () => {
  const summary = assembleReviewSummary('傾向の要約文。', [
    { source_name: 'テスト出典', source_url: 'https://checked.example.com/r', fetchedAt: '2026-03-01T00:00:00.000Z' },
  ]);
  assert.deepStrictEqual(summary, {
    text: '傾向の要約文。',
    sources: [{ source_name: 'テスト出典', source_url: 'https://checked.example.com/r', fetched_at: '2026-03-01T00:00:00.000Z' }],
  });
});

test('要約に必要な最低口コミ件数は3件以上に設定されている（1〜2件の言い換えを防ぐ）', () => {
  assert.ok(MIN_REVIEWS_FOR_SUMMARY >= 3);
});

test('selectTargets: review_source_urls が空の学校は対象外', () => {
  const schools = [
    { id: 'a', review_source_urls: [], review_summary: null },
    { id: 'b', review_source_urls: [{ source_name: 's', source_url: 'https://x.example.com/' }], review_summary: null },
  ];
  assert.deepStrictEqual(selectTargets(schools).map(s => s.id), ['b']);
});

test('selectTargets: 未要約が最優先、その次に要約が古い順', () => {
  const src = [{ source_name: 's', source_url: 'https://x.example.com/' }];
  const withSummary = at => ({ text: 't', sources: [{ source_name: 's', source_url: 'https://x.example.com/', fetched_at: at }] });
  const now = Date.parse('2026-06-01T00:00:00.000Z');

  const schools = [
    { id: 'recent', review_source_urls: src, review_summary: withSummary('2026-05-20T00:00:00.000Z') },
    { id: 'old', review_source_urls: src, review_summary: withSummary('2026-01-01T00:00:00.000Z') },
    { id: 'never', review_source_urls: src, review_summary: null },
  ];

  // recent は30日以内なので対象外。never（未要約）が先、次に old。
  assert.deepStrictEqual(selectTargets(schools, now).map(s => s.id), ['never', 'old']);
});

test('selectTargets: REVIEW_ONLY_SCHOOL_ID を指定するとその1校だけになる（1校テスト実行用）', () => {
  const src = [{ source_name: 's', source_url: 'https://x.example.com/' }];
  const schools = [
    { id: 'a', review_source_urls: src, review_summary: null },
    { id: 'b', review_source_urls: [], review_summary: null },
  ];
  process.env.REVIEW_ONLY_SCHOOL_ID = 'b';
  try {
    assert.deepStrictEqual(selectTargets(schools).map(s => s.id), ['b']);
  } finally {
    delete process.env.REVIEW_ONLY_SCHOOL_ID;
  }
});
