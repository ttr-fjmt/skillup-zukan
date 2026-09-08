'use strict';

/**
 * 付与されたジャンルが、公式サイト本文で裏付けられるかを機械的に確かめる。
 *
 * 【なぜ必要か】
 * 他の項目（official_name / career_paths / area / features / subsidy）はすべて
 * 「本文に書かれているか」を機械的に照合しているのに、skill_genre だけ照合が無く、
 * AIの判断をそのまま信じていた。当サイトの8ジャンルに当てはまらない講座を渡すと、
 * AIは近そうなものへ無理に当てはめる。実際に次のような取り違えが起きた。
 *
 *   - ハーブピーリング教室（美容の施術講座） → UI/UXデザイン
 *   - MoneyWith（不動産投資のスクール）     → プログラミング・エンジニア
 *
 * 【判定の考え方】
 * ジャンルごとに「そのジャンルの講座なら本文に出るはずの語」を持ち、1つも無ければ
 * そのジャンルを落とす。落とした結果ジャンルが0件になったレコードは、スキーマの
 * minItems:1 で弾かれて掲載されない（＝当サイトの守備範囲外だった、ということ）。
 *
 * 【誤判定を避けるための較正】
 * 掲載中の実データ全件で、付与済みジャンルが1つも落ちないことを確認して語を選んだ
 * （test/genre-verify.test.js が実データで検査し続ける）。
 * 迷ったら語を足す方向に倒す。ここは「明らかな取り違えを落とす」ためのもので、
 * 分類の精度を上げるためのものではない。
 */

const { GENRE, GENRE_LABELS } = require('./schema');

/** ジャンルごとの裏付けとなる語。1つでも本文にあれば、そのジャンルを認める。 */
const GENRE_EVIDENCE = {
  programming: [
    'プログラミング', 'エンジニア', 'コーディング', 'システム開発', 'アプリ開発', 'Web開発',
    'Java', 'Python', 'PHP', 'JavaScript', 'Ruby', 'SQL', 'インフラ', 'サーバー', 'AWS',
    'フロントエンド', 'バックエンド', 'IT技術', 'ITスキル', 'IT人材',
  ],
  webdesign: [
    'Webデザイン', 'ウェブデザイン', 'デザイナー', 'デザイン', 'Photoshop', 'Illustrator',
    'Figma', 'バナー', 'LP制作', 'ランディングページ', 'コーディング', 'WordPress', 'DTP',
  ],
  uiux: ['UI', 'UX', 'ユーザー体験', 'ユーザーインターフェース', 'プロトタイプ', 'ワイヤーフレーム', 'デザイン思考'],
  video_editing: [
    '動画編集', '映像制作', '映像編集', '動画クリエイター', 'Premiere', 'After Effects',
    'DaVinci', 'YouTube', '動画制作', 'モーショングラフィックス', '撮影',
  ],
  web_marketing: [
    'マーケティング', 'SEO', '広告運用', 'リスティング', 'SNS運用', 'Web集客', 'アクセス解析',
    'コンテンツ制作', 'ライティング', 'EC', '広告',
  ],
  genai_dx: [
    '生成AI', 'ChatGPT', 'AI', 'DX', '機械学習', 'ディープラーニング', 'データサイエンス',
    'データ分析', 'G検定', 'E資格', '自動化', 'プロンプト',
  ],
  language: [
    '英会話', '英語', '語学', 'TOEIC', 'TOEFL', 'IELTS', '英検', '中国語', '韓国語',
    'フランス語', 'ドイツ語', 'スペイン語', '通訳', '翻訳', '日本語教師', 'リスニング', 'スピーキング',
  ],
  certification: [
    '資格', '検定', '試験', '合格', '講座', '通信教育', '免許', '認定',
  ],
};

for (const genre of GENRE) {
  if (!Array.isArray(GENRE_EVIDENCE[genre]) || GENRE_EVIDENCE[genre].length === 0) {
    throw new Error(`genre-verify: GENRE "${genre}" の裏付け語が未定義です`);
  }
}
for (const genre of Object.keys(GENRE_EVIDENCE)) {
  if (!GENRE.includes(genre)) {
    throw new Error(`genre-verify: 未知のジャンル "${genre}" が定義されています`);
  }
}

/** そのジャンルの裏付けとなる語のうち、本文に出てきたものを返す。 */
function genreEvidence(genre, pageText) {
  const compact = String(pageText || '');
  const words = GENRE_EVIDENCE[genre] || [];
  return words.filter(w => compact.includes(w));
}

/**
 * 判定に足る本文が無いとみなす長さ。school-discovery.js の MIN_CONTENT_LENGTH と同じ。
 * JavaScriptで描画するサイトは本文がほとんど取れないため、そこで「裏付けが無い」と
 * 判断すると全ジャンルが落ちてしまう（実在の SHElikes で実際に起きた）。
 */
const MIN_JUDGABLE_LENGTH = 200;

/**
 * 本文で裏付けられないジャンルを落とす。
 * 本文が短すぎて判定できない場合は、何も落とさない（誤って消さないため）。
 * 戻り値: { genres: 残ったジャンル, dropped: 落としたジャンル, judged: 判定したか }
 */
function verifyGenres(genres, pageText) {
  const list = genres || [];
  const text = String(pageText || '');
  if (text.length < MIN_JUDGABLE_LENGTH) {
    return { genres: [...list], dropped: [], judged: false };
  }

  const kept = [];
  const dropped = [];
  for (const genre of list) {
    if (genreEvidence(genre, text).length > 0) kept.push(genre);
    else dropped.push(genre);
  }
  return { genres: kept, dropped, judged: true };
}

/** ログ用の説明文。 */
function describeDropped(dropped) {
  return dropped.map(g => GENRE_LABELS[g] || g).join('、');
}

module.exports = { GENRE_EVIDENCE, MIN_JUDGABLE_LENGTH, genreEvidence, verifyGenres, describeDropped };
