'use strict';

/**
 * A8などのアフィリエイト案件を管理するExcelを作る。
 *
 * 既存2サイト（agent-zukan / freelance-anken-zukan）で使っている
 * 「反映 / 広告主名 / リンク / 特徴 …」のシートを踏襲しつつ、
 * このサイトの項目（ジャンル・受講スタイル・給付金）に合わせている。
 *
 * 掲載中の講座はあらかじめ行として書き出す。多くの場合は
 * 「すでに載っているスクールに提携リンクが付いた」という更新になるため、
 * 公式サイトURLで既存レコードと突き合わせられるようにしておく。
 *
 * すでにファイルがある場合は上書きしない（記入済みの内容を消さないため）。
 * 作り直したいときは --force を付けるか、既存ファイルを退避してから実行する。
 *
 * 実行: cd scraper && node generate-a8-template.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { GENRE, GENRE_LABELS, FORMAT, FORMAT_LABELS } = require('./lib/schema');
const { readSchools } = require('./lib/schools-store');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'a8-import');
const OUT_PATH = path.join(OUT_DIR, 'アフィリエイト案件_スキルアップ図鑑.xlsx');

/** 空行のストック。新しい案件を足せるように、あらかじめ行を用意しておく。 */
const BLANK_ROWS = 40;

const HEADERS = [
  '反映',
  'スクール名',
  'リンク',
  '公式サイトURL',
  'ジャンル',
  '受講スタイル',
  '給付金',
  '特徴（A8の紹介文）',
  '備考',
];

/** 列幅（文字数の目安）。リンクと特徴は長いので広めに取る。 */
const COL_WIDTHS = [6, 26, 52, 34, 20, 12, 10, 52, 24];

function buildRows(schools) {
  const rows = [HEADERS];

  for (const s of schools) {
    rows.push([
      s.cta_type === 'affiliate',
      s.school_name,
      '', // A8の広告リンク（HTMLタグごと貼り付け）
      s.official_url,
      (s.skill_genre || []).map(g => GENRE_LABELS[g] || g).join('、'),
      FORMAT_LABELS[s.format] || '',
      s.subsidy_eligible ? '対象講座あり' : '',
      '',
      '掲載中',
    ]);
  }

  for (let i = 0; i < BLANK_ROWS; i += 1) {
    rows.push([false, '', '', '', '', '', '', '', '']);
  }
  return rows;
}

function buildGuideRows() {
  return [
    ['列', '書き方'],
    ['反映', 'サイトへの取り込みが済むとTRUEになります。記入は不要です。'],
    ['スクール名', 'サイトに表示する名前。すでに掲載中のものは変えないでください。'],
    ['リンク', 'A8で発行した広告リンクを、HTMLタグごとそのまま貼り付けます。'],
    ['公式サイトURL', 'スクールの公式サイト。すでに掲載中かどうかは、この欄で突き合わせます。'],
    ['ジャンル', '下の一覧から選びます。複数ある場合は「、」で区切ります。'],
    ['受講スタイル', '下の一覧から選びます。'],
    ['給付金', '教育訓練給付金の対象講座があれば「対象講座あり」と書きます。不明なら空欄で構いません。'],
    ['特徴（A8の紹介文）', 'A8に載っている紹介文を貼り付けます。'],
    ['', 'そのままサイトに載せることはありません。公式サイトに同じ記載があるかを機械的に確かめ、'],
    ['', '確認できた内容だけを掲載します。'],
    ['備考', '自由記入。連絡事項や、取り下げたい場合の理由などに使ってください。'],
    ['', ''],
    ['ジャンルの一覧', GENRE.map(g => GENRE_LABELS[g]).join('、')],
    ['受講スタイルの一覧', FORMAT.map(f => FORMAT_LABELS[f]).join('、')],
    ['', ''],
    ['注意', 'このシートに書いた紹介文が、そのままサイトに掲載されることはありません。'],
    ['', '料金・特徴などは公式サイトの記載を機械的に確認したうえで掲載します。'],
    ['', '確認できなかった項目は「要問い合わせ」と表示されます。'],
  ];
}

function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(OUT_PATH) && !force) {
    console.log(`${path.basename(OUT_PATH)} は既にあります。記入済みの内容を消さないため、作り直しません。`);
    console.log('作り直す場合は --force を付けてください（既存ファイルは上書きされます）。');
    return;
  }

  const schools = readSchools().filter(s => s.status === 'active');
  const wb = XLSX.utils.book_new();

  const sheet = XLSX.utils.aoa_to_sheet(buildRows(schools));
  sheet['!cols'] = COL_WIDTHS.map(w => ({ wch: w }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, sheet, '案件一覧');

  const guide = XLSX.utils.aoa_to_sheet(buildGuideRows());
  guide['!cols'] = [{ wch: 22 }, { wch: 84 }];
  XLSX.utils.book_append_sheet(wb, guide, '記入方法');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  XLSX.writeFile(wb, OUT_PATH);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`  掲載中の講座 ${schools.length}件 + 空行 ${BLANK_ROWS}行`);
}

if (require.main === module) main();

module.exports = { HEADERS, buildRows, buildGuideRows, OUT_PATH };
