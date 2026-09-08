'use strict';

/**
 * index.html と静的化したページの、崩れると気づきにくい約束ごとを固定する。
 *
 * 見た目そのものはテストしない（変えたいときに邪魔になるため）。
 * ここで守るのは「入れてはいけないものが入っていないか」だけ。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** インラインの <script> を取り除く。中のJSソースを「描画されたHTML」と誤判定しないため。 */
function withoutScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

function staticPages() {
  const dirs = [];
  for (const kind of ['school', 'category']) {
    const base = path.join(ROOT, kind);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const file = path.join(base, name, 'index.html');
      if (fs.existsSync(file)) dirs.push(file);
    }
  }
  return dirs;
}

test('AdSense のスクリプトを静的に読み込んでいない', () => {
  // 広告ユニットIDが未設定のうちからGoogleへ通信させないため、
  // スクリプトは設定済みのときだけJSから読み込む。
  assert.ok(
    !/<script[^>]+pagead2\.googlesyndication\.com/.test(indexHtml),
    'index.html が AdSense のスクリプトを直接読み込んでいる'
  );
});

test('静的化したページに広告タグが焼き付いていない', () => {
  // 静的化のときに広告を描画してしまうと、古い広告タグがHTMLに残り続ける。
  for (const file of staticPages()) {
    const html = withoutScripts(fs.readFileSync(file, 'utf8'));
    assert.ok(
      !/<ins[^>]+adsbygoogle/.test(html),
      `${path.relative(ROOT, file)} に広告タグが埋め込まれている`
    );
  }
});

test('静的化したページの外部画像はロゴ（ファビコン）だけ', () => {
  // 掲載スクールの画像はロゴ以外を使わない方針。実際に描画された状態で確かめる。
  for (const file of staticPages()) {
    const html = withoutScripts(fs.readFileSync(file, 'utf8'));
    const external = html.match(/<img[^>]+src="https?:[^"]+"/gi) || [];
    for (const tag of external) {
      assert.match(tag, /google\.com\/s2\/favicons/, `${path.relative(ROOT, file)}: ${tag}`);
    }
  }
});

test('広告枠は空のときに消える（枠線や余白だけが残らない）', () => {
  assert.match(indexHtml, /\.ad-slot:empty\{[^}]*display:none/);
});

test('診断ボタンに読み上げ用のラベルが付いている', () => {
  // アイコンだけのボタンなので、ラベルがないと何のボタンか分からない。
  assert.match(indexHtml, /class="wizard-fab"[^>]*aria-label="[^"]+"/);
});

test('おすすめ枠はテスト済みの選定ロジック（pickRecommended）を使っている', () => {
  // ここに独自の並べ替えを書くと、faq.html の説明と実際の挙動がずれる。
  assert.match(indexHtml, /Z\.pickRecommended\(/);
});

test('おすすめ枠の2セット目は読み上げから隠している', () => {
  // 継ぎ目なくループさせるため同じ内容を2回描いている。
  assert.match(indexHtml, /aria-hidden="true" tabindex="-1"/);
});

test('自動スクロールは「動きを減らす」設定を尊重する', () => {
  assert.match(indexHtml, /prefers-reduced-motion: reduce/);
});
