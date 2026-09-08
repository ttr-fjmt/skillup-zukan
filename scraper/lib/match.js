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
