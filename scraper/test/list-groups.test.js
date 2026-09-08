'use strict';

/**
 * 一覧の並べ方のガード。
 *
 * トップのジャンル別の件数（○件）と、塊に出る件数がずれると
 * 「数え方がおかしいサイト」に見える。同じ条件で数えていることを固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { groupByGenre, splitByPriceKnown, DEFAULT_PREVIEW } = require('../lib/list-groups');
const { GENRE } = require('../lib/schema');
const { readSchools } = require('../lib/schools-store');

function school(over) {
  return Object.assign({
    id: 'x', school_name: 'X', skill_genre: ['programming'],
    price: { min_yen: 1000, kind: 'total' },
  }, over || {});
}

test('複数ジャンルの講座は、そのすべての塊に出る', () => {
  const s = school({ id: 'multi', skill_genre: ['programming', 'webdesign'] });
  const groups = groupByGenre([s]);
  assert.deepStrictEqual(groups.map(g => g.genre), ['programming', 'webdesign']);
  for (const g of groups) assert.strictEqual(g.items.length, 1);
});

test('該当が0件のジャンルは塊にしない', () => {
  const groups = groupByGenre([school()]);
  assert.deepStrictEqual(groups.map(g => g.genre), ['programming']);
});

test('塊に出すのは既定で4件まで、残りは hidden になる', () => {
  const list = Array.from({ length: 7 }, (_, i) => school({ id: 'a' + i }));
  const group = groupByGenre(list)[0];
  assert.strictEqual(DEFAULT_PREVIEW, 4);
  assert.strictEqual(group.preview.length, 4);
  assert.strictEqual(group.hidden, 3);
  assert.strictEqual(group.items.length, 7);
});

test('4件以下の塊には「すべて見る」を出さない（hidden が 0）', () => {
  const list = Array.from({ length: 4 }, (_, i) => school({ id: 'a' + i }));
  assert.strictEqual(groupByGenre(list)[0].hidden, 0);
});

test('渡された順番を塊の中でも保つ（料金の安い順を崩さない）', () => {
  const list = [school({ id: 'a' }), school({ id: 'b' }), school({ id: 'c' })];
  assert.deepStrictEqual(groupByGenre(list)[0].preview.map(s => s.id), ['a', 'b', 'c']);
});

test('塊の順番はジャンルの定義順（トップのジャンル一覧と同じ並び）', () => {
  const list = GENRE.map((g, i) => school({ id: 'g' + i, skill_genre: [g] }));
  assert.deepStrictEqual(groupByGenre(list).map(g => g.genre), GENRE);
});

test('料金が確認できたものと要問い合わせを分ける', () => {
  const list = [
    school({ id: 'known', price: { min_yen: 100000, kind: 'total' } }),
    school({ id: 'unknown', price: { min_yen: null, kind: null } }),
    school({ id: 'nofield', price: undefined }),
  ];
  const { priced, unpriced } = splitByPriceKnown(list);
  assert.deepStrictEqual(priced.map(s => s.id), ['known']);
  assert.deepStrictEqual(unpriced.map(s => s.id), ['unknown', 'nofield']);
});

test('0円の講座は「料金が確認できた」側に入る（未確認と混同しない）', () => {
  const { priced } = splitByPriceKnown([school({ id: 'free', price: { min_yen: 0, kind: 'total' } })]);
  assert.deepStrictEqual(priced.map(s => s.id), ['free']);
});

test('分けても件数は増減しない', () => {
  const list = readSchools().filter(s => s.status === 'active');
  const { priced, unpriced } = splitByPriceKnown(list);
  assert.strictEqual(priced.length + unpriced.length, list.length);
});

test('塊の件数は、トップのジャンル一覧に出している件数と一致する', () => {
  const list = readSchools().filter(s => s.status === 'active');
  const groups = groupByGenre(list);
  for (const genre of GENRE) {
    // index.html の buildGenreNav が数えているのと同じ条件。
    const navCount = list.filter(s => s.skill_genre.indexOf(genre) !== -1).length;
    const group = groups.find(g => g.genre === genre);
    assert.strictEqual(group ? group.items.length : 0, navCount, `${genre} の件数が食い違っている`);
  }
});

test('index.html は塊分けを lib の関数で行っている（同じ処理を書き写していない）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(html.includes('Z.groupByGenre(list)'), 'groupByGenre を使っていない');
  assert.ok(html.includes('Z.splitByPriceKnown(list)'), 'splitByPriceKnown を使っていない');
  // 条件を指定していないトップだけ塊にする。絞り込んだら全部見せる。
  assert.ok(html.includes('!flatView && !hasAnyCondition()'), '塊にする条件が変わっている');
});

test('ブラウザ用bundleに塊分けが入っている', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'wizard.js'), 'utf8');
  for (const key of ['groupByGenre', 'splitByPriceKnown']) {
    assert.ok(bundle.includes(key), `assets/wizard.js に ${key} が無い（作り直していない）`);
  }
});

test('同じ講座を複数の塊に重ねて出さない', () => {
  // 複数ジャンルの講座が1画面に2度3度出ると、掲載が重複しているように見える
  // （実際にトップの32枚のうち8枚が同じ講座の再掲になっていた）。
  const multi = school({ id: 'multi', skill_genre: ['programming', 'webdesign'] });
  const only = school({ id: 'only', skill_genre: ['webdesign'] });
  const groups = groupByGenre([multi, only]);

  const shown = groups.flatMap(g => g.preview.map(s => s.id));
  assert.deepStrictEqual(shown, [...new Set(shown)], '同じ講座が2回出ている');
  assert.deepStrictEqual(groups.find(g => g.genre === 'programming').preview.map(s => s.id), ['multi']);
  assert.deepStrictEqual(groups.find(g => g.genre === 'webdesign').preview.map(s => s.id), ['only']);
});

test('件数は「そのジャンルを含むか」で数える（重ねて出さなくても変わらない）', () => {
  // トップのジャンル別件数・ジャンル別ページと数え方を揃える。
  const multi = school({ id: 'multi', skill_genre: ['programming', 'webdesign'] });
  const groups = groupByGenre([multi, school({ id: 'only', skill_genre: ['webdesign'] })]);
  assert.strictEqual(groups.find(g => g.genre === 'programming').items.length, 1);
  assert.strictEqual(groups.find(g => g.genre === 'webdesign').items.length, 2);
});

test('全部が上の塊で出ていても、見出しだけの空の塊にはしない', () => {
  const a = school({ id: 'a', skill_genre: ['programming', 'webdesign'] });
  const groups = groupByGenre([a]);
  const web = groups.find(g => g.genre === 'webdesign');
  assert.strictEqual(web.preview.length, 1, '空の塊になっている');
  assert.strictEqual(web.preview[0].id, 'a');
});

test('unique: false で従来どおり重複を許せる', () => {
  const a = school({ id: 'a', skill_genre: ['programming', 'webdesign'] });
  const groups = groupByGenre([a], { unique: false });
  assert.strictEqual(groups.find(g => g.genre === 'programming').preview.length, 1);
  assert.strictEqual(groups.find(g => g.genre === 'webdesign').preview.length, 1);
});

test('掲載中の実データで、トップに同じ講座が2度出ない', () => {
  const list = readSchools().filter(s => s.status === 'active');
  const shown = groupByGenre(list).flatMap(g => g.preview.map(s => s.id));
  const dup = shown.filter((id, i) => shown.indexOf(id) !== i);
  assert.deepStrictEqual(dup, [], `重複して出ている講座: ${dup.join('、')}`);
});
