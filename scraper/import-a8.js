'use strict';

/**
 * アフィリエイト案件のExcelを読み、掲載データに取り込む。
 *
 * 既存2サイト（agent-zukan / freelance-anken-zukan）の import-a8.js と同じ役割だが、
 * このサイトの決まりに合わせて中身は別物にしてある。
 *
 * 【いちばん大きな違い】
 * 既存2サイトは、Excelの紹介文をもとにAIでレコードを組み立てる。
 * このサイトは「公式サイトに書かれていないことは載せない」が大原則なので、
 * Excelから取り込むのは **提携リンクだけ** とし、掲載内容は必ず公式サイトを
 * 取得して機械的に照合したものを使う（日次の発見パイプラインと同じ処理を通す）。
 * Excelの紹介文は掲載に使わない。
 *
 * 【処理の流れ】
 * 1. リンク欄のHTMLから、提携リンクのURLを取り出す
 * 2. 公式サイトURLを決める（欄が空なら提携リンクの転送先をたどり、Excelに書き戻す）
 * 3. すでに掲載中のスクールなら、cta_url と cta_type を提携リンクに差し替えるだけ
 * 4. 未掲載なら、実在照合 → 公式サイト本文からの抽出 → ガード適用まで通してから追加する
 * 5. 正常に処理できた行は、Excel の「反映」列を TRUE に書き換えて保存する
 *
 * 当サイトの8ジャンルに当てはまらない講座は、スキーマ検証で落ちて掲載されない。
 * これは意図した動作で、無理に当てはめない。
 *
 * 実行例:
 *   node import-a8.js
 *   IMPORT_DRY_RUN=1 node import-a8.js     # 書き込まずに結果だけ表示
 *   IMPORT_LIMIT=3 node import-a8.js       # 先頭3行だけ試す
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const {
  getAnthropicClient,
  verifyCandidate,
  buildDiscoveredSchoolFields,
  normalizedHost,
} = require('./lib/school-discovery');
const { enrichPriceFromDetailPage } = require('./lib/price-detail');
const { enrichAreaFromDetailPage, needsAreaEnrichment } = require('./lib/area-detail');
const { buildSchoolId, buildClickTrackingId } = require('./lib/school-id');
const { readSchools, writeSchools } = require('./lib/schools-store');
const { validateSchool } = require('./lib/validate');
const { politeDelay } = require('./lib/http');
const { GENRE, GENRE_LABELS } = require('./lib/schema');

const ROOT = path.join(__dirname, '..');
const IMPORT_DIR = path.join(ROOT, 'data', 'a8-import');
const DRY_RUN = Boolean(process.env.IMPORT_DRY_RUN);
const LIMIT = process.env.IMPORT_LIMIT ? Number(process.env.IMPORT_LIMIT) : null;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** 見出し行の文言で列を引く（列の並びが変わっても動くように）。 */
const COLUMNS = {
  reflected: '反映',
  name: 'スクール名',
  link: 'リンク',
  officialUrl: '公式サイトURL',
  genre: 'ジャンル',
};

function findWorkbookPath() {
  if (!fs.existsSync(IMPORT_DIR)) return null;
  const files = fs
    .readdirSync(IMPORT_DIR)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
  if (files.length === 0) return null;
  files.sort(
    (a, b) =>
      fs.statSync(path.join(IMPORT_DIR, b)).mtimeMs - fs.statSync(path.join(IMPORT_DIR, a)).mtimeMs
  );
  return path.join(IMPORT_DIR, files[0]);
}

/** リンク欄のHTMLから、実際に飛ばす提携リンクのURLを取り出す。 */
function extractAffiliateUrl(cellHtml) {
  const html = String(cellHtml || '');
  const anchor = html.match(/<a[^>]+href=["']([^"']+)["']/i);
  if (anchor) return anchor[1];
  const bare = html.match(/https?:\/\/[^\s"'<>]+/);
  return bare ? bare[0] : null;
}

/** ジャンル欄の日本語ラベルを、内部のジャンルキーに戻す。 */
function parseGenreHint(label) {
  const text = String(label || '').trim();
  if (!text) return null;
  for (const g of GENRE) {
    if (text.includes(GENRE_LABELS[g])) return g;
  }
  return null;
}

/**
 * 提携リンクの転送先をたどって、スクールの公式サイトURLを得る。
 *
 * 提携ネットワーク側にクリックが1回記録されるため、たどった結果は Excel の
 * 「公式サイトURL」欄に書き戻し、次回以降はたどらないようにしている。
 */
async function resolveOfficialUrl(affiliateUrl) {
  const res = await fetch(affiliateUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!res.url) throw new Error('転送先URLを取得できませんでした');
  const url = new URL(res.url);
  // 計測用のクエリは、公式サイトURLとしては持たない。
  return url.origin + url.pathname;
}

function readRows(sheet) {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const header = grid[0] || [];
  const idx = {};
  for (const [key, label] of Object.entries(COLUMNS)) {
    idx[key] = header.findIndex(h => String(h).trim() === label);
    if (idx[key] < 0) throw new Error('Excelに「' + label + '」列が見つかりません');
  }

  const rows = [];
  for (let r = 1; r < grid.length; r += 1) {
    const line = grid[r];
    if (!line) continue;
    const flag = line[idx.reflected];
    rows.push({
      sheetRow: r, // 0始まり（見出しが0行目）
      reflected: flag === true || String(flag).toUpperCase() === 'TRUE',
      name: String(line[idx.name] || '').trim(),
      link: String(line[idx.link] || '').trim(),
      officialUrl: String(line[idx.officialUrl] || '').trim(),
      genreHint: parseGenreHint(line[idx.genre]),
    });
  }
  return { rows, idx };
}

/** セルの値を書き換える（列幅などの書式は保ったまま）。 */
function setCell(sheet, row, col, value) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  sheet[addr] = typeof value === 'boolean' ? { t: 'b', v: value } : { t: 's', v: String(value) };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (row > range.e.r || col > range.e.c) {
    range.e.r = Math.max(range.e.r, row);
    range.e.c = Math.max(range.e.c, col);
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }
}

/**
 * 未掲載のスクールを、日次の発見パイプラインと同じ手順で組み立てる。
 * 掲載内容はすべて公式サイト本文が根拠で、Excelの記入内容は使わない。
 */
async function buildNewSchool(row, officialUrl, anthropic, existingIds) {
  const candidate = { name: row.name, website: officialUrl };
  const verification = await verifyCandidate(candidate);
  if (!verification.ok) {
    throw new Error('実在照合に失敗しました（' + verification.reason + '）');
  }

  const genre = row.genreHint || 'programming';
  const ai = await buildDiscoveredSchoolFields(
    candidate,
    verification.pageText,
    anthropic,
    genre,
    verification.thinContent
  );

  const verifiedUrl = verification.verifiedUrl || officialUrl;

  if (ai.price.min_yen === null) {
    const enrichment = await enrichPriceFromDetailPage(
      ai.school_name || row.name,
      verification.html,
      verifiedUrl,
      anthropic
    );
    if (enrichment.price && enrichment.price.min_yen !== null) {
      ai.price = enrichment.price;
      ai.plans = enrichment.plans || [];
      ai.review_flags = [...(ai.review_flags || []), 'price_scope_limited'];
    }
    if (enrichment.detailPageUrl) {
      ai.price_detail_url = enrichment.detailPageUrl;
      ai.price = { ...ai.price, scope: 'detail_page' };
    }
    ai.review_flags = [...(ai.review_flags || []), ...enrichment.flags];
  }

  if (needsAreaEnrichment({ area: ai.area, review_flags: ai.review_flags }, verification.pageText)) {
    const areaResult = await enrichAreaFromDetailPage(
      ai.school_name || row.name,
      verification.html,
      verifiedUrl,
      anthropic
    );
    ai.area = areaResult.area;
    ai.format = areaResult.format;
    ai.area_source = areaResult.areaSource;
    if (areaResult.detailPageUrl) ai.area_detail_url = areaResult.detailPageUrl;
    const flags = new Set((ai.review_flags || []).filter(f => f !== 'format_unconfirmed'));
    for (const flag of areaResult.flags) flags.add(flag);
    ai.review_flags = [...flags];
  }

  const id = buildSchoolId(ai.school_name || row.name, verifiedUrl, existingIds);
  const now = new Date().toISOString();

  return {
    id,
    school_name: ai.school_name || row.name,
    official_name: ai.official_name,
    description: ai.description,
    skill_genre: ai.skill_genre,
    purpose: ai.purpose,
    target_level: ai.target_level,
    career_paths: ai.career_paths,
    price: ai.price,
    plans: ai.plans || [],
    format: ai.format,
    area: ai.area,
    area_source: ai.area_source || 'top_page',
    subsidy_eligible: ai.subsidy_eligible,
    career_support: ai.career_support,
    features: ai.features,
    review_summary: null,
    review_source_urls: [],
    review_flags: ai.review_flags || [],
    ...(ai.price_detail_url ? { price_detail_url: ai.price_detail_url } : {}),
    ...(ai.area_detail_url ? { area_detail_url: ai.area_detail_url } : {}),
    official_url: verifiedUrl,
    cta_url: row.affiliateUrl,
    cta_type: 'affiliate',
    click_tracking_id: buildClickTrackingId(id),
    created_at: now,
    updated_at: now,
    status: 'active',
    // スキーマの許容値は ai-discovered / a8 / manual / mock。
    // 'a8-import' と書いて14件すべてが弾かれたため、テストでも値を固定してある。
    source: 'a8',
    source_note: '提携案件のExcelから取り込み。掲載内容は公式サイト本文から抽出・照合済み',
    verified_url: verifiedUrl,
  };
}

async function main() {
  const workbookPath = findWorkbookPath();
  if (!workbookPath) {
    console.log(path.relative(ROOT, IMPORT_DIR) + ' に .xlsx が見つかりません。');
    console.log('Done. updated=0 added=0 skipped=0');
    return;
  }
  console.log(
    'Reading ' + path.relative(ROOT, workbookPath) + (DRY_RUN ? ' [DRY RUN — 書き込みません]' : '')
  );

  const wb = XLSX.readFile(workbookPath, { cellStyles: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const { rows, idx } = readRows(sheet);

  let targets = rows.filter(r => r.link && r.name && !r.reflected);
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log('対象: ' + targets.length + '行（リンク記入済み・未反映）');
  if (targets.length === 0) {
    console.log('Done. updated=0 added=0 skipped=0');
    return;
  }

  const schools = readSchools();
  const existingIds = new Set(schools.map(s => s.id));
  const byHost = new Map(schools.map(s => [normalizedHost(s.official_url), s]));
  const anthropic = getAnthropicClient();

  let updated = 0;
  let added = 0;
  let failed = 0;
  const reflectedRows = [];

  for (const row of targets) {
    try {
      row.affiliateUrl = extractAffiliateUrl(row.link);
      if (!row.affiliateUrl) throw new Error('リンク欄から提携リンクのURLを取り出せませんでした');

      let officialUrl = row.officialUrl;
      if (!officialUrl) {
        await politeDelay();
        officialUrl = await resolveOfficialUrl(row.affiliateUrl);
        setCell(sheet, row.sheetRow, idx.officialUrl, officialUrl);
        console.log('  ' + row.name + ': 公式サイトURLを特定しました → ' + officialUrl);
      }

      const existing = byHost.get(normalizedHost(officialUrl));
      if (existing) {
        existing.cta_url = row.affiliateUrl;
        existing.cta_type = 'affiliate';
        existing.updated_at = new Date().toISOString();
        console.log('[update] ' + existing.school_name + ' (id=' + existing.id + ')');
        updated += 1;
        reflectedRows.push(row.sheetRow);
        continue;
      }

      await politeDelay();
      const school = await buildNewSchool(row, officialUrl, anthropic, existingIds);

      const { ok, errors } = validateSchool(school);
      if (!ok) throw new Error('掲載条件を満たしません: ' + errors.join(' / '));

      schools.push(school);
      existingIds.add(school.id);
      byHost.set(normalizedHost(school.official_url), school);
      console.log(
        '[add]    ' + school.school_name + ' (id=' + school.id + ') ' +
          'ジャンル=' + school.skill_genre.map(g => GENRE_LABELS[g] || g).join('、')
      );
      added += 1;
      reflectedRows.push(row.sheetRow);
    } catch (err) {
      console.warn('[skip]   ' + row.name + ': processing failed (' + err.message + ')');
      failed += 1;
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 書き込みをスキップしました。');
  } else {
    if (updated + added > 0) writeSchools(schools);
    for (const r of reflectedRows) setCell(sheet, r, idx.reflected, true);
    XLSX.writeFile(wb, workbookPath, { cellStyles: true });
    console.log(
      'Marked ' + reflectedRows.length + ' row(s) as reflected (反映=TRUE) in ' +
        path.basename(workbookPath) + '.'
    );
  }

  console.log(
    'Done. updated=' + updated + ' added=' + added + ' skipped=' + failed +
      (failed ? ' failed=' + failed : '')
  );
  console.log('掲載中(active)は合計' + schools.filter(s => s.status === 'active').length + '件です。');
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, extractAffiliateUrl, parseGenreHint, readRows, findWorkbookPath, setCell };
