'use strict';

/**
 * ジャンル別の発見クエリセット。
 *
 * freelance-anken-zukan の SEARCH_CATEGORIES（カテゴリーごとに軽量なweb_search
 * 呼び出しを分けることで、1本の広いクエリでは頭打ちになる候補のカバレッジを広げる）
 * と同じ考え方だが、本サイトでは「1ジャンル＝1クエリ」ではなく「1ジャンル＝3〜5クエリ」
 * とし、表現の切り口（一覧系・おすすめ系・目的系・給付金系）を変えて重複除去する。
 *
 * クエリ文字列そのものはAIに渡す「検索の切り口」であり、web_searchツールが実際に
 * 投げるクエリはAIが調整する。ここでの狙いは、AIが自分の知識だけで思いつく範囲に
 * 閉じず、切り口の異なる検索を実際に複数回行わせること。
 *
 * ヒット数が想定より少ないジャンルが出た場合は、この配列にクエリを追加して調整する
 * （既存2サイトと同様、いきなり全ジャンルを回さず1ジャンルずつ様子を見て増やす運用）。
 */

const { GENRE, GENRE_LABELS } = require('./schema');

const DISCOVERY_QUERIES = {
  programming: [
    'プログラミングスクール 一覧',
    'プログラミングスクール おすすめ 未経験',
    'プログラミング講座 オンライン 転職',
    'プログラミングスクール 給付金対象',
    'エンジニア養成スクール 社会人 夜間',
  ],
  webdesign: [
    'Webデザインスクール 一覧',
    'Webデザイン講座 おすすめ 未経験',
    'Webデザインスクール オンライン 副業',
    'Webデザインスクール 給付金対象',
    'デザインスクール 通学 社会人',
  ],
  uiux: [
    'UI/UXデザインスクール 一覧',
    'UIUXデザイン 講座 おすすめ',
    'UXデザイン スクール 転職 実務',
    'プロダクトデザイン スクール 社会人',
  ],
  video_editing: [
    '動画編集スクール 一覧',
    '動画編集 講座 おすすめ 副業',
    '動画編集スクール オンライン 未経験',
    '映像制作スクール 通学 社会人',
    '動画クリエイター 養成講座 案件保証',
  ],
  web_marketing: [
    'Webマーケティングスクール 一覧',
    'Webマーケティング講座 おすすめ 転職',
    'マーケティングスクール 社会人 オンライン',
    'Webマーケティングスクール 給付金対象',
    'SEO 広告運用 スクール 実務',
  ],
  genai_dx: [
    '生成AI 講座 法人 一覧',
    'AI活用 研修 個人向け おすすめ',
    'DXリテラシー 講座 社会人',
    'ChatGPT 活用 スクール 実務',
    'データサイエンス 講座 リスキリング',
  ],
  language: [
    '英会話スクール 一覧 社会人',
    'オンライン英会話 コーチング おすすめ',
    'ビジネス英語 スクール 短期',
    '語学スクール 中国語 韓国語 一覧',
    '英語コーチング 給付金対象',
  ],
  certification: [
    '資格取得 通信講座 一覧',
    '資格スクール おすすめ 社会人',
    '簿記 宅建 通信講座 比較',
    '国家資格 予備校 オンライン',
    '資格講座 教育訓練給付金 対象',
  ],
};

/**
 * ジャンルの追加・削除時に GENRE とクエリ表の間にズレが出ると、そのジャンルだけ
 * 静かに発見されなくなる（既存サイトで実際に2つの一覧がズレる問題があった）。
 * 読み込み時点で必ず落とす。
 */
for (const genre of GENRE) {
  const queries = DISCOVERY_QUERIES[genre];
  if (!Array.isArray(queries) || queries.length < 3) {
    throw new Error(`discovery-queries: GENRE "${genre}" のクエリが3件未満です（現在: ${queries ? queries.length : 0}件）`);
  }
}
for (const genre of Object.keys(DISCOVERY_QUERIES)) {
  if (!GENRE.includes(genre)) {
    throw new Error(`discovery-queries: 未知のジャンル "${genre}" が定義されています（lib/schema.js の GENRE に存在しません）`);
  }
}

/** 発見プロンプトに埋め込むための、ジャンル1件分の「日本語ラベル＋検索の切り口」。 */
function queriesForGenre(genre) {
  return { label: GENRE_LABELS[genre], queries: DISCOVERY_QUERIES[genre] };
}

module.exports = { DISCOVERY_QUERIES, queriesForGenre };
