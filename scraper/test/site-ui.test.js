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

test('AdSense のスクリプトが全ページの <head> に静的に置かれている', () => {
  // サイト所有権の確認（審査）は、このタグがHTMLに直接書かれているかを見る。
  // JSから動的に読み込む形にすると、クローラーが見つけられず確認に失敗する
  // （実際に「お客様のサイトは確認できませんでした」になった）。
  const pages = ['index.html', 'faq.html', 'privacy.html', '404.html']
    .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
    .concat(staticPages().map(f => [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')]));

  for (const [name, html] of pages) {
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(
      head,
      /<script[^>]+pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-\d+/,
      `${name} の <head> に AdSense のタグが無い`
    );
  }
});

test('静的化したページに広告タグが焼き付いていない', () => {
  // 静的化のときに AdSense を動かすと、AdSense 自身が ins や iframe を差し込み、
  // それが保存され続けてしまう（実際に31ページへ焼き付いた）。
  // prerender.js が広告関連ホストの読み込みを止めているので、ここで見張る。
  for (const file of staticPages()) {
    const html = withoutScripts(fs.readFileSync(file, 'utf8'));
    assert.ok(
      !/<ins[^>]+adsbygoogle/.test(html),
      `${path.relative(ROOT, file)} に広告タグが埋め込まれている`
    );
    assert.ok(
      !/<iframe[^>]+(doubleclick|googlesyndication|googleads)/i.test(html),
      `${path.relative(ROOT, file)} に広告配信のiframeが埋め込まれている`
    );
  }
});

test('静的化のときに広告配信スクリプトを読み込まない', () => {
  const prerender = fs.readFileSync(path.join(ROOT, 'scraper', 'prerender.js'), 'utf8');
  assert.match(prerender, /setRequestInterception\(true\)/, 'リクエストを止める設定が無い');
  assert.match(prerender, /googlesyndication/, '広告ホストの指定が無い');
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

test('広告枠を描くかどうかが1か所のスイッチで決まる', () => {
  // 審査前は配信されず枠の高さぶんの空白が出るため、止めたいときはここだけ変える。
  assert.match(indexHtml, /enabled: (true|false),/, '広告の有効/無効スイッチが無い');
  assert.match(indexHtml, /if \(!ADSENSE\.enabled\) return false;/,
    'adsEnabled() がスイッチを見ていない');
});

test('配信されなかった広告枠は畳まれる', () => {
  // 在庫が無いときに「広告」の見出しと空白だけが残らないようにする。
  assert.match(indexHtml, /data-ad-status="unfilled"/, 'unfilled を見るCSSが無い');
});
