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

test('verifyPriceClaim: 本文に金額があればそのまま採用する（カンマの有無は無視）', () => {
  const r = priceDetail.verifyPriceClaim('一括657,800円（税込）', 657800, '受講料は 657,800円（税込）です。');
  assert.deepStrictEqual(r, { display: '一括657,800円（税込）', min_yen: 657800 });
});

test('verifyPriceClaim: 本文に無い金額は display ごと不採用にする（根拠不明の金額を残さない）', () => {
  const r = priceDetail.verifyPriceClaim('一括298,000円', 298000, '料金についてはお問い合わせください。');
  assert.deepStrictEqual(r, { display: NOT_DISCLOSED_TEXT, min_yen: null });
});

test('verifyPriceClaim: min_yen が無ければ display だけ残す（金額を主張していない）', () => {
  const r = priceDetail.verifyPriceClaim(NOT_DISCLOSED_TEXT, null, '本文');
  assert.deepStrictEqual(r, { display: NOT_DISCLOSED_TEXT, min_yen: null });
});

test('verifyPriceClaim: AIが割り算して作った月額は本文に無いので落ちる', () => {
  // 本文には総額 657,800円 しか無く、月額 54,816 は書かれていない。
  const r = priceDetail.verifyPriceClaim('月額54,816円', 54816, '一括657,800円（税込）');
  assert.strictEqual(r.min_yen, null);
});

// ---- フォールバック全体 ----

test('enrichPriceFromDetailPage: 詳細ページから料金を取得し、フラグとURLを返す', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      choosePriceDetailLink: async () => ({ url: 'https://example.com/price', text: '料金プラン' }),
      fetchDetailPage: async () => { fetchCount += 1; return '受講料は一括298,000円（税込）です。'; },
      extractPriceFromPage: async (name, url, pageText) =>
        priceDetail.verifyPriceClaim('一括298,000円（税込）', 298000, pageText),
    },
    async () => {
      const r = await priceDetail.enrichPriceFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.deepStrictEqual(r.price, { display: '一括298,000円（税込）', min_yen: 298000 });
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
      extractPriceFromPage: async () => ({ display: NOT_DISCLOSED_TEXT, min_yen: null }),
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
