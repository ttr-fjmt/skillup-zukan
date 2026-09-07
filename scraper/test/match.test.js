'use strict';

/**
 * 診断ウィザードのスコアリングのユニットテスト。
 *
 * モックデータ（各ジャンル5件）に対して、想定回答パターンを複数通り流し、
 * 「配点どおりに点が付くか」「フィルターで落とすべきものが落ちるか」
 * 「同点のタイブレークが指示どおりか」を確認する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { matchSchools, scoreSchool, filterCandidates, isAdjacentLevel, formatMatches } = require('../lib/match');

const MOCK_PATH = path.join(__dirname, '..', '..', 'data', 'mock', 'schools.mock.json');
const schools = JSON.parse(fs.readFileSync(MOCK_PATH, 'utf8'));
const byId = id => schools.find(s => s.id === id);

const baseAnswers = {
  purpose: 'career_change',
  genres: ['programming'],
  level: 'beginner',
  format: 'online',
  subsidy_preference: 'want_subsidy',
};

test('isAdjacentLevel は隣接レベルのみ true', () => {
  assert.strictEqual(isAdjacentLevel('beginner', 'novice'), true);
  assert.strictEqual(isAdjacentLevel('novice', 'beginner'), true);
  assert.strictEqual(isAdjacentLevel('beginner', 'experienced'), false);
  assert.strictEqual(isAdjacentLevel('beginner', 'beginner'), false);
  assert.strictEqual(isAdjacentLevel('beginner', 'unknown'), false);
});

test('formatMatches: both は online/offline のどちらの希望も満たす', () => {
  assert.strictEqual(formatMatches('both', 'online'), true);
  assert.strictEqual(formatMatches('both', 'offline'), true);
  assert.strictEqual(formatMatches('online', 'offline'), false);
  assert.strictEqual(formatMatches('offline', 'online'), false);
  assert.strictEqual(formatMatches('offline', 'either'), true);
});

test('候補フィルター: status が active 以外のものは候補にならない', () => {
  const candidates = filterCandidates(baseAnswers, schools);
  const ids = candidates.map(s => s.id);
  assert.ok(!ids.includes('mock-programming-5'), 'skipped が候補に入っている');
  assert.deepStrictEqual(ids, ['mock-programming-1', 'mock-programming-2', 'mock-programming-3', 'mock-programming-4']);
});

test('候補フィルター: 選択ジャンルと重ならないスクールは候補にならない', () => {
  const candidates = filterCandidates({ ...baseAnswers, genres: ['language'] }, schools);
  assert.ok(candidates.every(s => s.skill_genre.includes('language')));
  // mock-language-5 は status=skipped なので、language の active は4件。
  assert.strictEqual(candidates.length, 4);
});

test('候補フィルター: 通学希望のときは、その都道府県に教室があるスクールだけが残る', () => {
  const answers = { ...baseAnswers, format: 'offline', prefecture: '大阪府' };
  const candidates = filterCandidates(answers, schools);
  assert.ok(candidates.every(s => s.area.includes('大阪府')));
  // 大阪府を含むのは AREA_SETS[1] を使う variant4（ハイブリッド）のみ。
  assert.deepStrictEqual(candidates.map(s => s.id), ['mock-programming-4']);
});

test('候補フィルター: 受講スタイル「どちらでもよい」では都道府県で絞り込まない', () => {
  const answers = { ...baseAnswers, format: 'either' };
  assert.strictEqual(filterCandidates(answers, schools).length, 4);
});

test('スコア配点: 目的3点・レベル完全一致2点・形式2点・給付金2点・ジャンル1点で合計10点', () => {
  const { score, components } = scoreSchool(baseAnswers, byId('mock-programming-1'));
  assert.strictEqual(score, 10);
  assert.deepStrictEqual(
    components.map(c => [c.key, c.points]),
    [['purpose', 3], ['level', 2], ['format', 2], ['subsidy', 2], ['genre', 1]]
  );
});

test('スコア配点: レベルが隣接なら1点、遠ければ0点', () => {
  // mock-programming-2 は novice（beginner と隣接）、給付金なし・目的不一致。
  const adjacent = scoreSchool(baseAnswers, byId('mock-programming-2'));
  assert.strictEqual(adjacent.score, 4); // level 1 + format 2 + genre 1
  assert.strictEqual(adjacent.components.find(c => c.key === 'level').points, 1);

  // mock-programming-4 は experienced（beginner から2段階離れている）。
  const distant = scoreSchool(baseAnswers, byId('mock-programming-4'));
  assert.strictEqual(distant.components.some(c => c.key === 'level'), false);
  assert.strictEqual(distant.score, 6); // purpose 3 + format 2 + genre 1
});

test('スコア配点: 受講スタイルが希望と違えば形式の加点は付かない', () => {
  // mock-programming-3 は offline。オンライン希望なので形式の加点なし。
  const { score, components } = scoreSchool(baseAnswers, byId('mock-programming-3'));
  assert.strictEqual(components.some(c => c.key === 'format'), false);
  assert.strictEqual(score, 5); // level 2 + subsidy 2 + genre 1
});

test('スコア配点: 「どちらでもよい」を選ぶと形式の加点は誰にも付かない', () => {
  const answers = { ...baseAnswers, format: 'either' };
  for (const id of ['mock-programming-1', 'mock-programming-3', 'mock-programming-4']) {
    assert.strictEqual(scoreSchool(answers, byId(id)).components.some(c => c.key === 'format'), false, id);
  }
});

test('スコア配点: 給付金にこだわらない場合は給付金の加点が付かない', () => {
  const answers = { ...baseAnswers, subsidy_preference: 'no_preference' };
  const { score, components } = scoreSchool(answers, byId('mock-programming-1'));
  assert.strictEqual(components.some(c => c.key === 'subsidy'), false);
  assert.strictEqual(score, 8);
});

test('スコア配点: ジャンル一致数は最大3点まで', () => {
  // mock-webdesign-1 は skill_genre が webdesign/uiux の2件。
  const answers = { ...baseAnswers, genres: ['webdesign', 'uiux'] };
  const { components } = scoreSchool(answers, byId('mock-webdesign-1'));
  assert.strictEqual(components.find(c => c.key === 'genre').points, 2);

  const many = scoreSchool(
    { ...baseAnswers, genres: ['a', 'b', 'c'] },
    { ...byId('mock-webdesign-1'), skill_genre: ['a', 'b', 'c', 'd'], purpose: [], target_level: 'advanced', format: 'online' }
  );
  assert.strictEqual(many.components.find(c => c.key === 'genre').points, 3);
});

test('診断結果はスコアの降順に並び、上位5件までを返す', () => {
  const results = matchSchools(baseAnswers, schools);
  assert.deepStrictEqual(
    results.map(s => [s.id, s.match_score]),
    [
      ['mock-programming-1', 10],
      ['mock-programming-4', 6],
      ['mock-programming-3', 5],
      ['mock-programming-2', 4],
    ]
  );
});

test('診断結果は最大5件（limitで調整できる）', () => {
  const answers = { ...baseAnswers, genres: ['programming', 'webdesign', 'uiux'] };
  assert.strictEqual(matchSchools(answers, schools).length, 5);
  assert.strictEqual(matchSchools(answers, schools, 3).length, 3);
});

test('タイブレーク: 同点なら口コミの出典件数が多い方が上', () => {
  const base = {
    ...byId('mock-programming-1'),
    purpose: ['career_change'],
    skill_genre: ['programming'],
    target_level: 'beginner',
    format: 'online',
    subsidy_eligible: true,
    cta_type: 'direct',
  };
  const few = { ...base, id: 'tie-few', review_summary: { text: 'x', sources: [{ source_name: 'a', source_url: 'https://a.example.com/', fetched_at: '2026-01-01T00:00:00.000Z' }] } };
  const many = { ...base, id: 'tie-many', review_summary: { text: 'x', sources: [1, 2, 3].map(i => ({ source_name: `s${i}`, source_url: `https://s${i}.example.com/`, fetched_at: '2026-01-01T00:00:00.000Z' })) } };

  const results = matchSchools(baseAnswers, [few, many]);
  assert.strictEqual(results[0].match_score, results[1].match_score);
  assert.deepStrictEqual(results.map(s => s.id), ['tie-many', 'tie-few']);
});

test('タイブレーク: 口コミ件数も同じなら cta_type=affiliate が優先される', () => {
  const base = {
    ...byId('mock-programming-1'),
    purpose: ['career_change'],
    skill_genre: ['programming'],
    target_level: 'beginner',
    format: 'online',
    subsidy_eligible: true,
    review_summary: null,
  };
  const direct = { ...base, id: 'tie-direct', cta_type: 'direct' };
  const affiliate = { ...base, id: 'tie-affiliate', cta_type: 'affiliate' };

  assert.deepStrictEqual(matchSchools(baseAnswers, [direct, affiliate]).map(s => s.id), ['tie-affiliate', 'tie-direct']);
  // 入力順を逆にしても結果が変わらないこと（並びが入力順に依存していない）。
  assert.deepStrictEqual(matchSchools(baseAnswers, [affiliate, direct]).map(s => s.id), ['tie-affiliate', 'tie-direct']);
});

test('マッチ理由は加点の大きい上位2項目から作られる', () => {
  const [top] = matchSchools(baseAnswers, schools);
  assert.strictEqual(top.match_reasons.length, 2);
  assert.match(top.match_reasons[0], /転職・就職/);
  assert.match(top.match_reasons[1], /未経験・入門/);
});

test('通学希望の場合、マッチ理由に希望した都道府県が出る', () => {
  const answers = { ...baseAnswers, format: 'offline', prefecture: '大阪府' };
  const [top] = matchSchools(answers, schools);
  assert.ok(top.match_reasons.some(r => r.includes('大阪府')), top.match_reasons.join(' / '));
});

test('診断は入力の School オブジェクトを変更しない', () => {
  const snapshot = JSON.stringify(schools);
  matchSchools(baseAnswers, schools);
  assert.strictEqual(JSON.stringify(schools), snapshot);
});

test('該当が無い場合は空配列を返す（例外を投げない）', () => {
  const answers = { ...baseAnswers, format: 'offline', prefecture: '沖縄県' };
  assert.deepStrictEqual(matchSchools(answers, schools), []);
});

test('全ジャンル・全目的・全レベルの組み合わせを流しても例外にならず、結果は5件以内', () => {
  const { GENRE, PURPOSE, LEVEL } = require('../lib/schema');
  let checked = 0;
  for (const genre of GENRE) {
    for (const purpose of PURPOSE) {
      for (const level of LEVEL) {
        for (const format of ['online', 'offline', 'either']) {
          const answers = {
            purpose,
            genres: [genre],
            level,
            format,
            prefecture: format === 'offline' ? '東京都' : undefined,
            subsidy_preference: 'no_preference',
          };
          const results = matchSchools(answers, schools);
          assert.ok(results.length <= 5);
          assert.ok(results.every(r => Number.isInteger(r.match_score) && r.match_score > 0));
          checked += 1;
        }
      }
    }
  }
  assert.strictEqual(checked, 8 * 6 * 4 * 3);
});
