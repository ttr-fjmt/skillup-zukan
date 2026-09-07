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
