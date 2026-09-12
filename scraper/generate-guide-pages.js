'use strict';

/**
 * 学び直しガイド（/guide/ 以下）の記事ページを書き出す。
 *
 * 【なぜ作ったか】
 * 姉妹サイトの転職エージェント図鑑が AdSense の審査で「有用性の低いコンテンツ」と判定された。
 * このサイトにも独自に書いた解説が1本も無かったので、社会人が講座を選ぶときに実際に迷う点を
 * 解説する記事を置き、Google に評価してもらう中心にする。
 *
 * 【書き方の約束】
 * 制度・支給率・上限額・日付など事実に当たる記述は、厚生労働省の公式ページで確認できたものだけにし、
 * 記事末尾に出典を必ず載せる（DATA_QUALITY_POLICY.md の「確認できないことは書かない」を記事にも適用する）。
 * 公式ページの本文で確認できなかった条件（雇用保険の加入期間などの受給要件の細目）は書かず、
 * ハローワークで確認するよう案内する。掲載講座の件数や料金の相場も書かない。
 *
 * 見出しの約束（test/page-seo.test.js と同じ）：h1 はページの主題ひとつだけ、ヘッダーのサイト名は見出しにしない。
 *
 * 実行: cd scraper && node generate-guide-pages.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GUIDE_DIR = path.join(ROOT, 'guide');
const BASE_URL = 'https://skillup-zukan.net';
const SITE_NAME = 'スキルアップ図鑑';
const GUIDE_NAME = '学び直しガイド';
const PUBLISHED = '2026-09-12';
const GA_ID = 'G-7EE8WZT75D';
const ADSENSE = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5761092657360295" crossorigin="anonymous"></script>';

const SOURCES = {
  kyouiku: {
    label: '厚生労働省「教育訓練給付金」',
    url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/jinzaikaihatsu/kyouiku.html',
  },
  r0610: {
    label: '厚生労働省「令和6年10月から教育訓練給付金を拡充します」',
    url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000160564_00042.html',
  },
  kensaku: {
    label: '厚生労働省「教育訓練講座検索システム」',
    url: 'https://www.kyufu.mhlw.go.jp/kensaku/',
  },
  hellowork: {
    label: 'ハローワークインターネットサービス「教育訓練給付金」',
    url: 'https://www.hellowork.mhlw.go.jp/insurance/insurance_education.html',
  },
};

const GUIDES = [
  {
    slug: 'kyufukin',
    title: '教育訓練給付金とは？3つの種類と、対象講座の探し方',
    description: '社会人の学び直しを支援する「教育訓練給付金」について、専門実践・特定一般・一般の3つの種類ごとの支給率と上限額、対象講座の探し方、申請先を、厚生労働省の公開情報をもとに解説します。',
    sources: ['kyouiku', 'r0610', 'kensaku', 'hellowork'],
    body: `
<p class="lead">講座の受講料は、社会人の学び直しで悩みやすいポイントのひとつです。条件を満たせば、国の<strong>教育訓練給付金</strong>で受講費用の一部が支給されることがあります。この記事では、制度の全体像を整理します。</p>

<h2>教育訓練給付制度の目的</h2>
<p>厚生労働省は、この制度の目的を次のように説明しています。</p>
<blockquote>働く方々の主体的な能力開発やキャリア形成を支援し、雇用の安定と就職の促進を図る</blockquote>
<p>対象になるのは、<strong>厚生労働大臣が指定した講座</strong>です。どんな講座でも対象になるわけではない点に注意してください。</p>

<h2>3つの種類と、支給される額</h2>
<p>教育訓練給付金には、講座の種類に応じて3つの区分があります。</p>

<h3>専門実践教育訓練</h3>
<ul>
  <li>受講費用の<strong>50%</strong>（年間上限<strong>40万円</strong>）を、受講中<strong>6か月</strong>ごとに支給</li>
  <li>資格を取得するなどして修了後に雇用された場合は、<strong>70%</strong>（年間上限<strong>56万円</strong>）</li>
  <li>さらに、修了後の賃金が受講開始前より<strong>5%</strong>以上上がった場合は、<strong>80%</strong>（年間上限<strong>64万円</strong>）（※）</li>
</ul>

<h3>特定一般教育訓練</h3>
<ul>
  <li>受講費用の<strong>40%</strong>（上限<strong>20万円</strong>）</li>
  <li>資格を取得するなどして修了後に雇用された場合は、<strong>50%</strong>（上限<strong>25万円</strong>）（※）</li>
</ul>

<h3>一般教育訓練</h3>
<ul>
  <li>受講費用の<strong>20%</strong>（上限<strong>10万円</strong>）</li>
</ul>

<p>（※）は、令和6年10月に拡充された内容です。拡充の対象は、<strong>令和6年10月1日</strong>以降に特定一般教育訓練・専門実践教育訓練の受講を開始する方です。</p>

<h2>対象講座の探し方</h2>
<p>給付金の対象になる講座は、厚生労働省の<strong>「教育訓練講座検索システム」</strong>で探せます。講座名や分野、地域などから検索できるので、気になる講座が対象かどうかを確かめてから申し込むと安心です。</p>
<p>スクールの公式サイトに「給付金対象」と書かれていても、<strong>対象になるのは特定のコースだけ</strong>ということがあります。受講したいコースそのものが対象かどうかを確認してください。</p>

<h2>申請先と、受給できるかの確認</h2>
<p>申請は、<strong>お住まいを管轄するハローワーク</strong>で受け付けています。受給には条件があり、講座の種類によって事前の手続きが必要になる場合もあります。<strong>ご自身が対象になるかどうかは、受講を申し込む前に、ハローワークで確認</strong>しておきましょう。</p>

<h2>このサイトの「給付金対象」表示について</h2>
<p>スキルアップ図鑑の「給付金対象」の表示は、<strong>そのスクールの公式サイトに給付金に関する記載があった</strong>ことを示すものです。受給できることを保証するものではありません。</p>
<p>「給付金対象のみ」で絞り込んだあとは、上で紹介した検索システムとハローワークで、受講したいコースとご自身の条件を必ず確認してください。講座選び全般のポイントは、<a href="/guide/choose-course/">社会人の講座選びで確認したい4つのポイント</a>で解説しています。</p>
`,
  },
  {
    slug: 'choose-course',
    title: '社会人の講座選びで確認したい4つのポイント',
    description: 'プログラミング・Webデザイン・語学・資格など、社会人が講座やスクールを選ぶときに確認したい4つのポイント（目的、料金の見方、受講スタイル、給付金）を解説します。',
    sources: ['kyouiku', 'kensaku'],
    body: `
<p class="lead">学び直しの講座は、同じ分野でも料金も学び方も大きく違います。「なんとなく評判が良さそう」で決めてしまうと、あとで続けにくくなることもあります。申し込む前に確認しておきたい4つのポイントを紹介します。</p>

<h2>1. 何のために学ぶのかを決める</h2>
<p>最初に、<strong>学んだ後にどうなりたいか</strong>をはっきりさせておくと、講座を比べる基準ができます。</p>
<ul>
  <li><strong>転職・キャリアチェンジ</strong>：転職支援やポートフォリオ制作のサポートがあるか</li>
  <li><strong>副業・フリーランス</strong>：案件の取り方や、実務に近い課題があるか</li>
  <li><strong>今の仕事に活かす</strong>：必要なスキルに絞って、短期間で学べるか</li>
  <li><strong>資格の取得</strong>：試験対策のカリキュラムや、模試・質問対応があるか</li>
</ul>
<p>スキルアップ図鑑の「目的」の絞り込みや、「あなたに合う講座を診断」も、この考え方で候補を絞り込めるようにしています。</p>

<h2>2. 料金は「何に対する金額か」を確認する</h2>
<p>料金を比べるときは、表示されている金額が<strong>何に対するものか</strong>を確かめることが大切です。</p>
<ul>
  <li><strong>一括払いか、月額か</strong>：月額の講座は、受講する期間によって総額が変わります</li>
  <li><strong>入学金など、受講料以外の費用</strong>があるか</li>
  <li><strong>コースによって料金が違う</strong>か：表示が一番安いコースの金額になっていることがあります</li>
</ul>
<p>スキルアップ図鑑では、一括払いと月額を混ぜて並べ替えないようにし、公式サイトで金額を確認できなかった講座は「要問い合わせ」と表示しています。申し込む前に、公式サイトで最新の料金を確認してください。</p>

<h2>3. 続けられる受講スタイルか</h2>
<p>どれだけ良い講座でも、続けられなければ身につきません。<strong>自分の生活に合う学び方</strong>かを確認しましょう。</p>
<ul>
  <li>オンラインか、通学か、併用できるか</li>
  <li>決まった時間に受ける授業か、好きな時間に進める教材か</li>
  <li>わからないところを質問できる仕組みがあるか</li>
</ul>
<p>オンラインと通学の違いは、<a href="/guide/online-or-offline/">オンライン講座と通学、どちらを選ぶ？</a>で詳しく解説しています。</p>

<h2>4. 給付金の対象になるか</h2>
<p>厚生労働大臣が指定した講座なら、条件を満たすと<strong>教育訓練給付金</strong>で受講費用の一部が支給されることがあります。同じスクールでも対象になるコースは限られることがあるので、受講したいコースが対象かどうかを、厚生労働省の「教育訓練講座検索システム」で確認しましょう。</p>
<p>制度の詳しい内容は、<a href="/guide/kyufukin/">教育訓練給付金とは？</a>で解説しています。</p>

<h2>申し込む前に：無料の説明会や体験を活用する</h2>
<p>多くのスクールでは、無料の説明会やカウンセリング、体験授業などを用意しています。<strong>カリキュラムの内容、質問のしやすさ、実際の雰囲気</strong>を確かめてから決めると、ミスマッチを減らせます。</p>
`,
  },
  {
    slug: 'online-or-offline',
    title: 'オンライン講座と通学、どちらを選ぶ？',
    description: '社会人の学び直しで、オンライン講座と通学のスクールのどちらを選ぶべきか。それぞれの向き不向きと、併用という選択肢、選ぶときに確認したいことを解説します。',
    sources: ['kensaku'],
    body: `
<p class="lead">仕事をしながら学ぶ社会人にとって、<strong>どこで・いつ学ぶか</strong>は続けられるかどうかを大きく左右します。オンラインと通学、それぞれの向き不向きを整理します。</p>

<h2>オンライン講座</h2>
<p>自宅など好きな場所で、動画教材やオンライン授業で学ぶスタイルです。</p>
<ul>
  <li><strong>向いている人</strong>：通う時間を取りにくい人、近くに通えるスクールがない人、自分のペースで進めたい人</li>
  <li><strong>気をつけたい点</strong>：ひとりで進めると中だるみしやすいので、質問できる仕組みや、進み具合を見てくれるサポートがあるかを確認しましょう</li>
</ul>

<h2>通学</h2>
<p>教室に通って、講師や他の受講生と一緒に学ぶスタイルです。</p>
<ul>
  <li><strong>向いている人</strong>：決まった時間に学ぶほうが続けやすい人、その場で質問したい人、一緒に学ぶ仲間がほしい人</li>
  <li><strong>気をつけたい点</strong>：通う時間と交通費がかかります。仕事の繁忙期でも通い続けられる時間帯か、振替の仕組みがあるかを確認しましょう</li>
</ul>

<h2>併用という選択肢</h2>
<p>普段はオンラインで学び、必要なときだけ教室に通える<strong>併用型</strong>の講座もあります。オンラインの手軽さと、対面で相談できる安心感の両方がほしい人に向いています。</p>

<h2>選ぶときに確認したいこと</h2>
<ul>
  <li><strong>質問のしやすさ</strong>：チャットで質問できるか、回答までどのくらいかかるか</li>
  <li><strong>学習時間の目安</strong>：1週間にどのくらいの時間が必要か、自分の生活で確保できるか</li>
  <li><strong>通学する場合の場所</strong>：無理なく通える場所に教室があるか</li>
  <li><strong>途中で合わなかった場合</strong>：受講スタイルの変更や、途中解約のルール</li>
</ul>

<h2>このサイトでの探し方</h2>
<p>スキルアップ図鑑では、講座を<strong>受講スタイル（オンライン／通学／併用）</strong>や<strong>通学エリア</strong>で絞り込めます。通学エリアは、公式サイトで教室の所在地を確認できたものだけを表示しています。</p>
<p>給付金の対象になる講座を探したい場合は、厚生労働省の「教育訓練講座検索システム」も、あわせて確認してください。制度については<a href="/guide/kyufukin/">教育訓練給付金とは？</a>、講座選び全般は<a href="/guide/choose-course/">社会人の講座選びで確認したい4つのポイント</a>で解説しています。</p>
`,
  },
];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** faq.html から、アクセス解析（運営者の除外スイッチ＋gtag）のまとまりをそのまま借りる。 */
function readAnalyticsBlock() {
  const faq = fs.readFileSync(path.join(ROOT, 'faq.html'), 'utf8');
  const start = faq.indexOf('<!-- 運営者自身のアクセスを計測しないためのスイッチ。');
  const configAt = faq.indexOf(`gtag('config', '${GA_ID}');`);
  const end = configAt < 0 ? -1 : faq.indexOf('</script>', configAt);
  if (start < 0 || configAt < 0 || end < 0) {
    throw new Error('faq.html からアクセス解析のタグを取り出せませんでした');
  }
  return faq.slice(start, end + '</script>'.length);
}

const STYLE = `<style>
:root{--brand:#E67E22;--brand-dark:#B35C10;--brand-light:#FDF3E7;--brand-border:#F3D9B8;
  --ink:#2B2118;--ink-sub:#6B5D50;--ink-faint:#9A8B7D;--bg:#FFFCF8;--card:#fff;--line:#EDE3D8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.8;
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif}
a{color:var(--brand-dark)}
header{background:var(--card);border-bottom:1px solid var(--line)}
.header-inner{max-width:760px;margin:0 auto;padding:12px 16px}
.site-name{margin:0;font-size:19px;font-weight:800}
.site-name a{text-decoration:none;color:inherit}
.site-name .mark{color:var(--brand)}
main{max-width:760px;margin:0 auto;padding:28px 16px 56px}
.crumbs{font-size:12.5px;color:var(--ink-faint);margin:0 0 8px}
.crumbs a{color:var(--ink-faint);text-decoration:none}
.crumbs a:hover{color:var(--brand-dark);text-decoration:underline}
main h1{font-size:clamp(22px,3.4vw,27px);line-height:1.45;margin:0 0 8px}
.meta{font-size:12.5px;color:var(--ink-faint);margin:0 0 28px}
main h2{font-size:18px;line-height:1.5;margin:36px 0 12px;padding-left:11px;border-left:4px solid var(--brand)}
main h3{font-size:15.5px;margin:22px 0 8px;color:var(--brand-dark)}
p,li{font-size:15px;line-height:1.95;color:var(--ink-sub)}
p{margin:0 0 14px}
p.lead{color:var(--ink);font-size:15.5px}
strong{color:var(--ink)}
ul,ol{margin:0 0 16px;padding-left:1.4em}
li{margin:0 0 6px}
blockquote{margin:0 0 16px;padding:14px 18px;background:var(--card);border:1px solid var(--line);
  border-left:4px solid var(--brand);border-radius:8px;font-size:14.5px;line-height:1.9;color:var(--ink)}
.sources{margin-top:44px;padding:18px 20px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.sources h2{margin:0 0 10px;font-size:15px;border-left:none;padding-left:0}
.sources li{font-size:13px;line-height:1.8}
.sources .note{font-size:12.5px;color:var(--ink-faint);margin:10px 0 0}
.guide-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.guide-list a{display:block;padding:18px 20px;background:var(--card);border:1px solid var(--line);
  border-radius:12px;text-decoration:none;transition:border-color .12s,box-shadow .12s}
.guide-list a:hover{border-color:var(--brand);box-shadow:0 4px 16px rgba(43,33,24,.06)}
.guide-list .t{display:block;font-size:16px;font-weight:700;color:var(--ink);line-height:1.6;margin-bottom:4px}
.guide-list .d{display:block;font-size:13.5px;line-height:1.8;color:var(--ink-sub)}
.related{margin-top:32px}
.related h2{font-size:15px}
footer{border-top:1px solid var(--line);background:var(--card);padding:24px 0;font-size:13px;color:var(--ink-sub)}
.footer-inner{max-width:760px;margin:0 auto;padding:0 16px}
footer nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px}
</style>`;

const HEADER = `<header><div class="header-inner">
  <p class="site-name"><a href="/">スキルアップ<span class="mark">図鑑</span></a></p>
</div></header>`;

const FOOTER = `<footer><div class="footer-inner">
  <nav>
    <a href="/">トップ</a>
    <a href="/guide/">${GUIDE_NAME}</a>
    <a href="/faq.html">よくある質問</a>
    <a href="/privacy.html">プライバシーポリシー</a>
    <a href="mailto:fujimoto.mainly@gmail.com">お問い合わせ</a>
  </nav>
  <p>&copy; 2026 ${SITE_NAME}</p>
</div></footer>`;

function head({ title, description, url, jsonLd, analytics, type }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE_URL}/ogp-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${BASE_URL}/ogp-image.png">
${STYLE}
${ADSENSE}
${analytics}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function cardList(guides) {
  return guides.map(g =>
    `    <li><a href="/guide/${g.slug}/"><span class="t">${escapeHtml(g.title)}</span><span class="d">${escapeHtml(g.description)}</span></a></li>`
  ).join('\n');
}

function buildArticle(guide, analytics) {
  const url = `${BASE_URL}/guide/${guide.slug}/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${BASE_URL}/` },
          { '@type': 'ListItem', position: 2, name: GUIDE_NAME, item: `${BASE_URL}/guide/` },
          { '@type': 'ListItem', position: 3, name: guide.title, item: url },
        ],
      },
      {
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        inLanguage: 'ja',
        datePublished: PUBLISHED,
        dateModified: PUBLISHED,
        mainEntityOfPage: url,
        author: { '@type': 'Organization', name: SITE_NAME, url: `${BASE_URL}/` },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: `${BASE_URL}/` },
      },
    ],
  };
  const sources = guide.sources.map(key => {
    const s = SOURCES[key];
    if (!s) throw new Error(`記事「${guide.slug}」の出典 ${key} が未定義です`);
    return `    <li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a></li>`;
  }).join('\n');

  return `${head({ title: `${guide.title}｜${SITE_NAME}`, description: guide.description, url, jsonLd, analytics, type: 'article' })}
<body>
${HEADER}

<main>
  <p class="crumbs"><a href="/">ホーム</a> ／ <a href="/guide/">${GUIDE_NAME}</a></p>
  <h1>${escapeHtml(guide.title)}</h1>
  <p class="meta">公開日：${formatDate(PUBLISHED)}　／　${SITE_NAME}編集部</p>
${guide.body.trim()}

  <div class="sources">
    <h2>出典・参考にした公式情報</h2>
    <ul>
${sources}
    </ul>
    <p class="note">制度の内容は改正されることがあります。最新の情報や、ご自身が対象になるかどうかは、上記の公式ページやハローワークでご確認ください。</p>
  </div>

  <div class="related">
    <h2>あわせて読みたい</h2>
    <ul class="guide-list">
${cardList(GUIDES.filter(g => g.slug !== guide.slug))}
    </ul>
  </div>
</main>

${FOOTER}
</body>
</html>
`;
}

function buildIndex(analytics) {
  const url = `${BASE_URL}/guide/`;
  const description = '教育訓練給付金のしくみ、社会人の講座選びのポイント、オンラインと通学の選び方など、学び直しの講座を選ぶ前に知っておきたいことを、厚生労働省の公式情報をもとに解説します。';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${BASE_URL}/` },
          { '@type': 'ListItem', position: 2, name: GUIDE_NAME, item: url },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: GUIDE_NAME,
        url,
        inLanguage: 'ja',
        hasPart: GUIDES.map(g => ({ '@type': 'Article', headline: g.title, url: `${BASE_URL}/guide/${g.slug}/` })),
      },
    ],
  };
  return `${head({ title: `${GUIDE_NAME}｜${SITE_NAME}`, description, url, jsonLd, analytics, type: 'website' })}
<body>
${HEADER}

<main>
  <p class="crumbs"><a href="/">ホーム</a></p>
  <h1>${GUIDE_NAME}</h1>
  <p class="meta">学び直しの講座を選ぶ前に知っておきたいこと</p>
  <p class="lead">教育訓練給付金のしくみや、講座選びで確認したいポイントを解説しています。制度に関する記述は、厚生労働省の公式情報をもとにしています。</p>
  <ul class="guide-list">
${cardList(GUIDES)}
  </ul>
</main>

${FOOTER}
</body>
</html>
`;
}

function main() {
  const analytics = readAnalyticsBlock();
  fs.mkdirSync(GUIDE_DIR, { recursive: true });
  const keep = new Set(GUIDES.map(g => g.slug));
  for (const name of fs.readdirSync(GUIDE_DIR)) {
    const target = path.join(GUIDE_DIR, name);
    if (keep.has(name) || !fs.statSync(target).isDirectory()) continue;
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[guide] removed stale page: guide/${name}/`);
  }
  for (const guide of GUIDES) {
    const dir = path.join(GUIDE_DIR, guide.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildArticle(guide, analytics), 'utf8');
    console.log(`[guide] ${guide.slug}: 本文 ${guide.body.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length}字`);
  }
  fs.writeFileSync(path.join(GUIDE_DIR, 'index.html'), buildIndex(analytics), 'utf8');
  console.log(`Generated ${GUIDES.length} guide page(s) + guide/index.html.`);
}

if (require.main === module) main();

module.exports = { GUIDES, SOURCES, buildArticle, buildIndex };
