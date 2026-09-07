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
  const r = classifyFormat('both', ['東京都', '大阪府'], '教室は東京都渋谷区と大阪府梅田にあります');
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

// ---- plans（トップレベル）と price（導出）の関係 ----

test('verifyPlans: 本文に無い期間は落とす（単位換算・言い換えを採用しない）', () => {
  const { verifyPlans } = require('../lib/price-detail');
  // 本文は「6ヶ月(182日)」。AIが「約6ヶ月」と言い換えた場合は採用しない。
  assert.deepStrictEqual(
    verifyPlans([{ label: '夜間・休日', amount: null, duration: '約6ヶ月', kind: null }], '夜間休日スタイルの場合6ヶ月(182日)'),
    []
  );
  assert.deepStrictEqual(
    verifyPlans([{ label: '夜間・休日', amount: null, duration: '6ヶ月', kind: null }], '夜間休日スタイルの場合6ヶ月(182日)'),
    [{ label: '夜間・休日', amount: null, duration: '6ヶ月', kind: null }]
  );
});

test('verifyPlans: 金額が無くても期間が取れていればプランとして残す', () => {
  const { verifyPlans } = require('../lib/price-detail');
  const kept = verifyPlans([{ label: 'Webエンジニア転職保証', amount: null, duration: '6ヶ月' }], '約6ヶ月でWebエンジニア転職を目指す');
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].amount, null);
});

test('掲載中のレコードは duration（スクール代表値）を持たない', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    assert.ok(!('duration' in school), `${school.id}: 廃止した duration が残っている`);
    assert.ok(Array.isArray(school.plans), `${school.id}: plans がトップレベルに無い`);
  }
});

test('掲載中のレコードの price は plans から導出した値と一致する', () => {
  const { buildPriceFromPlans } = require('../lib/price-detail');
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    const derived = buildPriceFromPlans(school.plans, school.price.scope);
    assert.strictEqual(school.price.min_yen, derived.min_yen, `${school.id}: min_yen が plans と食い違っている`);
    assert.strictEqual(school.price.display, derived.display, `${school.id}: display が plans と食い違っている`);
  }
});

test('掲載中のレコードの price.scope は price_detail_url の有無と整合する', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    const expected = school.price_detail_url ? 'detail_page' : 'top_page';
    assert.strictEqual(school.price.scope, expected, `${school.id}: scope と price_detail_url が食い違っている`);
  }
});

test('掲載中のレコードは廃止した detail_page_url を持たない（用途別に分離済み）', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    assert.ok(!('detail_page_url' in school), `${school.id}: 分離前の detail_page_url が残っている`);
  }
});

// ---- career_paths / area の合成防止（video_editing ジャンルで発覚） ----

test('verifyCareerPaths: 本文に無い職種名は落とす（一般知識からの補完を防ぐ）', () => {
  const { verifyCareerPaths } = require('../lib/school-discovery');
  // デジタルハリウッドの実例。7件中3件が本文に無かった。
  const pageText = 'Webデザイナー、動画クリエイター、デジタルアーティスト、3DCGデザイナーを目指せます。';
  const kept = verifyCareerPaths(
    ['フリーランスクリエイター', 'Webデザイナー', '動画クリエイター', 'デジタルアーティスト', 'CG/VFXアーティスト', '3DCGデザイナー', 'UI/UXデザイナー'],
    pageText
  );
  assert.deepStrictEqual(kept, ['Webデザイナー', '動画クリエイター', 'デジタルアーティスト', '3DCGデザイナー']);
});

test('verifyCareerPaths: 中黒・スラッシュ・全角空白の違いは無視して照合する', () => {
  const { verifyCareerPaths } = require('../lib/school-discovery');
  assert.deepStrictEqual(verifyCareerPaths(['UI/UXデザイナー'], 'UIUXデザイナーを目指す'), ['UI/UXデザイナー']);
  assert.deepStrictEqual(verifyCareerPaths(['Web デザイナー'], 'Webデザイナー募集'), ['Web デザイナー']);
});

test('classifyFormat: AIが挙げた都道府県も本文照合を通す（トップページ経路の穴を塞ぐ）', () => {
  // 全国展開しているスクールで、AIが本文に無い県まで補完した実例。
  const pageText = '全国の校舎で学べます。東京校、大阪校、福岡校を展開。';
  const r = classifyFormat('both', ['東京都', '大阪府', '福岡県', '沖縄県', '香川県'], pageText);
  assert.deepStrictEqual(r.area, ['東京都', '大阪府', '福岡県'], '本文に無い県が残っている');
  assert.strictEqual(r.format, 'both');
});

test('classifyFormat: 都道府県が全部落ちたら通学系を名乗らせない', () => {
  const r = classifyFormat('both', ['沖縄県', '香川県'], 'オンラインで学べるスクールです。');
  assert.deepStrictEqual(r.area, []);
  assert.strictEqual(r.format, 'online');
  assert.deepStrictEqual(r.flags, ['format_unconfirmed']);
});

test('掲載中のレコードの career_paths / area に、本文に無い値が残っていない', () => {
  // ページ本文はここでは取れないので、形式面（重複・空文字）だけ確認する。
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    assert.deepStrictEqual([...new Set(school.career_paths)], school.career_paths, `${school.id}: career_paths が重複`);
    assert.ok(school.career_paths.every(c => c.trim()), `${school.id}: career_paths に空文字`);
  }
});

test('id はサブドメインではなく登録可能ドメインから作る（school が量産されない）', () => {
  const { domainSlug } = require('../lib/school-id');
  assert.strictEqual(domainSlug('https://school.dhw.co.jp/'), 'dhw');
  assert.strictEqual(domainSlug('https://school.vook.vc/'), 'vook');
  assert.strictEqual(domainSlug('https://www.sejuku.net/'), 'sejuku');
  assert.strictEqual(domainSlug('https://techacademy.jp/'), 'techacademy');
  assert.strictEqual(domainSlug('https://tech-camp.in/'), 'tech-camp');
});

test('掲載中のレコードに、汎用サブドメイン由来の id が残っていない', () => {
  const schools = require('../../data/schools.json');
  const generic = ['school', 'schools', 'www', 'lp', 'course', 'courses', 'info', 'site'];
  for (const school of schools) {
    const base = school.id.replace(/-\d+$/, '');
    assert.ok(!generic.includes(base), `${school.id}: 汎用サブドメイン由来の id`);
  }
});

// ---- 金額の種別（kind）: 月額と総額を同じ軸で比べない ----

test('buildPriceFromPlans: total があれば total だけで min_yen を求める', () => {
  const { buildPriceFromPlans } = require('../lib/price-detail');
  const r = buildPriceFromPlans(
    [
      { label: 'A', amount: 475200, duration: null, kind: 'total' },
      { label: 'B', amount: 9800, duration: null, kind: 'monthly' },
      { label: 'C', amount: 50000, duration: null, kind: 'enrollment' },
    ],
    'top_page'
  );
  assert.strictEqual(r.min_yen, 475200, '月額や入学金と混ぜて最小値を取っている');
  assert.strictEqual(r.kind, 'total');
  assert.strictEqual(r.display, '475,200円');
});

test('buildPriceFromPlans: total が無ければ monthly を使い、月額と分かる表示にする', () => {
  const { buildPriceFromPlans } = require('../lib/price-detail');
  // Vook の実例（入学金139,700円＋月額39,600円）。
  const r = buildPriceFromPlans(
    [
      { label: 'エントリー', amount: 74800, duration: null, kind: 'monthly' },
      { label: 'マスター', amount: 139700, duration: null, kind: 'enrollment' },
      { label: 'マスター', amount: 39600, duration: null, kind: 'monthly' },
    ],
    'detail_page'
  );
  assert.strictEqual(r.min_yen, 39600);
  assert.strictEqual(r.kind, 'monthly');
  assert.strictEqual(r.display, '月額39,600円〜', '月額であることが表示から分からない');
});

test('buildPriceFromPlans: 入学金しか無い場合は min_yen を出さない（受講料ではない）', () => {
  const { buildPriceFromPlans } = require('../lib/price-detail');
  const r = buildPriceFromPlans([{ label: 'A', amount: 50000, duration: null, kind: 'enrollment' }], 'top_page');
  assert.strictEqual(r.min_yen, null);
  assert.strictEqual(r.kind, null);
});

test('buildPriceFromPlans: kind を判定できないプランは min_yen に使わない', () => {
  const { buildPriceFromPlans } = require('../lib/price-detail');
  const r = buildPriceFromPlans([{ label: 'A', amount: 100000, duration: null, kind: null }], 'top_page');
  assert.strictEqual(r.min_yen, null);
});

test('normalizePlans: 同じプラン名でも入学金と月額は別エントリとして残す', () => {
  const { normalizePlans } = require('../lib/price-detail');
  const kept = normalizePlans([
    { label: 'マスタープラン', amount: 139700, kind: 'enrollment' },
    { label: 'マスタープラン', amount: 39600, kind: 'monthly' },
  ]);
  assert.strictEqual(kept.length, 2, '片方を割引価格と誤認して捨てている');
});

test('掲載中のレコードの price.kind は plans の種別と整合する', () => {
  const schools = require('../../data/schools.json');
  for (const school of schools) {
    if (school.price.min_yen === null) continue;
    const usable = school.plans.filter(p => p.kind === school.price.kind && p.amount !== null);
    assert.ok(usable.length > 0, `${school.id}: price.kind に対応する plans が無い`);
    assert.strictEqual(school.price.min_yen, Math.min(...usable.map(p => p.amount)), `${school.id}: min_yen が種別内の最小値でない`);
  }
});

// ---- recheck-guards.js（全レコードへのガード再適用） ----

test('inferKind: 金額の直前で最も近い表記を採る（「入学金無料月額74,800円」を誤らない）', () => {
  const { inferKind } = require('../recheck-guards');
  assert.strictEqual(inferKind(74800, 'エントリープラン入学金無料月額74800円'), 'monthly');
  assert.strictEqual(inferKind(139700, 'マスタープラン入学金139700円(税込)'), 'enrollment');
  assert.strictEqual(inferKind(39600, '入学金139700円(税込)〜月額39600円'), 'monthly');
  assert.strictEqual(inferKind(657800, '一括料金657800円(税込)'), 'total');
  assert.strictEqual(inferKind(999999, '本文に無い金額'), null);
});

test('recheckSchool: 本文に無い値だけを落とし、新しい値は作らない', () => {
  const { recheckSchool } = require('../recheck-guards');
  const school = {
    id: 'x', school_name: 'テスト', official_name: 'Example Co., Ltd.',
    career_paths: ['Webデザイナー', '存在しない職種'],
    area: ['東京都', '沖縄県'], format: 'both',
    plans: [{ label: 'A', amount: 100000, duration: null, kind: null }],
    price: { display: '', min_yen: null, scope: 'top_page', kind: null },
    review_flags: [],
  };
  const changes = recheckSchool(school, '東京校の教室でWebデザイナーを目指せます。一括料金100,000円。');

  assert.strictEqual(school.official_name, null, '英語表記のみの社名が残っている');
  assert.deepStrictEqual(school.career_paths, ['Webデザイナー']);
  assert.deepStrictEqual(school.area, ['東京都'], '本文に無い県が残っている');
  assert.strictEqual(school.price.min_yen, 100000);
  assert.strictEqual(school.price.kind, 'total');
  assert.ok(changes.length >= 3);
});

test('recheckSchool: 本文にある値は落とさない（取りこぼしを作らない）', () => {
  const { recheckSchool } = require('../recheck-guards');
  const school = {
    id: 'y', school_name: 'テスト', official_name: '株式会社サンプル',
    career_paths: ['Webエンジニア'], area: [], format: 'online',
    plans: [], price: { display: '', min_yen: null, scope: 'top_page', kind: null }, review_flags: [],
  };
  const changes = recheckSchool(school, '会社名 株式会社サンプル / Webエンジニアを目指すオンラインスクール');
  assert.deepStrictEqual(changes, []);
  assert.strictEqual(school.official_name, '株式会社サンプル');
});

test('recheckSchool: official_name は本文照合で消さない（根拠ページが取得範囲外のため）', () => {
  const { recheckSchool } = require('../recheck-guards');
  // 正式名称の根拠は会社概要ページにあり、official_url の本文には無いのが普通。
  // ここで照合すると、確認済みの値を「本文に無い」と誤判定して消してしまう。
  const school = {
    id: 'z', school_name: 'テスト', official_name: '株式会社サンプル',
    career_paths: [], area: [], format: 'online',
    plans: [], price: { display: '', min_yen: null, scope: 'top_page', kind: null }, review_flags: [],
  };
  recheckSchool(school, 'スクールのトップページ本文。会社名の記載は無い。');
  assert.strictEqual(school.official_name, '株式会社サンプル', '確認済みの正式名称を消している');
});

test('recheckSchool: 英語表記のみの official_name は本文が無くても落とす', () => {
  const { recheckSchool } = require('../recheck-guards');
  const school = {
    id: 'z2', school_name: 'テスト', official_name: 'Example Co., Ltd.',
    career_paths: [], area: [], format: 'online',
    plans: [], price: { display: '', min_yen: null, scope: 'top_page', kind: null }, review_flags: [],
  };
  recheckSchool(school, 'トップページ本文');
  assert.strictEqual(school.official_name, null);
});
