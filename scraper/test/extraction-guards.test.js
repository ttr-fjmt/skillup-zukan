'use strict';

/**
 * 抽出結果に対する機械的なガードの検証。
 *
 * official_name の件（プロンプトで禁止しても合成が3件中3件で起きた）以降、
 * 「AIへの指示」と「本文照合による機械的な検証」を必ず二重で持つ方針にしている。
 * ここでは features の誇張表現除外・受講形式の確定・給付金主張の裏取りを固定する。
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  filterFeatures,
  stripExaggeratedSentences,
  classifyFormat,
  verifySubsidyClaim,
} = require('../lib/school-discovery');
const { NOT_DISCLOSED_TEXT } = require('../lib/schema');

// ---- features の誇張表現除外 ----

test('filterFeatures: 検証不能な統計的数値主張を除外する', () => {
  const input = [
    '転職保証コースで転職成功率99%',
    '受講生の継続率97.9%',
    '受講満足度98%を達成',
    '内定率95%',
  ];
  assert.deepStrictEqual(filterFeatures(input), []);
});

test('filterFeatures: 金銭的コミットメント文言を除外する', () => {
  const input = ['転職保証制度付きコースあり（条件あり）', '副業案件保証5万円分', '返金保証制度', '全額返金対応'];
  assert.deepStrictEqual(filterFeatures(input), []);
});

test('filterFeatures: 最上級・優位性の主張を除外する', () => {
  const input = ['業界No.1の実績', '日本初のマンツーマン専門スクール', '受講者数で国内最大手'];
  assert.deepStrictEqual(filterFeatures(input), []);
});

test('filterFeatures: 客観的事実は残す（カリキュラム・サポート形態・受講形式・講師属性・教材）', () => {
  const input = [
    '専属マンツーマンレッスンによる完全オリジナルカリキュラム', // カリキュラム
    '学習コーチとキャリアアドバイザーによるサポート',           // サポート形態
    '24時間チャット質問サポート',                               // サポート形態
    '700名以上の講師が対応するQ&A掲示板',                       // 講師属性
    '独自開発の学習管理システムで進捗管理',                     // 教材・学習環境
    '短期集中スタイルは10週間、夜間・休日スタイルは約6ヶ月',    // 受講形式
  ];
  assert.deepStrictEqual(filterFeatures(input), input);
});

test('filterFeatures: 数字そのものは残す（件数・期間・時間は客観的事実）', () => {
  const input = [
    '受講終了後1年間の追加カリキュラム（約200時間分）を無償提供',
    'ソフトウェア会社DIVXでの最大1ヶ月間の実務プロジェクト参加',
  ];
  assert.deepStrictEqual(filterFeatures(input), input);
});

test('filterFeatures: 除外の結果0〜2件になっても、水増しせずそのまま返す', () => {
  const result = filterFeatures(['現役エンジニアによるマンツーマンメンタリング', '転職保証制度あり', '返金保証制度']);
  assert.deepStrictEqual(result, ['現役エンジニアによるマンツーマンメンタリング']);
});

test('filterFeatures: 実際に掲載されていた誇張表現（回帰）', () => {
  // 初回の本番実行で features に入っていたもの。
  const actual = ['転職保証コースで転職成功率99%', '副業案件保証5万円分', '返金保証制度', '転職保証制度付きコースあり（条件あり）'];
  assert.deepStrictEqual(filterFeatures(actual), []);
});

// ---- description の誇張表現除外（features と同じ基準を文単位で適用する） ----

test('stripExaggeratedSentences: 統計値を含む文を落とし、残りは自然な文章として残る', () => {
  const input =
    '2013年の創業以来、専任講師によるマンツーマンレッスンを提供。' +
    '受講生の継続率は97.9%で、初心者から実践的なスキル習得まで支援。' +
    '転職やフリーランスなど多様なキャリアパスに対応。';
  assert.strictEqual(
    stripExaggeratedSentences(input),
    '2013年の創業以来、専任講師によるマンツーマンレッスンを提供。転職やフリーランスなど多様なキャリアパスに対応。'
  );
});

test('stripExaggeratedSentences: 実績訴求の文を落とす（%も率も含まない形）', () => {
  const input = '現役エンジニアから学ぶスクール。900社以上の提携企業から10万人以上の受講生を輩出。';
  assert.strictEqual(stripExaggeratedSentences(input), '現役エンジニアから学ぶスクール。');
});

test('stripExaggeratedSentences: 最上級の主張を含む文を落とす', () => {
  assert.strictEqual(
    stripExaggeratedSentences('日本初のマンツーマン専門スクール。オンラインで受講できる。'),
    'オンラインで受講できる。'
  );
});

test('stripExaggeratedSentences: 客観的事実だけの文章はそのまま残す', () => {
  const input =
    '生成AIとプログラミングスキルの習得に加え、実務プロジェクト参加を通じて人材を育成するスクール。' +
    '短期集中（10週間）または夜間・休日（約6ヶ月）の2つの学習スタイルを提供。';
  assert.strictEqual(stripExaggeratedSentences(input), input);
});

test('stripExaggeratedSentences: 全文が落ちた場合は定型文にする', () => {
  assert.strictEqual(stripExaggeratedSentences('継続率97.9%を達成。転職成功率99%。'), NOT_DISCLOSED_TEXT);
  assert.strictEqual(stripExaggeratedSentences(''), NOT_DISCLOSED_TEXT);
  assert.strictEqual(stripExaggeratedSentences(null), NOT_DISCLOSED_TEXT);
});

test('stripExaggeratedSentences: 短くなること自体は許容する（水増ししない）', () => {
  const result = stripExaggeratedSentences('オンライン専用。継続率97.9%。10万人以上の受講生を輩出。');
  assert.strictEqual(result, 'オンライン専用。');
});

test('実績訴求のパターンは、講師属性・体制の説明を巻き込まない', () => {
  // 「700名以上の講師が対応する」は数を数えているが、成果や規模の誇示ではなく体制の説明。
  const feature = '700名以上の講師が対応するQ&A掲示板';
  assert.deepStrictEqual(filterFeatures([feature]), [feature]);
  assert.strictEqual(stripExaggeratedSentences(`${feature}。`), `${feature}。`);
});

test('掲載中のレコードの description に、誇張・実績訴求が残っていない', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    assert.strictEqual(
      stripExaggeratedSentences(school.description),
      school.description,
      `${school.id}: description に除外対象が残っています`
    );
  }
});

// ---- 受講形式の確定 ----

test('classifyFormat: area が取れている通学系はそのまま採用する', () => {
  const r = classifyFormat('both', ['東京都', '大阪府'], '教室は渋谷にあります');
  assert.deepStrictEqual(r, { format: 'both', area: ['東京都', '大阪府'], flags: [], areaSource: 'top_page' });
});

test('classifyFormat: トップページからの判断には area_source=top_page が付く', () => {
  assert.strictEqual(classifyFormat('online', [], '完全オンライン').areaSource, 'top_page');
  assert.strictEqual(classifyFormat('offline', [], '教室あり').areaSource, 'top_page');
});

test('classifyFormat: 「完全オンライン」等の明示があればオンライン確定（フラグ無し）', () => {
  for (const phrase of ['完全オンラインで受講できます', '学習をすべてオンラインで行うプランです', 'オンラインに特化したスクール', 'オンライン完結型']) {
    const r = classifyFormat('online', [], phrase);
    assert.deepStrictEqual(r.flags, [], phrase);
    assert.strictEqual(r.format, 'online');
  }
});

test('classifyFormat: 明示的記述が無ければ online にしつつ format_unconfirmed を立てる', () => {
  const r = classifyFormat('online', [], 'プログラミングを学べるスクールです。転職サポートあり。');
  assert.strictEqual(r.format, 'online');
  assert.deepStrictEqual(r.flags, ['format_unconfirmed']);
});

test('classifyFormat: 通学キーワードがあるのに area が空なら format_unconfirmed（黙ってオンライン扱いにしない）', () => {
  const r = classifyFormat('online', [], '渋谷校の教室で対面指導も行っています。通学プランあり。');
  assert.deepStrictEqual(r.flags, ['format_unconfirmed']);
});

test('classifyFormat: offline/both なのに area が空なら format_unconfirmed を立てる', () => {
  for (const format of ['offline', 'both']) {
    const r = classifyFormat(format, [], '教室で学べます');
    assert.strictEqual(r.format, 'online', format);
    assert.deepStrictEqual(r.area, []);
    assert.deepStrictEqual(r.flags, ['format_unconfirmed'], format);
  }
});

test('classifyFormat: online 指定なら area は必ず空にする（スキーマの整合性）', () => {
  const r = classifyFormat('online', ['東京都'], '完全オンライン');
  assert.deepStrictEqual(r.area, []);
});

// ---- 給付金主張の裏取り ----

test('verifySubsidyClaim: 本文に給付金関連の記述があれば true のまま', () => {
  const cases = [
    '給付金 最大80%OFF 教育訓練給付の対象コース',
    'リスキリングを通じたキャリアアップ支援事業の対象',
    '給付金適用後実質131,560円(税込)',
    '専門実践教育訓練給付金の対象講座です',
  ];
  for (const pageText of cases) {
    assert.strictEqual(verifySubsidyClaim(true, pageText), true, pageText);
  }
});

test('verifySubsidyClaim: キーワードが一つも無ければ false に倒す', () => {
  const pageText = 'プログラミングを基礎から学べるオンラインスクールです。現役エンジニアが指導します。';
  assert.strictEqual(verifySubsidyClaim(true, pageText), false);
});

test('verifySubsidyClaim: もともと false なら false のまま', () => {
  assert.strictEqual(verifySubsidyClaim(false, '教育訓練給付の対象'), false);
});

test('verifySubsidyClaim: pageText が無ければ判定をスキップする', () => {
  assert.strictEqual(verifySubsidyClaim(true, undefined), true);
});

// ---- 掲載中データの不変条件 ----

test('掲載中のレコードの features に、誇張・検証不能な主張が残っていない', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    assert.deepStrictEqual(
      filterFeatures(school.features),
      school.features,
      `${school.id}: features に除外対象が残っています`
    );
  }
});

test('掲載中のレコードで format=online なら area は空', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    if (school.format === 'online') assert.deepStrictEqual(school.area, [], school.id);
  }
});
