'use strict';

/**
 * 二段階検証パイプラインのユニットテスト。
 *
 * 実際のWeb検索・HTTPリクエストは行わず、searchGenreCandidates / fetchWithVerifyUA を
 * module.exports 経由で差し替える（lib/school-discovery.js が内部呼び出しを必ず
 * module.exports 経由で行っているのは、このテストのため）。
 *
 * ここで守りたい性質は1つ:「AIが実在すると言っただけの候補は、絶対に採用されない」。
 */

// lib/http.js は読み込み時に待機時間を確定するため、require より先に無効化しておく
// （そうしないとテスト1本ごとに実際に3〜5秒待つことになる）。
process.env.SCRAPER_MIN_DELAY_MS = '0';
process.env.SCRAPER_JITTER_MS = '0';

const test = require('node:test');
const assert = require('node:assert');

const discovery = require('../lib/school-discovery');
const { candidateNameCores } = require('../lib/name-core');

const pageWith = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

/** 元の実装を退避し、テストごとに差し替えて必ず戻す。 */
function withStubs(stubs, fn) {
  const originals = {};
  for (const [key, value] of Object.entries(stubs)) {
    originals[key] = discovery[key];
    discovery[key] = value;
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        discovery[key] = value;
      }
    }
  })();
}

test('extractJsonArray: 説明文やコードフェンスに囲まれていてもJSON配列を取り出せる', () => {
  const text = '検索しました。\n```json\n[{"name":"サンプル","website":"https://example.com"}]\n```\n以上です。';
  assert.deepStrictEqual(discovery.extractJsonArray(text), [{ name: 'サンプル', website: 'https://example.com' }]);
});

test('extractJsonArray: name/website が揃っていない要素は捨てる', () => {
  const text = '[{"name":"A","website":"https://a.example.com"},{"name":"B"},{"website":"https://c.example.com"}]';
  assert.deepStrictEqual(discovery.extractJsonArray(text).map(c => c.name), ['A']);
});

test('extractJsonArray: JSONが壊れていても例外を投げず空配列を返す', () => {
  assert.deepStrictEqual(discovery.extractJsonArray('[{"name": ...'), []);
  assert.deepStrictEqual(discovery.extractJsonArray('該当なし'), []);
  assert.deepStrictEqual(discovery.extractJsonArray(null), []);
});

test('candidateFetchUrls: https を先に、http をフォールバックとして並べる', () => {
  assert.deepStrictEqual(discovery.candidateFetchUrls('https://example.com/course'), [
    'https://example.com/course',
    'http://example.com/course',
  ]);
  assert.deepStrictEqual(discovery.candidateFetchUrls('bad url ::'), []);
});

test('candidateRootUrls: www. の有無の両方をトップページ候補にする', () => {
  assert.deepStrictEqual(discovery.candidateRootUrls('https://www.example.com/gone'), [
    'https://www.example.com/',
    'http://www.example.com/',
    'https://example.com/',
    'http://example.com/',
  ]);
});

test('verifyCandidate: ページ本文にスクール名があれば ok:true', async () => {
  await withStubs(
    { fetchWithVerifyUA: async () => pageWith('サンプルスクール', 'サンプルスクールは架空の講座です。'.repeat(20)) },
    async () => {
      const result = await discovery.verifyCandidate({ name: 'サンプルスクール', website: 'https://example.com/' });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.verifiedUrl, 'https://example.com/');
      assert.strictEqual(result.thinContent, false);
    }
  );
});

test('verifyCandidate: ページ本文にスクール名が無ければ name_mismatch（AIの自己申告を採用しない）', async () => {
  await withStubs(
    { fetchWithVerifyUA: async () => pageWith('別のサイト', 'ここには関係のない内容しかありません。'.repeat(20)) },
    async () => {
      const result = await discovery.verifyCandidate({ name: '実在しないスクール', website: 'https://example.com/' });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'name_mismatch');
    }
  );
});

test('verifyCandidate: 法人格を除いた主要部分で照合する', async () => {
  await withStubs(
    { fetchWithVerifyUA: async () => pageWith('モックアカデミー', 'モックアカデミーの紹介ページです。'.repeat(20)) },
    async () => {
      const result = await discovery.verifyCandidate({ name: '株式会社モックアカデミー', website: 'https://example.com/' });
      assert.strictEqual(result.ok, true);
    }
  );
});

test('verifyCandidate: パスが404でもトップページで照合できればフォールバックして採用する', async () => {
  const seen = [];
  await withStubs(
    {
      fetchWithVerifyUA: async url => {
        seen.push(url);
        if (url.includes('/old-lp')) throw new Error('HTTP 404');
        return pageWith('サンプルスクール', 'サンプルスクールのトップページです。'.repeat(20));
      },
    },
    async () => {
      const result = await discovery.verifyCandidate({ name: 'サンプルスクール', website: 'https://example.com/old-lp' });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.verifiedUrl, 'https://example.com/');
      assert.ok(seen.some(u => u.includes('/old-lp')), 'パス付きURLを先に試していない');
    }
  );
});

test('verifyCandidate: パスが生きているなら、名前が無くてもトップへは降りない', async () => {
  const seen = [];
  await withStubs(
    {
      fetchWithVerifyUA: async url => {
        seen.push(url);
        return pageWith('無関係', 'まったく関係のない内容です。'.repeat(20));
      },
    },
    async () => {
      const result = await discovery.verifyCandidate({ name: 'サンプルスクール', website: 'https://example.com/course' });
      assert.strictEqual(result.reason, 'name_mismatch');
      assert.deepStrictEqual(seen, ['https://example.com/course']);
    }
  );
});

test('verifyCandidate: 全URLでfetchに失敗すれば fetch_failed', async () => {
  await withStubs(
    { fetchWithVerifyUA: async () => { throw new Error('ENOTFOUND'); } },
    async () => {
      const result = await discovery.verifyCandidate({ name: 'サンプルスクール', website: 'https://nope.example.com/x' });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'fetch_failed');
      assert.match(result.error, /ENOTFOUND/);
    }
  );
});

test('verifyCandidate: 本文が薄いページは ok:true だが thinContent:true が付く', async () => {
  await withStubs(
    { fetchWithVerifyUA: async () => pageWith('サンプルスクール', 'サンプルスクール') },
    async () => {
      const result = await discovery.verifyCandidate({ name: 'サンプルスクール', website: 'https://example.com/' });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.thinContent, true);
    }
  );
});

test('discoverCandidates: 照合を通った候補だけが verified に入り、落ちたものは skipped に記録される', async () => {
  await withStubs(
    {
      searchGenreCandidates: async () => [
        { name: '実在スクール', website: 'https://real.example.com/' },
        { name: '架空スクール', website: 'https://fake.example.com/' },
      ],
      fetchWithVerifyUA: async url =>
        url.includes('real')
          ? pageWith('実在スクール', '実在スクールのページです。'.repeat(20))
          : pageWith('別サイト', '無関係な内容です。'.repeat(20)),
    },
    async () => {
      const { verified, skipped, perGenre } = await discovery.discoverCandidates(['programming'], [], 10);
      assert.deepStrictEqual(verified.map(v => v.candidate.name), ['実在スクール']);
      assert.deepStrictEqual(skipped.map(s => [s.candidate.name, s.reason]), [['架空スクール', 'name_mismatch']]);
      assert.deepStrictEqual(perGenre, [
        { genre: 'programming', label: 'プログラミング・エンジニア', found: 2, listed: 1, skipped: 1 },
      ]);
    }
  );
});

test('discoverCandidates: 既存掲載名と重複する候補は照合すらしない', async () => {
  let fetchCount = 0;
  await withStubs(
    {
      searchGenreCandidates: async () => [{ name: '株式会社既出スクール', website: 'https://dup.example.com/' }],
      fetchWithVerifyUA: async () => {
        fetchCount += 1;
        return pageWith('既出スクール', '既出スクールです。'.repeat(20));
      },
    },
    async () => {
      const { verified, perGenre } = await discovery.discoverCandidates(['programming'], ['既出スクール'], 10);
      assert.deepStrictEqual(verified, []);
      assert.strictEqual(perGenre[0].found, 0);
      assert.strictEqual(fetchCount, 0, '重複候補にHTTPリクエストを送っている');
    }
  );
});

test('discoverCandidates: 上限に達したら以降のジャンルの検索呼び出し自体を行わない', async () => {
  const searchedGenres = [];
  await withStubs(
    {
      searchGenreCandidates: async genre => {
        searchedGenres.push(genre);
        return [{ name: `${genre}スクール`, website: `https://${genre}.example.com/` }];
      },
      fetchWithVerifyUA: async url => {
        const genre = new URL(url).hostname.split('.')[0];
        return pageWith(`${genre}スクール`, `${genre}スクールのページです。`.repeat(20));
      },
    },
    async () => {
      const { verified } = await discovery.discoverCandidates(['programming', 'webdesign', 'uiux'], [], 2);
      assert.strictEqual(verified.length, 2);
      assert.deepStrictEqual(searchedGenres, ['programming', 'webdesign']);
    }
  );
});

test('discoverCandidates: 検索呼び出しが例外を投げても、そのジャンルを飛ばして続行する', async () => {
  await withStubs(
    {
      searchGenreCandidates: async genre => {
        if (genre === 'programming') throw new Error('rate limited');
        return [{ name: 'デザインスクール', website: 'https://d.example.com/' }];
      },
      fetchWithVerifyUA: async () => pageWith('デザインスクール', 'デザインスクールのページです。'.repeat(20)),
    },
    async () => {
      const { verified, perGenre } = await discovery.discoverCandidates(['programming', 'webdesign'], [], 10);
      assert.deepStrictEqual(verified.map(v => v.candidate.name), ['デザインスクール']);
      assert.deepStrictEqual(perGenre[0], { genre: 'programming', label: 'プログラミング・エンジニア', found: 0, listed: 0, skipped: 0 });
    }
  );
});

test('normalizeStructuredFields: 未知のenum値は落とし、発見時のジャンルで補完する', () => {
  const result = discovery.normalizeStructuredFields(
    { skill_genre: ['nonsense'], purpose: ['nonsense'], target_level: 'guru', format: 'hybrid', area: ['東京'] },
    'video_editing'
  );
  assert.deepStrictEqual(result.skill_genre, ['video_editing']);
  assert.deepStrictEqual(result.purpose, ['current_job_skillup']);
  assert.strictEqual(result.target_level, 'beginner');
  assert.strictEqual(result.format, 'online');
  assert.deepStrictEqual(result.area, []);
});

test('normalizeStructuredFields: format=online なのに area があれば area を空にする', () => {
  const result = discovery.normalizeStructuredFields(
    { skill_genre: ['programming'], purpose: ['career_change'], target_level: 'beginner', format: 'online', area: ['東京都'] },
    'programming'
  );
  assert.deepStrictEqual(result.area, []);
});

test('normalizeStructuredFields: 通学なのに area が空なら online に丸める（矛盾レコードを作らない）', () => {
  const result = discovery.normalizeStructuredFields(
    { skill_genre: ['programming'], purpose: ['career_change'], target_level: 'beginner', format: 'both', area: [] },
    'programming'
  );
  assert.strictEqual(result.format, 'online');
  assert.deepStrictEqual(result.area, []);
});

test('normalizeStructuredFields: 給付金・転職支援は true 以外をすべて false にする', () => {
  const result = discovery.normalizeStructuredFields(
    {
      skill_genre: ['programming'], purpose: ['career_change'], target_level: 'beginner', format: 'online', area: [],
      subsidy_eligible: 'true', career_support: 1,
    },
    'programming'
  );
  assert.strictEqual(result.subsidy_eligible, false);
  assert.strictEqual(result.career_support, false);
});

test('normalizeStructuredFields: price は plans から組み立てられ、本文に無い金額は落ちる', () => {
  const base = { skill_genre: ['programming'], purpose: ['career_change'], target_level: 'beginner', format: 'online', area: [] };
  const pageText = '標準コースは198,000円、短期コースは98,000円です。';

  const ok = discovery.normalizeStructuredFields(
    { ...base, price_plans: [{ label: '標準コース', amount: 198000, duration: null, kind: 'total' }, { label: '短期コース', amount: 98000, duration: null, kind: 'total' }] },
    'programming',
    pageText
  );
  assert.strictEqual(ok.price.min_yen, 98000);
  assert.strictEqual(ok.price.display, '98,000円〜');
  assert.strictEqual(ok.price.scope, 'top_page');

  // 本文に無い金額（AIが作った値）はプランごと落ち、結果として price は空になる。
  const bogus = discovery.normalizeStructuredFields(
    { ...base, price_plans: [{ label: '架空プラン', amount: 555555, duration: null, kind: 'total' }] },
    'programming',
    pageText
  );
  assert.strictEqual(bogus.price.min_yen, null);
  assert.deepStrictEqual(bogus.plans, [], '本文に無い金額のプランが残っている');
});

test('照合キーは2文字未満の断片を作らない（どんなページにも偶然一致するのを防ぐ）', () => {
  assert.deepStrictEqual(candidateNameCores('株式会社A'), []);
  assert.ok(candidateNameCores('株式会社AB').every(core => core.length >= 2));
});
