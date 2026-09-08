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
 * 同点のタイブレークは指示書のとおり:
 *   1. 口コミ件数（出典数）が多い方
 *   2. cta_type === "affiliate" を優先
 * それでも決まらない場合は、入力配列の順序を保つ（実行のたびに順番が変わらないように）。
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
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;

    const reviewDiff = reviewSourceCount(b) - reviewSourceCount(a);
    if (reviewDiff !== 0) return reviewDiff;

    const affiliateDiff = (b.cta_type === 'affiliate' ? 1 : 0) - (a.cta_type === 'affiliate' ? 1 : 0);
    if (affiliateDiff !== 0) return affiliateDiff;

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

  var api = {};
  var sources = [require('./schema'), require('./match'), require('./wizard-questions')];
  ["GENRE","PURPOSE","LEVEL","FORMAT","PREFECTURES","GENRE_LABELS","PURPOSE_LABELS","LEVEL_LABELS","FORMAT_LABELS","GENRE_PURPOSE_ORDER","genreOrderForPurpose","purposeOrderForGenres","matchSchools","scoreSchool","filterCandidates","MAX_RESULTS","buildQuestions","validateAnswers","MAX_GENRES"].forEach(function (key) {
    for (var i = 0; i < sources.length; i += 1) {
      if (sources[i][key] !== undefined) { api[key] = sources[i][key]; return; }
    }
    throw new Error('公開対象が見つかりません: ' + key);
  });

  global.SkillupZukan = api;
})(typeof window !== 'undefined' ? window : globalThis);
