'use strict';

/**
 * スキップリスト（data/school-discover-skip.json）のレスキュー。
 *
 * discover-schools.js は、実在照合に失敗した候補をスキップリストに記録し、以降の実行では
 * 除外リストに含めて再試行しない（毎日同じ候補にHTTPリクエストを投げ続けないため）。
 * ただし失敗理由の多くは一時的なもの（サイトの一時停止、DNSの切り替え、ボット検知の
 * 一時的な発動、AIが提示したURLのパス違い）で、時間を置けば通ることがある。
 *
 * このスクリプトは、記録から一定日数（既定30日）経過したスキップ候補だけを取り出し、
 * verifyCandidate() で再検証する。通ったものはスキップリストから外し、次回の
 * discover-schools.js が普通に拾えるようにする（このスクリプト自体は掲載を行わない。
 * 掲載のための構造化は discover-schools.js に一本化しておきたいため）。
 *
 * 実行例:
 *   node reverify-old-skips.js
 *   REVERIFY_AFTER_DAYS=14 REVERIFY_MAX_PER_RUN=50 node reverify-old-skips.js
 */

const path = require('path');
const { verifyCandidate } = require('./lib/school-discovery');
const { SKIP_PATH, readSkipList, writeSkipList } = require('./lib/schools-store');

/** 記録からこの日数が経過したものだけを再検証の対象にする。 */
const REVERIFY_AFTER_DAYS = Number(process.env.REVERIFY_AFTER_DAYS || 30);

/** 1回の実行で再検証する件数の上限（HTTPリクエスト数を抑えるため）。 */
const MAX_PER_RUN = Number(process.env.REVERIFY_MAX_PER_RUN || 20);

/** name_mismatch は「そのサイトにその名前が無い」＝AIの誤りである可能性が高く、時間で解決しにくい。 */
const REASONS_TO_RETRY = (process.env.REVERIFY_REASONS || 'fetch_failed').split(',').map(s => s.trim());

/**
 * 再検証の対象を選ぶ。checkedAt が古い順に並べ、上限まで取る
 * （最後に確認してから最も時間が経っているものを優先する）。
 */
function selectDueEntries(skipList, now = Date.now(), afterDays = REVERIFY_AFTER_DAYS, limit = MAX_PER_RUN) {
  const cutoff = now - afterDays * 24 * 60 * 60 * 1000;

  return Object.values(skipList)
    .filter(entry => {
      if (!entry || !entry.website) return false;
      if (!REASONS_TO_RETRY.includes(entry.reason)) return false;
      const checkedAt = Date.parse(entry.checkedAt || '');
      // checkedAt が壊れている場合は「最も古い」とみなして対象に含める。
      return Number.isNaN(checkedAt) || checkedAt <= cutoff;
    })
    .sort((a, b) => (Date.parse(a.checkedAt || '') || 0) - (Date.parse(b.checkedAt || '') || 0))
    .slice(0, limit);
}

async function main() {
  const skipList = readSkipList();
  const total = Object.keys(skipList).length;
  const due = selectDueEntries(skipList);

  console.log(
    `Re-verifying ${due.length} of ${total} skip-listed candidate(s) ` +
      `(older than ${REVERIFY_AFTER_DAYS} day(s), reason in [${REASONS_TO_RETRY.join(', ')}], max ${MAX_PER_RUN})...`
  );
  if (due.length === 0) return;

  const now = new Date().toISOString();
  let rescued = 0;

  for (const entry of due) {
    const verification = await verifyCandidate({ name: entry.name, website: entry.website });
    if (verification.ok) {
      delete skipList[entry.name];
      rescued += 1;
      console.log(`  RESCUED ${entry.name} <${verification.verifiedUrl}> — removed from skip list.`);
    } else {
      // 失敗理由が変わることもあるため上書きし、checkedAt を更新して次の対象期日を先送りする。
      skipList[entry.name] = { ...entry, reason: verification.reason, checkedAt: now };
      console.log(`  still skipped: ${entry.name} (${verification.reason})`);
    }
  }

  writeSkipList(skipList);
  console.log(
    `Re-verify finished: checked=${due.length}, rescued=${rescued}, remaining=${Object.keys(skipList).length} ` +
      `in ${path.basename(SKIP_PATH)}.` +
      (rescued > 0 ? ' 次回の discover-schools.js が候補として拾い直します。' : '')
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, selectDueEntries, REVERIFY_AFTER_DAYS, MAX_PER_RUN };
