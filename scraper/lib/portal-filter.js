'use strict';

/**
 * ポータル・マーケットプレイスを掲載対象から外すためのフィルター。
 *
 * 【なぜ外すのか】
 * この図鑑は「講座を比較する」ためのもので、料金・受講期間・対象レベルを並べて選べることが
 * 価値になっている。自分で講座を提供せず他社の講座を集めているサイトは、講座ごとに料金も
 * 期間も違うため、その比較軸がまるごと埋まらない。実際に次の2件が掲載され、料金・期間とも
 * 空欄になった。
 *
 *   - マナビDX（経産省・IPAが運営する講座検索ポータル）
 *   - ストアカ（個人講師が講座を出品するマーケットプレイス。約37,000講座）
 *
 * 【判定の考え方】
 * 「第三者が講座を出す場である」ことを示す語だけを見る。自分で講座を提供しているスクールは、
 * 他社や個人に対して掲載・出品を呼びかけない。
 *
 * 【誤判定を避けるための較正】
 * 掲載中の実データ19件（スクール17件＋ポータル2件）で全キーワードを実測し、スクール側に
 * 1件もヒットしないものだけを採用した。候補に入れていた「講座を探す」は Winスクール
 * （全国に教室を持つ実在のスクール）にもヒットしたため外している。
 * 将来この判定で実在のスクールが弾かれた場合は、まずここの較正をやり直すこと。
 */

/** 第三者が講座を掲載・出品する場であることを示す語。 */
const PORTAL_MARKERS = [
  '講座を掲載',
  '掲載講座',
  '講座掲載',
  '掲載事業者',
  '掲載をご希望',
  '掲載申込',
  '掲載申請',
  '先生になる',
  '先生を探す',
  '講師登録',
  '教えたい',
  '講座検索',
];

/**
 * ページ本文がポータル・マーケットプレイスのものかを判定する。
 * 戻り値: ヒットした語の配列（空ならスクールとみなす）。
 */
function portalMarkers(pageText) {
  const compact = String(pageText || '').replace(/[\s　]+/g, '');
  return PORTAL_MARKERS.filter(marker => compact.includes(marker));
}

function looksLikePortal(pageText) {
  return portalMarkers(pageText).length > 0;
}

/**
 * 受注ビジネス（制作代行・運用代行・コンサルティング）が本業の会社を外すための判定。
 *
 * 【なぜ必要か】
 * ポータル判定は「第三者が講座を出す場か」しか見ていないため、
 * 「本業は制作・運用の代行で、その傍らスクールもやっている会社」が素通りしていた。
 * 実際に StockSun株式会社（デジタルマーケティング支援会社）が掲載され、
 * トップページの語数は「代行・コンサルティング」198回に対し「スクール・受講」2回だった。
 * 料金も特徴も講座のものではないため、比較の材料にならない。
 *
 * 【判定の考え方】
 * 語の有無ではなく「どちらが主か」で見る。スクールも制作実績を載せることはあるので、
 * 受注語が一定数あり、かつスクール語よりはっきり多い場合だけ外す。
 *
 * 【誤判定を避けるための較正】
 * 掲載中の実データ43件で全件のスコアを実測して決めた。受注語が最も多かった実在スクールは
 * SNSマーケター養成スクール(39/15)と Withマーケ(32/14) で、いずれもスクール語が上回る。
 * 閾値（20件以上 かつ スクール語の3倍超）はこの実測値の外側に置いてある。
 * 将来この判定で実在のスクールが弾かれた場合は、まずここの較正をやり直すこと。
 */
const SCHOOL_WORDS = ['スクール', '受講', '講座', 'カリキュラム', '受講生', '受講料', 'レッスン', '教室', '学べ', '養成'];
const AGENCY_WORDS = ['制作代行', '運用代行', '代行', 'コンサルティング', '支援会社', '受託', 'お見積', '制作会社'];

const AGENCY_MIN_HITS = 20;
const AGENCY_RATIO = 3;

function countWords(text, words) {
  return words.reduce((n, w) => n + (text.split(w).length - 1), 0);
}

/** 受注ビジネスが主に見えるか。戻り値は判定に使ったスコア（判定結果は looksLikeAgency）。 */
function agencyScore(pageText) {
  const compact = String(pageText || '').replace(/[s　]+/g, '');
  const school = countWords(compact, SCHOOL_WORDS);
  const agency = countWords(compact, AGENCY_WORDS);
  return { school, agency, isAgency: agency >= AGENCY_MIN_HITS && agency > school * AGENCY_RATIO };
}

function looksLikeAgency(pageText) {
  return agencyScore(pageText).isAgency;
}

module.exports = { PORTAL_MARKERS, portalMarkers, looksLikePortal, SCHOOL_WORDS, AGENCY_WORDS, agencyScore, looksLikeAgency };
