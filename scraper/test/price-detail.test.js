'use strict';

/**
 * 料金の詳細ページへのフォールバック巡回の検証。
 *
 * 特に固定したいのは「無駄なリクエストを増やさない」こと:
 *   - price が取れているときは発動しない
 *   - 発動しても1校につきHTTPリクエストは最大1回、再帰的に辿らない
 * および「取れなければ null のまま確定させる（合成しない）」こと。
 */

process.env.SCRAPER_MIN_DELAY_MS = '0';
process.env.SCRAPER_JITTER_MS = '0';

const test = require('node:test');
const assert = require('node:assert');

const priceDetail = require('../lib/price-detail');
const { NOT_DISCLOSED_TEXT } = require('../lib/schema');

/** 元の実装を退避し、テストごとに差し替えて必ず戻す。 */
function withStubs(stubs, fn) {
  const originals = {};
  for (const [key, value] of Object.entries(stubs)) {
    originals[key] = priceDetail[key];
    priceDetail[key] = value;
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(originals)) priceDetail[key] = value;
    }
  })();
}

const HOMEPAGE_HTML = `
<html><body>
  <a href="/">ホーム</a>
  <a href="/company">会社概要</a>
  <a href="/price">料金プラン</a>
  <a href="/contact">お問い合わせ</a>
  <a href="https://twitter.com/example">Twitter</a>
  <a href="/price#plan">料金プラン（アンカー付き）</a>
</body></html>`;

// ---- リンク抽出 ----

test('extractPageLinks: 同一ホストのリンクだけを、料金の手がかり順に返す', () => {
  const links = priceDetail.extractPageLinks(HOMEPAGE_HTML, 'https://example.com/');
  assert.ok(!links.some(l => l.url.includes('twitter.com')), '外部ドメインが含まれている');
  // 「料金プラン」が先頭に来る（手がかりを持つリンクを前に寄せる）。
  assert.match(links[0].text, /料金/);
});

test('extractPageLinks: フラグメント違いの重複を1件にまとめる', () => {
  const links = priceDetail.extractPageLinks(HOMEPAGE_HTML, 'https://example.com/');
  assert.strictEqual(links.filter(l => l.url === 'https://example.com/price').length, 1);
});

test('extractPageLinks: トップページ自身へのリンクは候補にしない', () => {
  const links = priceDetail.extractPageLinks(HOMEPAGE_HTML, 'https://example.com/');
  assert.ok(!links.some(l => l.url === 'https://example.com/'));
});

test('extractPageLinks: 相対URLを絶対URLに解決する', () => {
  const links = priceDetail.extractPageLinks('<a href="course/plan">コース料金</a>', 'https://example.com/lp/');
  assert.strictEqual(links[0].url, 'https://example.com/lp/course/plan');
});

test('extractPageLinks: 壊れた入力でも例外を投げない', () => {
  // baseUrl が不正ならリンクは1件も返さない（どこを基準に解決すべきか決められないため）。
  assert.deepStrictEqual(priceDetail.extractPageLinks(HOMEPAGE_HTML, 'not a url'), []);
  // 解決できない href は捨てる。解決できてしまう変な href（"::" は相対パスとして
  // 解決される）はそのまま候補に残るが、同一ホスト内なので踏んでも1回で終わる。
  assert.doesNotThrow(() => priceDetail.extractPageLinks('<a href="::">x</a>', 'https://example.com/'));
  assert.doesNotThrow(() => priceDetail.extractPageLinks('', 'https://example.com/'));
});

test('extractPageLinks: javascript: や mailto: のリンクは候補にしない', () => {
  const html = '<a href="javascript:void(0)">料金</a><a href="mailto:a@example.com">料金メール</a><a href="/price">料金</a>';
  const links = priceDetail.extractPageLinks(html, 'https://example.com/');
  assert.deepStrictEqual(links.map(l => l.url), ['https://example.com/price']);
});

// ---- 金額の裏取り ----

test('verifyPlans: 本文にある金額のプランだけを残す（カンマの有無は無視）', () => {
  const plans = [
    { label: '集中8週間プラン', amount: 475200 },
    { label: '16週間プラン', amount: 567600 },
  ];
  const pageText = '集中8週間プラン ¥475,200 / 16週間プラン ¥567,600';
  assert.deepStrictEqual(priceDetail.verifyPlans(plans, pageText), plans);
});

test('verifyPlans: 本文に無い金額のプランは落とす（根拠不明の金額を残さない）', () => {
  const plans = [
    { label: '実在プラン', amount: 298000 },
    { label: '架空プラン', amount: 999999 },
  ];
  const kept = priceDetail.verifyPlans(plans, '受講料は298,000円です。');
  assert.deepStrictEqual(kept.map(p => p.label), ['実在プラン']);
});

test('verifyPlans: AIが割り算して作った月額は本文に無いので落ちる', () => {
  // 本文には総額 657,800円 しか無く、月額 54,816 は書かれていない。
  const kept = priceDetail.verifyPlans([{ label: '月額', amount: 54816 }], '一括657,800円（税込）');
  assert.deepStrictEqual(kept, []);
});

test('verifyPlans: label が空・amount が整数でないプランは落とす', () => {
  const kept = priceDetail.verifyPlans(
    [{ label: '', amount: 1000 }, { label: 'A', amount: '1000' }, { label: 'B', amount: -1 }],
    '1000円 -1円'
  );
  assert.deepStrictEqual(kept, []);
});

test('buildPriceFromPlans: 複数プランなら最安値に「〜」を付ける', () => {
  const r = priceDetail.buildPriceFromPlans(
    [{ label: '16週間', amount: 567600 }, { label: '集中8週間', amount: 475200 }],
    'detail_page'
  );
  assert.strictEqual(r.display, '475,200円〜');
  assert.strictEqual(r.min_yen, 475200);
  assert.strictEqual(r.scope, 'detail_page');
  assert.strictEqual(r.plans.length, 2);
});

test('buildPriceFromPlans: プランが1件なら「〜」を付けない', () => {
  const r = priceDetail.buildPriceFromPlans([{ label: '標準コース', amount: 657800 }], 'top_page');
  assert.strictEqual(r.display, '657,800円');
  assert.strictEqual(r.min_yen, 657800);
});

test('buildPriceFromPlans: プランが空なら定型文と null', () => {
  const r = priceDetail.buildPriceFromPlans([], 'top_page');
  assert.deepStrictEqual(r, { display: NOT_DISCLOSED_TEXT, min_yen: null, plans: [], scope: 'top_page' });
});

// ---- 割引価格の除外（回帰） ----

/**
 * sejuku の実例を模した、通常価格と割引後価格が併記されたページ本文。
 * 実際にこの構造で min_yen が割引価格（456,390円）になる誤りが起きた。
 */
const DISCOUNT_PAGE_TEXT = `
転職コースの料金
16週間プラン 通常 567,600円 → 期間限定キャンペーン価格 544,170円
24週間プラン 通常 778,800円 → 期間限定キャンペーン価格 744,810円
集中8週間プラン 通常 475,200円 → 期間限定キャンペーン価格 456,390円
`;

test('割引/通常が併記されていても、通常価格のみが採用される（回帰: min_yen が割引価格にならない）', () => {
  // AIが両方を別エントリとして返してきた場合を想定する（実際にそうなった）。
  const aiPlans = [
    { label: '16週間プラン', amount: 567600 },
    { label: '16週間プラン', amount: 544170 },
    { label: '24週間プラン', amount: 778800 },
    { label: '24週間プラン', amount: 744810 },
    { label: '集中8週間プラン', amount: 475200 },
    { label: '集中8週間プラン', amount: 456390 },
  ];

  const verified = priceDetail.verifyPlans(aiPlans, DISCOUNT_PAGE_TEXT);
  assert.strictEqual(verified.length, 6, '本文に実在する金額はすべて照合を通る');

  const price = priceDetail.buildPriceFromPlans(verified, 'detail_page');
  assert.strictEqual(price.min_yen, 475200, 'min_yen が割引価格になっている');
  assert.strictEqual(price.display, '475,200円〜');
  assert.strictEqual(price.plans.length, 3, '同名プランが重複して残っている');
  assert.deepStrictEqual(
    price.plans.map(p => p.amount).sort((a, b) => a - b),
    [475200, 567600, 778800]
  );
});

test('dropDiscountedDuplicates: 期間・内容が違うプランは別エントリとして残す', () => {
  const plans = [
    { label: '16週間プラン', amount: 567600 },
    { label: '24週間プラン', amount: 778800 },
    { label: '集中8週間プラン', amount: 475200 },
  ];
  const price = priceDetail.buildPriceFromPlans(plans, 'detail_page');
  assert.strictEqual(price.plans.length, 3, 'ラベルが異なるプランまで畳んでいる');
  assert.strictEqual(price.min_yen, 475200);
});

test('dropDiscountedDuplicates: 前後の空白だけが違うラベルは同一プランとして扱う', () => {
  const price = priceDetail.buildPriceFromPlans(
    [{ label: '標準コース', amount: 300000 }, { label: ' 標準コース ', amount: 240000 }],
    'top_page'
  );
  assert.strictEqual(price.plans.length, 1);
  assert.strictEqual(price.min_yen, 300000);
});

test('抽出プロンプトに割引価格の除外指示が含まれている', () => {
  // プロンプト側の指示と機械的なガードの二重で守る方針（official_name の件以降の原則）。
  const source = require('fs').readFileSync(require.resolve('../lib/price-detail'), 'utf8');
  assert.match(source, /割引後価格/);
  assert.match(source, /キャンペーン価格/);
  assert.match(source, /期間やカリキュラムが明確に異なるプランは/);
});

test('buildPriceFromPlans: 桁区切りは実行環境のロケールに依存しない', () => {
  // 既定ロケールに任せると環境によっては "657.800" になりうるため 'en-US' を明示している。
  assert.strictEqual(priceDetail.buildPriceFromPlans([{ label: 'A', amount: 1234567 }]).display, '1,234,567円');
});

// ---- フォールバック全体 ----

test('enrichPriceFromDetailPage: 詳細ページから料金を取得し、フラグとURLを返す', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      choosePriceDetailLink: async () => ({ url: 'https://example.com/price', text: '料金プラン' }),
      fetchDetailPage: async () => { fetchCount += 1; return '受講料は一括298,000円（税込）です。'; },
      extractPriceFromPage: async (name, url, pageText) =>
        priceDetail.buildPriceFromPlans(
          priceDetail.verifyPlans([{ label: '標準コース', amount: 298000 }], pageText),
          'detail_page'
        ),
    },
    async () => {
      const r = await priceDetail.enrichPriceFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(r.price.display, '298,000円');
      assert.strictEqual(r.price.min_yen, 298000);
      assert.strictEqual(r.price.scope, 'detail_page');
      assert.deepStrictEqual(r.flags, ['detail_page_crawled']);
      assert.strictEqual(r.detailPageUrl, 'https://example.com/price');
      assert.strictEqual(fetchCount, 1, 'HTTPリクエストが1回ではない');
    }
  );
});

test('enrichPriceFromDetailPage: 1校につきHTTPリクエストは最大1回（再帰的に辿らない）', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      choosePriceDetailLink: async () => ({ url: 'https://example.com/price', text: '料金プラン' }),
      // 辿った先がまた一覧ページで、料金が書かれていなかったケース。
      fetchDetailPage: async () => { fetchCount += 1; return '<a href="/price/detail">詳しい料金はこちら</a>'; },
      extractPriceFromPage: async () => priceDetail.buildPriceFromPlans([], 'detail_page'),
    },
    async () => {
      await priceDetail.enrichPriceFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(fetchCount, 1, 'さらに下層ページを辿っている');
    }
  );
});

test('enrichPriceFromDetailPage: 詳細ページでも取れなければ null のまま確定し、記録は残る', async () => {
  await withStubs(
    {
      choosePriceDetailLink: async () => ({ url: 'https://example.com/price', text: '料金プラン' }),
      fetchDetailPage: async () => '料金は個別にご案内しています。',
      extractPriceFromPage: async () => ({ display: NOT_DISCLOSED_TEXT, min_yen: null }),
    },
    async () => {
      const r = await priceDetail.enrichPriceFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(r.price.min_yen, null);
      assert.deepStrictEqual(r.flags, ['detail_page_crawled']);
      assert.strictEqual(r.detailPageUrl, 'https://example.com/price');
    }
  );
});

test('enrichPriceFromDetailPage: リンクを選べなければHTTPリクエストを送らない', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      choosePriceDetailLink: async () => null,
      fetchDetailPage: async () => { fetchCount += 1; return ''; },
    },
    async () => {
      const r = await priceDetail.enrichPriceFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.deepStrictEqual(r, { price: null, detailPageUrl: null, flags: [] });
      assert.strictEqual(fetchCount, 0);
    }
  );
});

test('enrichPriceFromDetailPage: 詳細ページの取得に失敗しても再試行せず、記録だけ残す', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      choosePriceDetailLink: async () => ({ url: 'https://example.com/price', text: '料金' }),
      fetchDetailPage: async () => { fetchCount += 1; throw new Error('HTTP 404'); },
    },
    async () => {
      const r = await priceDetail.enrichPriceFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(r.price, null);
      assert.deepStrictEqual(r.flags, ['detail_page_crawled']);
      assert.strictEqual(fetchCount, 1, '失敗後に再試行している');
    }
  );
});

test('enrichPriceFromDetailPage: HTMLが無い/リンクが無い場合は何もしない', async () => {
  const empty = { price: null, detailPageUrl: null, flags: [] };
  assert.deepStrictEqual(await priceDetail.enrichPriceFromDetailPage('サンプル', null, 'https://example.com/', {}), empty);
  assert.deepStrictEqual(
    await priceDetail.enrichPriceFromDetailPage('サンプル', '<html><body>リンクなし</body></html>', 'https://example.com/', {}),
    empty
  );
});

test('choosePriceDetailLink: AIが候補一覧に無いURLを返したら踏まない', async () => {
  const anthropic = {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', input: { url: 'https://example.com/invented', reason: '推測' } }],
      }),
    },
  };
  const links = [{ url: 'https://example.com/price', text: '料金' }];
  assert.strictEqual(await priceDetail.choosePriceDetailLink(links, 'サンプル', anthropic), null);
});

test('choosePriceDetailLink: 確信が持てず null を返した場合はそのまま null', async () => {
  const anthropic = {
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', input: { url: null, reason: '該当なし' } }] }),
    },
  };
  const links = [{ url: 'https://example.com/about', text: '会社概要' }];
  assert.strictEqual(await priceDetail.choosePriceDetailLink(links, 'サンプル', anthropic), null);
});

test('choosePriceDetailLink: リンク候補が空ならAIを呼ばない', async () => {
  let called = 0;
  const anthropic = { messages: { create: async () => { called += 1; return { content: [] }; } } };
  assert.strictEqual(await priceDetail.choosePriceDetailLink([], 'サンプル', anthropic), null);
  assert.strictEqual(called, 0);
});
