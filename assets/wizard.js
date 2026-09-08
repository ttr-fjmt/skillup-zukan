/* 自動生成ファイル — 直接編集しないこと。
 * scraper/build-wizard-bundle.js が scraper/lib/ のソースから生成する。
 * 変更したいときは scraper/lib/ 側を直し、node build-wizard-bundle.js を実行する。
 */
(function (global) {
  'use strict';

  var registry = {};
  var cache = {};

  function register(name, factory) {
    registry[name] = factory;
  }

  function require(name) {
    if (cache[name]) return cache[name].exports;
    var factory = registry[name];
    if (!factory) throw new Error('未登録のモジュール: ' + name);
    var module = { exports: {} };
    cache[name] = module;
    factory(module, module.exports, require);
    return module.exports;
  }

  register("./schema", function (module, exports, require) {
'use strict';

/**
 * スキルアップ図鑑（skillup-zukan.net）の共通マスタ。
 *
 * agent-zukan / freelance-anken-zukan の scraper/lib/schema.js（CATEGORIES を
 * 唯一のソースとして、発見クエリ・AIツール定義のenum・フロントの表示を
 * すべてそこから導出する）という設計をそのまま踏襲している。
 * 講座（School）側は分類軸が「ジャンル×目的×レベル」の3軸に増えるため、
 * それぞれをenumとして定義し、AIツール定義のenum・診断ウィザードの選択肢・
 * JSON Schema（schema/school.schema.json）のenumはすべてここと一致させること。
 */

/**
 * 【表示名の約束】UIに出すスクールの名称は必ず school_name（サービス名）を使う。
 *
 * official_name（運営会社の正式名称）は社内参考情報であり、UI表示には使用しない。
 * 理由は2つ:
 *   1. 利用者が探しているのはサービス名であって運営法人名ではない
 *      （「TechAcademy」を探す人は「株式会社ブリューアス」では見つけられない）。
 *   2. official_name は公式サイト本文に明示されていた場合のみ入り、確認できなければ
 *      null になる（lib/school-discovery.js の verifyOfficialName）。表示に使うと、
 *      同じ画面で名前が出る講座と出ない講座が混ざることになる。
 *
 * 詳細ページの見出し・一覧のカード・診断結果・CTA周辺のいずれも school_name を使うこと。
 * この方針は schema/school.schema.json の各 description にも記載してある。
 */

/** スキルジャンル。schema/school.schema.json の skill_genre[] のenumと一致させること。 */
const GENRE = [
  'programming',   // プログラミング・エンジニア
  'webdesign',     // Webデザイン
  'uiux',          // UI/UXデザイン
  'video_editing', // 動画編集
  'web_marketing', // Webマーケティング
  'genai_dx',      // 生成AI・DXリテラシー
  'language',      // 語学
  'certification', // 資格
];

/** 受講目的。schema/school.schema.json の purpose[] のenumと一致させること。 */
const PURPOSE = [
  'career_change',        // 転職・就職
  'side_job',             // 副業
  'freelance',            // 独立・フリーランス転向
  'current_job_skillup',  // 現職でのスキルアップ
  'certification_itself', // 資格取得そのものが目的
  'hobby',                // 趣味・教養
];

/** 対象レベル。単一選択（School.target_level）。 */
const LEVEL = [
  'beginner',    // 未経験・入門
  'novice',      // 初心者〜基礎習得済み
  'experienced', // 経験者・スキルアップ
  'advanced',    // 上級者・専門特化
];

const FORMAT = ['online', 'offline', 'both'];
/**
 * 掲載ステータス。二段階検証（AI発見→HTTP実在確認）を通過したレコードは、検証完了時点で
 * 直接 "active" として保存する（承認フェーズは設けない）。"skipped" は掲載しないと判断した分。
 */
const STATUS = ['active', 'skipped'];
const CTA_TYPE = ['affiliate', 'direct'];

/** 表示用の日本語ラベル。フロント・診断ウィザード・ログの表記をここに一本化する。 */
const GENRE_LABELS = {
  programming: 'プログラミング・エンジニア',
  webdesign: 'Webデザイン',
  uiux: 'UI/UXデザイン',
  video_editing: '動画編集',
  web_marketing: 'Webマーケティング',
  genai_dx: '生成AI・DXリテラシー',
  language: '語学',
  certification: '資格',
};

const PURPOSE_LABELS = {
  career_change: '転職・就職',
  side_job: '副業',
  freelance: '独立・フリーランス転向',
  current_job_skillup: '現職でのスキルアップ',
  certification_itself: '資格取得そのもの',
  hobby: '趣味・教養',
};

const LEVEL_LABELS = {
  beginner: '未経験・入門',
  novice: '初心者〜基礎習得済み',
  experienced: '経験者・スキルアップ',
  advanced: '上級者・専門特化',
};

const FORMAT_LABELS = {
  online: 'オンライン',
  offline: '通学',
  both: 'オンライン・通学の併用可',
};

/**
 * ジャンルごとの PURPOSE 表示順。
 *
 * 「そのジャンルを学ぼうとする人が実際に多く選ぶ目的」の順に並べたマスタで、
 * 用途は2つ:
 *   1. カテゴリーページの目的フィルターUIの並び順（そのジャンルで自然な順に出す）
 *   2. 診断ウィザードQ2で、Q1(purpose)の回答からジャンル選択肢の並び順を決める
 *      「逆引き」（genreOrderForPurpose）。例えばQ1で side_job を選んだ人には、
 *      side_job が上位に来るジャンル（video_editing 等）を先に見せる。
 *
 * LEVEL に相当する順序マスタは意図的に持たない（レベルはジャンルによらず
 * beginner→advanced の一本道で、並べ替える意味が無いため）。
 */
const GENRE_PURPOSE_ORDER = {
  programming:   ['career_change', 'side_job', 'freelance', 'current_job_skillup', 'hobby', 'certification_itself'],
  webdesign:     ['career_change', 'side_job', 'freelance', 'current_job_skillup', 'hobby', 'certification_itself'],
  uiux:          ['career_change', 'freelance', 'current_job_skillup', 'side_job', 'hobby', 'certification_itself'],
  video_editing: ['side_job', 'freelance', 'career_change', 'current_job_skillup', 'hobby', 'certification_itself'],
  web_marketing: ['career_change', 'current_job_skillup', 'side_job', 'freelance', 'hobby', 'certification_itself'],
  genai_dx:      ['current_job_skillup', 'career_change', 'hobby', 'side_job', 'freelance', 'certification_itself'],
  language:      ['hobby', 'current_job_skillup', 'career_change', 'side_job', 'freelance', 'certification_itself'],
  certification: ['certification_itself', 'career_change', 'current_job_skillup', 'hobby', 'side_job', 'freelance'],
};

/** area[] に入れてよい値（都道府県）。表記揺れ（「東京」「東京都」）を防ぐため配列で固定する。 */
const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/**
 * 公式サイト本文の情報量が極端に薄い（SPAのクライアントサイドレンダリング、
 * ボット検知、リダイレクトスタブ等）候補について、AIが取り繕った創作文を
 * 書いてしまうのを防ぐための定型文。freelance-anken-zukan の NOT_DISCLOSED_TEXT と同じ役割。
 */
const NOT_DISCLOSED_TEXT = '詳細情報が確認できませんでした。公式サイトでご確認ください。';

/**
 * 料金を確認できなかったときの price.display。
 *
 * 説明文（description）と違い、料金欄は一覧・詳細ページで金額と同じ場所に出る。
 * そこに長い定型文が入ると読みづらく、「料金が無い」のか「調べきれていない」のかも
 * 伝わらないため、料金欄だけは短く「要問い合わせ」とする。
 * min_yen は引き続き null のままで、価格ソート・フィルターの対象外になる。
 */
const PRICE_NOT_DISCLOSED_TEXT = '要問い合わせ';

/**
 * GENRE_PURPOSE_ORDER の逆引き。指定した purpose を「上位に置いているジャンル」から
 * 順に GENRE を並べ替えて返す（診断ウィザードQ2の選択肢の並び順に使う）。
 * 同順位のジャンルは GENRE の定義順で安定ソートする（実行のたびに順序が変わらないように）。
 */
function genreOrderForPurpose(purpose) {
  const rank = genre => {
    const order = GENRE_PURPOSE_ORDER[genre] || [];
    const idx = order.indexOf(purpose);
    return idx === -1 ? order.length : idx;
  };
  return [...GENRE]
    .map((genre, i) => ({ genre, i, rank: rank(genre) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.genre);
}

/**
 * 選択された複数ジャンルに対する PURPOSE の表示順。各ジャンルでの順位の
 * 合計が小さい順に並べる（例: programming と video_editing を両方選んだ人には、
 * 両方で上位の career_change / side_job が先に来る）。
 * genres が空・未知の場合は PURPOSE の定義順をそのまま返す。
 */
function purposeOrderForGenres(genres) {
  const known = (genres || []).filter(g => GENRE_PURPOSE_ORDER[g]);
  if (known.length === 0) return [...PURPOSE];

  const score = purpose =>
    known.reduce((sum, genre) => {
      const idx = GENRE_PURPOSE_ORDER[genre].indexOf(purpose);
      return sum + (idx === -1 ? PURPOSE.length : idx);
    }, 0);

  return [...PURPOSE]
    .map((purpose, i) => ({ purpose, i, score: score(purpose) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map(x => x.purpose);
}

module.exports = {
  GENRE,
  PURPOSE,
  LEVEL,
  FORMAT,
  STATUS,
  CTA_TYPE,
  GENRE_LABELS,
  PURPOSE_LABELS,
  LEVEL_LABELS,
  FORMAT_LABELS,
  GENRE_PURPOSE_ORDER,
  PREFECTURES,
  NOT_DISCLOSED_TEXT,
  PRICE_NOT_DISCLOSED_TEXT,
  genreOrderForPurpose,
  purposeOrderForGenres,
};

  });

  register("./branding", function (module, exports, require) {
'use strict';

/**
 * 見た目まわり（ロゴURL・ジャンルアイコン・色）の共通ロジック。
 *
 * ここに置く理由:
 * ブラウザ側（index.html）と Node 側（テスト）で同じ関数を使うため。
 * build-wizard-bundle.js がこのファイルも assets/wizard.js に束ねるので、
 * サイトで動くのはテスト済みのコードそのものになる。
 *
 * 【画像の扱いについての方針】
 * 掲載スクールの「ロゴ（ファビコン）」だけを、Googleのアイコン配信サービス経由で表示する。
 * agent-zukan / freelance-anken-zukan と同じ方式。どのスクールかを見分けるための識別用途で、
 * 画像を当サイトのサーバーに複製しない。
 *
 * 一方、各スクールがSNS共有用に作っている大きな画像（og:image）は使わない。
 * 著作権が相手にあること、相手のサーバーの通信量を使うこと（ホットリンク）、
 * 差し替え・拒否設定でこちらの表示が勝手に壊れることが理由。
 * ジャンルアイコンは、その代わりに当サイトで描き起こしたもの（下の GENRE_ICONS）を使う。
 */

const { GENRE } = require('./schema');

/**
 * 公式サイトURLからロゴ（ファビコン）のURLを組み立てる。
 * 取得できるとは限らないので、表示側は必ず失敗時のフォールバックを用意すること。
 */
function buildFaviconUrl(officialUrl) {
  if (!officialUrl) return null;
  let hostname;
  try {
    hostname = new URL(officialUrl).hostname;
  } catch {
    return null;
  }
  if (!hostname) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
}

/**
 * ジャンルごとのアイコン（24x24・線画）。すべて当サイトで描き起こしたもの。
 * fill は使わず stroke="currentColor" 前提なので、文字色を変えれば色が変わる。
 */
const GENRE_ICONS = {
  programming:
    '<polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/>' +
    '<line x1="13.5" y1="4.5" x2="10.5" y2="19.5"/>',
  webdesign:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 9v11"/>',
  uiux:
    '<path d="M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/>' +
    '<path d="m14 12.5 7.5 4-3.2 1.1-1.1 3.2-3.2-8.3Z"/>',
  video_editing:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3V9Z"/>',
  web_marketing:
    '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  genai_dx:
    '<path d="M11 3 12.7 7.3 17 9l-4.3 1.7L11 15l-1.7-4.3L5 9l4.3-1.7L11 3Z"/>' +
    '<path d="m18.5 14.5.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"/>',
  language:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
    '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  certification:
    '<circle cx="12" cy="9" r="6"/><path d="M8.4 14.3 7 22l5-3 5 3-1.4-7.7"/>',
};

/**
 * ジャンルごとの色相（HSL の H）。一覧が全部同じ色にならないようにするためのもので、
 * 意味は持たせていない（色だけで情報を伝えないこと）。
 */
const GENRE_HUES = {
  programming: 210,
  webdesign: 330,
  uiux: 265,
  video_editing: 8,
  web_marketing: 150,
  genai_dx: 285,
  language: 190,
  certification: 40,
};

/** 24x24 の <svg> 要素まるごとを返す。見つからないジャンルは null。 */
function genreIconSvg(genre, className) {
  const body = GENRE_ICONS[genre];
  if (!body) return null;
  const cls = className ? ` class="${className}"` : '';
  return (
    `<svg${cls} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    `${body}</svg>`
  );
}

function genreHue(genre) {
  return Object.prototype.hasOwnProperty.call(GENRE_HUES, genre) ? GENRE_HUES[genre] : 30;
}

/**
 * ロゴが取得できなかったときに出す代替タイル用の1文字。
 * 英字なら大文字1文字、日本語ならそのまま1文字。
 */
function monogram(schoolName) {
  const name = String(schoolName || '').trim();
  if (!name) return '?';
  const ch = Array.from(name)[0];
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
}

module.exports = {
  buildFaviconUrl,
  GENRE_ICONS,
  GENRE_HUES,
  genreIconSvg,
  genreHue,
  monogram,
  // ジャンルを足したときにアイコン・色の追加漏れを検出できるよう、マスタも再輸出する。
  GENRE,
};

  });

  register("./recommend", function (module, exports, require) {
'use strict';

/**
 * トップの「おすすめ講座」カルーセルに出す講座の選び方。
 *
 * 【方針】
 * ここに出すのは、提携（アフィリエイト）している講座だけ。`cta_type === 'affiliate'`
 * が目印で、A8などの提携データを取り込むときに立つ。
 * agent-zukan / freelance-anken-zukan の featured 枠と同じ考え方。
 *
 * 【表示するときの約束】
 * この枠は商業的な理由で選んでいるため、必ず「PR」の表示を添えること
 * （2023年10月からのステマ規制で、広告であることを隠すのは景品表示法違反になる）。
 * 一覧そのものの並び順は提携の有無で変えない。変えているのはこの枠だけ。
 * 説明は faq.html と privacy.html にも書いてあるので、変えるときは合わせて直すこと。
 *
 * 提携が1件も無いあいだは空配列を返す。呼び出し側は枠ごと隠すこと
 * （提携していない講座を「おすすめ」として出すと、この枠の意味と説明が食い違うため）。
 */

/** おすすめ枠に出してよい講座か。掲載中かつ提携済みのものだけ。 */
function isRecommendable(school) {
  return !!school && school.status === 'active' && school.cta_type === 'affiliate';
}

/** Fisher-Yates。rng は 0以上1未満を返す関数（テストから差し替えられるように引数にする）。 */
function shuffle(list, rng) {
  const random = rng || Math.random;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * おすすめ枠に出す講座を選ぶ。
 * 提携済みの講座から、ランダムな順で最大 limit 件を返す。
 * 順番を固定しないのは、特定の1社だけが常に先頭になるのを避けるため。
 */
function pickRecommended(schools, options) {
  const opts = options || {};
  const limit = opts.limit || 10;
  return shuffle((schools || []).filter(isRecommendable), opts.rng).slice(0, limit);
}

module.exports = { isRecommendable, pickRecommended, shuffle };

  });

  register("./match", function (module, exports, require) {
'use strict';

/**
 * 診断ウィザードのマッチングロジック。
 *
 * 指示書の擬似コードをそのまま実装したうえで、実装時に2点だけ明示的に決めている:
 *
 *   - 入力の School オブジェクトは変更しない（擬似コードは school.match_score を直接
 *     代入していたが、同じ配列を何度も診断に使うため、コピーに載せて返す）。
 *   - 「口コミ件数」でのタイブレークは、review_summary.sources[] の件数を使う。
 *     本サイトは口コミ原文を保存しない設計（lib/review-summary.js のコメント参照）のため、
 *     手元にある「口コミの多さ」の指標は出典の数だけである。
 */

const { LEVEL, GENRE_LABELS, PURPOSE_LABELS, LEVEL_LABELS } = require('./schema');

/** 診断結果として返す最大件数。 */
const MAX_RESULTS = 5;

/** 加点の内訳。マッチ理由の文章もここから作るため、配点と文言を1箇所にまとめる。 */
const SCORE_WEIGHTS = {
  purpose: 3,
  levelExact: 2,
  levelAdjacent: 1,
  format: 2,
  subsidy: 2,
  // ジャンル一致は min(一致数, 3) なので最大3点。
  genreMax: 3,
};

/** レベルが隣接しているか（beginner と novice、novice と experienced 等）。 */
function isAdjacentLevel(a, b) {
  const ia = LEVEL.indexOf(a);
  const ib = LEVEL.indexOf(b);
  if (ia === -1 || ib === -1) return false;
  return Math.abs(ia - ib) === 1;
}

/** school.format が回答の受講スタイルを満たすか（both は online/offline どちらも満たす）。 */
function formatMatches(schoolFormat, answerFormat) {
  if (answerFormat === 'either') return true;
  return schoolFormat === answerFormat || schoolFormat === 'both';
}

function intersect(a, b) {
  const setB = new Set(b || []);
  return (a || []).filter(v => setB.has(v));
}

/** 口コミの多さの指標（タイブレーク用）。出典数を使う。 */
function reviewSourceCount(school) {
  return school.review_summary && Array.isArray(school.review_summary.sources)
    ? school.review_summary.sources.length
    : 0;
}

/**
 * 候補の絞り込み。ここで落ちたスクールはスコアリングの対象にもならない。
 *   - status が "active" のもののみ（"skipped" は掲載しないと判断した分なので出さない）
 *   - 選択ジャンルと1つ以上重なること
 *   - 通学希望の場合は、その都道府県に教室があること
 */
function filterCandidates(answers, allSchools) {
  return (allSchools || []).filter(school => {
    if (school.status !== 'active') return false;
    if (intersect(school.skill_genre, answers.genres).length === 0) return false;
    if (answers.format === 'offline' && !(school.area || []).includes(answers.prefecture)) return false;
    return true;
  });
}

/**
 * 1件分のスコアと、その内訳を返す。
 * 内訳（components）はマッチ理由の生成に使うため、加点の大きい順に並べて返す。
 */
function scoreSchool(answers, school) {
  const components = [];

  if ((school.purpose || []).includes(answers.purpose)) {
    components.push({
      key: 'purpose',
      points: SCORE_WEIGHTS.purpose,
      reason: `「${PURPOSE_LABELS[answers.purpose]}」を目的とした講座です`,
    });
  }

  if (school.target_level === answers.level) {
    components.push({
      key: 'level',
      points: SCORE_WEIGHTS.levelExact,
      reason: `「${LEVEL_LABELS[answers.level]}」の方を主な対象にしています`,
    });
  } else if (isAdjacentLevel(school.target_level, answers.level)) {
    components.push({
      key: 'level',
      points: SCORE_WEIGHTS.levelAdjacent,
      reason: `対象は「${LEVEL_LABELS[school.target_level]}」で、あなたのレベルに近い内容です`,
    });
  }

  if (answers.format !== 'either' && formatMatches(school.format, answers.format)) {
    components.push({
      key: 'format',
      points: SCORE_WEIGHTS.format,
      reason:
        answers.format === 'offline'
          ? `${answers.prefecture}に通える教室があります`
          : 'オンラインで受講できます',
    });
  }

  if (answers.subsidy_preference === 'want_subsidy' && school.subsidy_eligible) {
    components.push({
      key: 'subsidy',
      points: SCORE_WEIGHTS.subsidy,
      reason: '給付金の対象講座があります',
    });
  }

  const matchedGenres = intersect(school.skill_genre, answers.genres);
  if (matchedGenres.length > 0) {
    components.push({
      key: 'genre',
      points: Math.min(matchedGenres.length, SCORE_WEIGHTS.genreMax),
      reason: `${matchedGenres.map(g => GENRE_LABELS[g]).join('・')}を学べます`,
    });
  }

  const score = components.reduce((sum, c) => sum + c.points, 0);
  // 同点の内訳は、配点の大きい順 → 定義順で安定させる（理由の並びが実行ごとに変わらないように）。
  const ordered = components
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => b.points - a.points || a.i - b.i)
    .map(({ i, ...c }) => c);

  return { score, components: ordered };
}

/**
 * マッチ理由の文章。加点の大きかった上位2項目を自然文にして返す。
 * 加点が1項目しか無い場合はその1つだけ、0件（＝ジャンル一致すら無い）は空配列。
 */
function buildMatchReasons(components, limit = 2) {
  return components.slice(0, limit).map(c => c.reason);
}

/**
 * 診断のメイン。上位 MAX_RESULTS 件を、match_score とマッチ理由付きで返す。
 *
 * 並び順:
 *   1. 提携（cta_type === "affiliate"）している講座を先に出す
 *   2. その中で match_score の高い順
 *   3. 同点なら口コミ件数（出典数）が多い方
 *   4. それでも決まらなければ入力配列の順序を保つ（実行のたびに順番が変わらないように）
 *
 * 【提携を先に出すことについて】
 * 商業上の理由による並べ替えなので、画面には必ず「PR」を表示すること
 * （2023年10月からのステマ規制。広告であることを隠すと景品表示法違反になる）。
 * この扱いは faq.html と privacy.html にも書いてあるので、変えるときは合わせて直すこと。
 *
 * なお、回答条件で絞り込んだ候補（filterCandidates）の中だけで並べ替える。
 * 条件に合わない講座を提携だからといって混ぜることはしない。
 */
function matchSchools(answers, allSchools, limit = MAX_RESULTS) {
  const candidates = filterCandidates(answers, allSchools);

  const scored = candidates.map((school, index) => {
    const { score, components } = scoreSchool(answers, school);
    return {
      ...school,
      match_score: score,
      match_components: components,
      match_reasons: buildMatchReasons(components),
      _index: index,
    };
  });

  scored.sort((a, b) => {
    const affiliateDiff = (b.cta_type === 'affiliate' ? 1 : 0) - (a.cta_type === 'affiliate' ? 1 : 0);
    if (affiliateDiff !== 0) return affiliateDiff;

    if (b.match_score !== a.match_score) return b.match_score - a.match_score;

    const reviewDiff = reviewSourceCount(b) - reviewSourceCount(a);
    if (reviewDiff !== 0) return reviewDiff;

    return a._index - b._index;
  });

  return scored.slice(0, limit).map(({ _index, ...school }) => school);
}

module.exports = {
  MAX_RESULTS,
  SCORE_WEIGHTS,
  isAdjacentLevel,
  formatMatches,
  reviewSourceCount,
  filterCandidates,
  scoreSchool,
  buildMatchReasons,
  matchSchools,
};

  });

  register("./wizard-questions", function (module, exports, require) {
'use strict';

/**
 * 診断ウィザード（あなたに合う講座診断）の質問データ。
 *
 * 選択肢の値はすべて lib/schema.js のマスタから導出する（ここで文字列を手書きしない）。
 * Q2の選択肢の並び順だけは、Q1の回答（purpose）によって変わるため、静的な配列ではなく
 * buildQuestions(answers) で組み立てる。
 */

const {
  GENRE,
  PURPOSE,
  LEVEL,
  GENRE_LABELS,
  PURPOSE_LABELS,
  LEVEL_LABELS,
  PREFECTURES,
  genreOrderForPurpose,
} = require('./schema');

/** Q2で選べるジャンル数の上限（多く選ぶほど診断が絞れなくなるため）。 */
const MAX_GENRES = 3;

const FORMAT_CHOICES = [
  { value: 'online', label: 'オンラインで受けたい' },
  { value: 'offline', label: '通学で受けたい' },
  { value: 'either', label: 'どちらでもよい' },
];

const SUBSIDY_CHOICES = [
  { value: 'want_subsidy', label: '給付金の対象講座から選びたい' },
  { value: 'no_preference', label: 'こだわらない' },
];

const toChoices = (values, labels) => values.map(value => ({ value, label: labels[value] }));

/**
 * 回答途中の状態に応じた質問一覧を返す。
 *
 * - Q2のジャンル選択肢は、Q1で選ばれた purpose を上位に置いているジャンルから順に並べる
 *   （GENRE_PURPOSE_ORDER の逆引き）。Q1が未回答ならGENREの定義順。
 * - Q4で offline を選んだ場合のみ、都道府県の追加質問（Q4b）を出す。
 */
function buildQuestions(answers = {}) {
  const genreValues = answers.purpose ? genreOrderForPurpose(answers.purpose) : [...GENRE];

  const questions = [
    {
      id: 'purpose',
      question: '学ぶ目的は？',
      type: 'single',
      choices: toChoices(PURPOSE, PURPOSE_LABELS),
    },
    {
      id: 'genres',
      question: '興味のあるジャンルは？',
      type: 'multiple',
      maxSelections: MAX_GENRES,
      choices: toChoices(genreValues, GENRE_LABELS),
    },
    {
      id: 'level',
      question: '経験レベルは？',
      type: 'single',
      choices: toChoices(LEVEL, LEVEL_LABELS),
    },
    {
      id: 'format',
      question: '受講スタイルは？',
      type: 'single',
      choices: FORMAT_CHOICES,
    },
  ];

  if (answers.format === 'offline') {
    questions.push({
      id: 'prefecture',
      question: 'どの都道府県で通いたいですか？',
      type: 'single',
      choices: PREFECTURES.map(value => ({ value, label: value })),
    });
  }

  questions.push({
    id: 'subsidy_preference',
    question: '給付金にこだわりたいですか？',
    type: 'single',
    choices: SUBSIDY_CHOICES,
  });

  return questions;
}

/**
 * 回答が診断に渡せる形かを検証する。フロントの実装ミス・古いブックマークからの
 * 不正な値で、マッチングが黙って0件になるのを防ぐ。
 */
function validateAnswers(answers) {
  const errors = [];
  if (!PURPOSE.includes(answers.purpose)) errors.push(`purpose が不正です: ${answers.purpose}`);
  if (!Array.isArray(answers.genres) || answers.genres.length === 0) {
    errors.push('genres が空です');
  } else {
    const unknown = answers.genres.filter(g => !GENRE.includes(g));
    if (unknown.length) errors.push(`genres に未知の値: ${unknown.join(', ')}`);
    if (answers.genres.length > MAX_GENRES) errors.push(`genres は最大${MAX_GENRES}件までです`);
  }
  if (!LEVEL.includes(answers.level)) errors.push(`level が不正です: ${answers.level}`);
  if (!FORMAT_CHOICES.some(c => c.value === answers.format)) errors.push(`format が不正です: ${answers.format}`);
  if (answers.format === 'offline' && !PREFECTURES.includes(answers.prefecture)) {
    errors.push('format=offline のときは prefecture が必須です');
  }
  if (!SUBSIDY_CHOICES.some(c => c.value === answers.subsidy_preference)) {
    errors.push(`subsidy_preference が不正です: ${answers.subsidy_preference}`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { MAX_GENRES, FORMAT_CHOICES, SUBSIDY_CHOICES, buildQuestions, validateAnswers };

  });

  register("./structured-data", function (module, exports, require) {
'use strict';

/**
 * 検索エンジン・AI向けの構造化データ（JSON-LD）を組み立てる。
 *
 * 【なぜ専用モジュールにしているか】
 * 構造化データは、人が読むページ本文と同じ内容を機械向けに書き直したものにすぎない。
 * ここで「それらしい値」を足してしまうと、本文には無いことを検索結果やAIの回答に
 * 出すことになり、このサイトで一番避けたい事故になる（DATA_QUALITY_POLICY.md）。
 * そのため、出力してよいのは
 *   - schools.json のレコードにそのまま入っている値
 *   - このファイルで定義している定数（サイト名・ラベル・schema.org の語彙）
 * の2種類だけと決め、それをテストで機械的に確かめている。
 *
 * 料金については、確認できている「一括の最低額」だけを AggregateOffer.lowPrice として出す。
 * 月額と一括は桁が違うので混ぜられない、という表示側の方針とここも揃えている。
 */

const { GENRE_LABELS } = require('./schema');

const SITE_URL = 'https://skillup-zukan.net';
const SITE_NAME = 'スキルアップ図鑑';
const HOME_BREADCRUMB_NAME = 'ホーム';

/** 受講スタイル → schema.org の courseMode。 */
const COURSE_MODE = {
  online: 'Online',
  offline: 'Onsite',
  both: 'Blended',
};

function schoolUrl(id) {
  return `${SITE_URL}/school/${encodeURIComponent(id)}/`;
}

function categoryUrl(genre) {
  return `${SITE_URL}/category/${encodeURIComponent(genre)}/`;
}

/** パンくず。position は 1 始まり。 */
function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** 講座の一覧（ItemList）。並び順は渡された順のまま。 */
function itemList(schools) {
  return {
    '@type': 'ItemList',
    numberOfItems: schools.length,
    itemListElement: schools.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.school_name,
      url: schoolUrl(s.id),
    })),
  };
}

/**
 * 料金。確認できた一括料金の最低額があるときだけ出す。
 *
 * 月額（kind === 'monthly'）を price として出すと、一括料金と同じ土俵で
 * 比較されて誤解を生むため出さない。金額が確認できていない講座も同じく出さない。
 */
function offersOf(school) {
  const price = school.price || {};
  if (price.kind !== 'total') return null;
  if (typeof price.min_yen !== 'number') return null;

  const offer = {
    '@type': 'AggregateOffer',
    priceCurrency: 'JPY',
    lowPrice: price.min_yen,
    url: school.official_url,
  };
  const plans = (school.plans || []).filter(p => typeof p.amount === 'number');
  if (plans.length) offer.offerCount = plans.length;
  return offer;
}

/** 講座詳細ページ（/school/{id}/）。Course と パンくず。 */
function buildSchoolLd(school) {
  const genre = (school.skill_genre || []).find(g => GENRE_LABELS[g]);

  const course = {
    '@type': 'Course',
    name: school.school_name,
    description: school.description,
    url: schoolUrl(school.id),
    provider: {
      '@type': 'Organization',
      // official_name は「公式サイト本文にその表記があるか」を照合済みのときだけ入っている。
      // 確認できていない場合は、掲載名（school_name）以上のことを名乗らせない。
      name: school.official_name || school.school_name,
      url: school.official_url,
    },
    inLanguage: 'ja',
  };

  if (genre) course.about = { '@type': 'Thing', name: GENRE_LABELS[genre] };

  const offers = offersOf(school);
  if (offers) course.offers = offers;

  if (COURSE_MODE[school.format]) {
    course.hasCourseInstance = {
      '@type': 'CourseInstance',
      courseMode: COURSE_MODE[school.format],
    };
  }

  const trail = [{ name: HOME_BREADCRUMB_NAME, url: `${SITE_URL}/` }];
  if (genre) trail.push({ name: GENRE_LABELS[genre], url: categoryUrl(genre) });
  trail.push({ name: school.school_name, url: schoolUrl(school.id) });

  return { '@context': 'https://schema.org', '@graph': [breadcrumb(trail), course] };
}

/** ジャンル別ページ（/category/{genre}/）。掲載中の講座一覧とパンくず。 */
function buildCategoryLd(genre, schools) {
  const label = GENRE_LABELS[genre];
  const trail = [{ name: HOME_BREADCRUMB_NAME, url: `${SITE_URL}/` }];
  if (label) trail.push({ name: label, url: categoryUrl(genre) });

  const page = {
    '@type': 'CollectionPage',
    name: label ? `${label}の講座・スクール比較` : SITE_NAME,
    url: categoryUrl(genre),
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
    mainEntity: itemList(schools),
  };

  return { '@context': 'https://schema.org', '@graph': [breadcrumb(trail), page] };
}

/** トップページ。サイト全体の情報と、掲載している講座の一覧。 */
function buildHomeLd(schools) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        inLanguage: 'ja',
      },
      {
        '@type': 'CollectionPage',
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
        mainEntity: itemList(schools),
      },
    ],
  };
}

/**
 * 出力してよい定数の一覧。
 * テストで「レコードに無い文字列が混ざっていないか」を確かめるときに使う。
 */
const ALLOWED_CONSTANTS = []
  .concat(['https://schema.org', SITE_NAME, HOME_BREADCRUMB_NAME, 'ja', 'JPY', `${SITE_URL}/`])
  .concat(['BreadcrumbList', 'ListItem', 'ItemList', 'CollectionPage', 'WebSite', 'Course',
    'CourseInstance', 'Organization', 'Thing', 'AggregateOffer'])
  .concat(Object.values(COURSE_MODE))
  .concat(Object.values(GENRE_LABELS));

module.exports = {
  SITE_URL,
  SITE_NAME,
  COURSE_MODE,
  ALLOWED_CONSTANTS,
  schoolUrl,
  categoryUrl,
  offersOf,
  buildSchoolLd,
  buildCategoryLd,
  buildHomeLd,
};

  });

  register("./list-groups", function (module, exports, require) {
'use strict';

/**
 * 一覧の並べ方（どれをどの塊に、何件まで出すか）。
 *
 * 表示の都合とはいえ「どの講座がどこに出るか」を決めているので、
 * index.html に直接書かず lib に置いてテストで固定する。
 * このリポジトリは、書き写したコードとテスト済みのコードが食い違う事故を
 * 一度起こしているため（README・build-wizard-bundle.js の注記を参照）。
 */

const { GENRE } = require('./schema');

/** 1つの塊に出すカードの数。これを超える分は「すべて見る」に送る。 */
const DEFAULT_PREVIEW = 4;

/**
 * ジャンルごとの塊に分ける。
 *
 * 件数（items）は「そのジャンルを含むか」で数える。トップのジャンル別件数（○件）や
 * ジャンル別ページと同じ条件にしておかないと、数え方を疑われるため。
 *
 * 一方、実際に出すカード（preview）は、複数ジャンルの講座を上の塊で出していれば
 * 下の塊では出さない。同じ講座が1画面に2度3度出ると、掲載が重複しているように見える
 * （実際にトップの32枚のうち8枚が同じ講座の再掲になっていた）。
 * 件数と「すべて見る」の先は変わらないので、隠れた講座も必ずたどれる。
 *
 * @returns {{genre: string, items: object[], preview: object[], hidden: number}[]}
 *          該当が0件のジャンルは含めない。
 */
function groupByGenre(schools, options) {
  const opts = options || {};
  const limit = opts.preview || DEFAULT_PREVIEW;
  const genres = opts.genres || GENRE;
  // 同じ講座を2度出さないための控え。unique: false で従来どおり重複を許す。
  const unique = opts.unique !== false;
  const shown = new Set();

  return genres.map(genre => {
    const items = (schools || []).filter(s => (s.skill_genre || []).indexOf(genre) !== -1);
    let preview = unique ? items.filter(s => !shown.has(s.id)).slice(0, limit) : items.slice(0, limit);
    // 全部が上の塊で出ている場合でも、見出しだけの空の塊にはしない。
    // 講座があるジャンルが空欄で並ぶほうが、1件重なるより分かりにくい。
    if (preview.length === 0 && items.length > 0) preview = items.slice(0, 1);
    preview.forEach(s => shown.add(s.id));
    return { genre, items, preview, hidden: Math.max(0, items.length - preview.length) };
  }).filter(group => group.items.length > 0);
}

/**
 * 料金が確認できたものと「要問い合わせ」に分ける。
 *
 * 一覧は料金の安い順だが、金額が確認できていない講座は比べようがないので後ろにまとめている。
 * 区切りを入れないと「途中から並び順が壊れている」ように見えるため、境目を返す。
 */
function splitByPriceKnown(schools) {
  const list = schools || [];
  return {
    priced: list.filter(s => s.price && s.price.min_yen !== null && s.price.min_yen !== undefined),
    unpriced: list.filter(s => !s.price || s.price.min_yen === null || s.price.min_yen === undefined),
  };
}

module.exports = { DEFAULT_PREVIEW, groupByGenre, splitByPriceKnown };

  });

  var api = {};
  var sources = [require('./schema'), require('./branding'), require('./recommend'), require('./match'), require('./wizard-questions'), require('./structured-data'), require('./list-groups')];
  ["GENRE","PURPOSE","LEVEL","FORMAT","PREFECTURES","GENRE_LABELS","PURPOSE_LABELS","LEVEL_LABELS","FORMAT_LABELS","GENRE_PURPOSE_ORDER","genreOrderForPurpose","purposeOrderForGenres","matchSchools","scoreSchool","filterCandidates","MAX_RESULTS","buildQuestions","validateAnswers","MAX_GENRES","buildFaviconUrl","genreIconSvg","genreHue","monogram","GENRE_ICONS","GENRE_HUES","isRecommendable","pickRecommended","buildHomeLd","buildCategoryLd","buildSchoolLd","groupByGenre","splitByPriceKnown"].forEach(function (key) {
    for (var i = 0; i < sources.length; i += 1) {
      if (sources[i][key] !== undefined) { api[key] = sources[i][key]; return; }
    }
    throw new Error('公開対象が見つかりません: ' + key);
  });

  global.SkillupZukan = api;
})(typeof window !== 'undefined' ? window : globalThis);
