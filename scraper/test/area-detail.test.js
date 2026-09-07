'use strict';

/**
 * 開催エリアの詳細ページへのフォールバック巡回の検証。
 *
 * price 側と同じく「無駄なリクエストを増やさない」ことと「合成しない」ことを固定する。
 * area 固有の論点として、「通学拠点が無い（オンライン専用）」と「確認できなかった」を
 * 混同しないことも確認する。前者は online 確定、後者は area_unconfirmed を残す。
 */

process.env.SCRAPER_MIN_DELAY_MS = '0';
process.env.SCRAPER_JITTER_MS = '0';

const test = require('node:test');
const assert = require('node:assert');

const areaDetail = require('../lib/area-detail');

function withStubs(stubs, fn) {
  const originals = {};
  for (const [key, value] of Object.entries(stubs)) {
    originals[key] = areaDetail[key];
    areaDetail[key] = value;
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(originals)) areaDetail[key] = value;
    }
  })();
}

const HOMEPAGE_HTML = `
<html><body>
  <a href="/">ホーム</a>
  <a href="/course">コース紹介</a>
  <a href="/campus">校舎一覧</a>
  <a href="/contact">お問い合わせ</a>
</body></html>`;

// ---- 発動条件 ----

test('needsAreaEnrichment: area が既に取れているレコードは発動しない', () => {
  const school = { area: ['東京都'], review_flags: ['format_unconfirmed'] };
  assert.strictEqual(areaDetail.needsAreaEnrichment(school, '教室あり'), false);
});

test('needsAreaEnrichment: format_unconfirmed が立っていれば発動する', () => {
  const school = { area: [], review_flags: ['format_unconfirmed'] };
  assert.strictEqual(areaDetail.needsAreaEnrichment(school, 'オンラインスクールです'), true);
});

test('needsAreaEnrichment: 通学キーワードがあるのに area が空なら発動する', () => {
  const school = { area: [], review_flags: [] };
  assert.strictEqual(areaDetail.needsAreaEnrichment(school, '渋谷校の教室で対面指導も行っています'), true);
});

test('needsAreaEnrichment: online 確定済み（フラグ無し・通学キーワード無し）なら発動しない', () => {
  const school = { area: [], review_flags: [] };
  assert.strictEqual(areaDetail.needsAreaEnrichment(school, '完全オンラインで受講できます'), false);
});

// ---- 都道府県の裏取り ----

test('verifyPrefectures: 本文に正式名称があるものだけを残す', () => {
  const kept = areaDetail.verifyPrefectures(['東京都', '大阪府'], '校舎は東京都渋谷区にあります。');
  assert.deepStrictEqual(kept, ['東京都']);
});

test('verifyPrefectures: 「東京校」のような略称表記でも拾う', () => {
  const kept = areaDetail.verifyPrefectures(['東京都', '大阪府'], '東京校 / 大阪校 / 名古屋校');
  assert.deepStrictEqual(kept, ['東京都', '大阪府']);
});

test('verifyPrefectures: 「東京都」の中の「京都」を京都府と誤検出しない', () => {
  const kept = areaDetail.verifyPrefectures(['京都府'], '本社は東京都千代田区です。');
  assert.deepStrictEqual(kept, [], '東京都から京都府を誤検出している');
  // 本当に京都の言及があれば拾う。
  assert.deepStrictEqual(areaDetail.verifyPrefectures(['京都府'], '京都校を開校しました。'), ['京都府']);
});

test('verifyPrefectures: 本文に無い都道府県は落とす（合成しない）', () => {
  const kept = areaDetail.verifyPrefectures(['東京都', '沖縄県'], '東京校のみ');
  assert.deepStrictEqual(kept, ['東京都']);
});

test('verifyPrefectures: 未知の値・重複は取り除く', () => {
  assert.deepStrictEqual(areaDetail.verifyPrefectures(['東京', '東京都', '東京都'], '東京校'), ['東京都']);
});

// ---- 本社所在地の誤認防止（回帰） ----

/**
 * sejuku の会社概要ページの実際の内容。AIがここの「所在地 東京都港区…」を通学拠点として
 * 返してきて、オンライン専用スクールが format=offline / area=["東京都"] になった。
 * 「校舎」「教室」「通学」はこのページに一度も出てこない。
 */
const COMPANY_PAGE_TEXT =
  '会社概要 会社情報 会社名株式会社SAMURAI ' +
  '所在地〒105-0001 東京都港区虎ノ門一丁目3番1号 東京虎ノ門グローバルスクエア ' +
  '代表者代表取締役社長 設立2015年3月19日 事業概要プログラミング学習サービス ' +
  'アクセス 住所 最寄り駅 JR「虎ノ門駅」より徒歩1分';

test('本社所在地しか無いページの都道府県は通学拠点として採用しない（回帰）', () => {
  // 本文に「東京都」は実在するので verifyPrefectures は通ってしまう。
  assert.deepStrictEqual(areaDetail.verifyPrefectures(['東京都'], COMPANY_PAGE_TEXT), ['東京都']);
  // 通学拠点の根拠が無いので、ここで落ちる。
  assert.deepStrictEqual(areaDetail.filterToCampusPrefectures(['東京都'], COMPANY_PAGE_TEXT), []);
});

test('hasCampusEvidence: 校舎・教室・通学の語があれば根拠として認める', () => {
  assert.strictEqual(areaDetail.hasCampusEvidence('東京都', '渋谷校舎で受講できます'), true);
  assert.strictEqual(areaDetail.hasCampusEvidence('東京都', '通学プランをご用意しています'), true);
  assert.strictEqual(areaDetail.hasCampusEvidence('大阪府', '梅田教室のご案内'), true);
});

test('hasCampusEvidence: 都道府県名を冠した拠点表記も根拠として認める', () => {
  // 「校舎」等の語が無くても「東京校」のような表記があれば拠点と認める。
  assert.strictEqual(areaDetail.hasCampusEvidence('東京都', '東京校 / 大阪校 / 名古屋校'), true);
  assert.strictEqual(areaDetail.hasCampusEvidence('大阪府', '東京校 / 大阪校'), true);
  assert.strictEqual(areaDetail.hasCampusEvidence('沖縄県', '東京校 / 大阪校'), false);
});

test('hasCampusEvidence: 本社住所だけのページは根拠として認めない', () => {
  assert.strictEqual(areaDetail.hasCampusEvidence('東京都', COMPANY_PAGE_TEXT), false);
});

test('extractAreaFromPage 相当の流れで、本社住所は area に入らない', async () => {
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/company', text: '会社概要' }),
      fetchDetailPage: async () => COMPANY_PAGE_TEXT,
      // AIが本社所在地を返してきた場合を再現する（実際にそうなった）。
      extractAreaFromPage: async (name, url, pageText) => ({
        prefectures: areaDetail.filterToCampusPrefectures(
          areaDetail.verifyPrefectures(['東京都'], pageText),
          pageText
        ),
        online_only: false,
        has_online_courses: true,
      }),
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.deepStrictEqual(r.area, [], '本社所在地を通学拠点として採用している');
      assert.strictEqual(r.format, 'online');
      assert.deepStrictEqual(r.flags, ['area_unconfirmed']);
    }
  );
});

test('リンク選定プロンプトで「会社概要」を選ばないよう指示している', () => {
  const source = require('fs').readFileSync(require.resolve('../lib/area-detail'), 'utf8');
  assert.match(source, /「会社概要」「企業情報」は選ばないこと/);
});

// ---- フォールバック全体 ----

const stubExtract = result => async () => result;

test('enrichAreaFromDetailPage: 都道府県が見つかれば area に入り、format が通学系になる', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/campus', text: '校舎一覧' }),
      fetchDetailPage: async () => { fetchCount += 1; return '東京校 渋谷 / 大阪校 梅田'; },
      extractAreaFromPage: stubExtract({ prefectures: ['東京都', '大阪府'], online_only: false, has_online_courses: true }),
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.deepStrictEqual(r.area, ['東京都', '大阪府']);
      assert.strictEqual(r.format, 'both');
      assert.strictEqual(r.areaSource, 'detail_page');
      assert.deepStrictEqual(r.flags, []);
      assert.strictEqual(r.resolved, true);
      assert.strictEqual(fetchCount, 1, 'HTTPリクエストが1回ではない');
    }
  );
});

test('enrichAreaFromDetailPage: オンライン受講が無ければ format は offline', async () => {
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/campus', text: '校舎一覧' }),
      fetchDetailPage: async () => '東京校のみ',
      extractAreaFromPage: stubExtract({ prefectures: ['東京都'], online_only: false, has_online_courses: false }),
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(r.format, 'offline');
    }
  );
});

test('enrichAreaFromDetailPage: 「通学拠点なし」と明記されていれば online 確定（フラグ無し）', async () => {
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/campus', text: 'アクセス' }),
      fetchDetailPage: async () => '当スクールは完全オンラインのため、校舎はありません。',
      extractAreaFromPage: stubExtract({ prefectures: [], online_only: true, has_online_courses: true }),
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(r.format, 'online');
      assert.deepStrictEqual(r.area, []);
      assert.deepStrictEqual(r.flags, [], 'online 確定なのに area_unconfirmed が付いている');
      assert.strictEqual(r.resolved, true);
    }
  );
});

test('enrichAreaFromDetailPage: 都道府県も「オンライン専用」の明記も無ければ area_unconfirmed（合成しない）', async () => {
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/campus', text: 'アクセス' }),
      fetchDetailPage: async () => 'お問い合わせはメールにて受け付けています。',
      extractAreaFromPage: stubExtract({ prefectures: [], online_only: false, has_online_courses: true }),
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.deepStrictEqual(r.area, [], '都道府県を合成している');
      assert.deepStrictEqual(r.flags, ['area_unconfirmed']);
      assert.strictEqual(r.resolved, false);
      assert.strictEqual(r.areaSource, 'detail_page');
    }
  );
});

test('enrichAreaFromDetailPage: 1校につきHTTPリクエストは最大1回（再帰的に辿らない）', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/campus', text: '校舎一覧' }),
      // 辿った先がまた一覧で、所在地が書かれていなかったケース。
      fetchDetailPage: async () => { fetchCount += 1; return '<a href="/campus/tokyo">東京校はこちら</a>'; },
      extractAreaFromPage: stubExtract({ prefectures: [], online_only: false, has_online_courses: true }),
    },
    async () => {
      await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(fetchCount, 1, 'さらに下層ページを辿っている');
    }
  );
});

test('enrichAreaFromDetailPage: リンクを選べなければHTTPリクエストを送らない', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      chooseAreaDetailLink: async () => null,
      fetchDetailPage: async () => { fetchCount += 1; return ''; },
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(fetchCount, 0);
      assert.deepStrictEqual(r.flags, ['area_unconfirmed']);
      assert.strictEqual(r.detailPageUrl, null);
    }
  );
});

test('enrichAreaFromDetailPage: 取得に失敗しても再試行せず、都道府県を合成しない', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      chooseAreaDetailLink: async () => ({ url: 'https://example.com/campus', text: '校舎一覧' }),
      fetchDetailPage: async () => { fetchCount += 1; throw new Error('HTTP 404'); },
    },
    async () => {
      const r = await areaDetail.enrichAreaFromDetailPage('サンプル', HOMEPAGE_HTML, 'https://example.com/', {});
      assert.strictEqual(fetchCount, 1, '失敗後に再試行している');
      assert.deepStrictEqual(r.area, []);
      assert.deepStrictEqual(r.flags, ['area_unconfirmed']);
    }
  );
});

test('enrichAreaFromDetailPage: HTMLが無ければ何もしない', async () => {
  const r = await areaDetail.enrichAreaFromDetailPage('サンプル', null, 'https://example.com/', {});
  assert.strictEqual(r.resolved, false);
  assert.deepStrictEqual(r.area, []);
});

test('chooseAreaDetailLink: AIが候補一覧に無いURLを返したら踏まない', async () => {
  const anthropic = {
    messages: { create: async () => ({ content: [{ type: 'tool_use', input: { url: 'https://example.com/invented', reason: '推測' } }] }) },
  };
  assert.strictEqual(
    await areaDetail.chooseAreaDetailLink([{ url: 'https://example.com/campus', text: '校舎' }], 'サンプル', anthropic),
    null
  );
});
