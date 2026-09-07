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
  genreOrderForPurpose,
  purposeOrderForGenres,
};
