'use strict';

/**
 * 口コミサイトの許可リスト（data/review-sources.json）の読み込みと、アクセス可否の判定。
 *
 * 【重要】このモジュールは fail-closed で設計している。許可リストに載っていないホスト、
 * および enabled/robots_txt_ok/terms_ok/checked_by_human_at が揃っていないホストへの
 * リクエストは、実行時に必ず拒否する。
 *
 * robots.txt と利用規約の確認は人力で行う前提であり、コード側で「たぶん大丈夫」と
 * 判断してよい種類の問題ではないため、既定値は「拒否」でなければならない。
 * lib/robots.js による robots.txt の機械チェックも summarize-reviews.js 側で併用するが、
 * それはあくまで二重の安全網であって、人力確認の代わりにはならない。
 */

const fs = require('fs');
const path = require('path');

const SOURCES_PATH =
  process.env.REVIEW_SOURCES_PATH || path.join(__dirname, '..', '..', 'data', 'review-sources.json');

function loadReviewSources(filePath = SOURCES_PATH) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}

/** ホスト名を、www. の有無を無視して比較できる形に正規化する。 */
function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

/** URLのホストに対応する許可リストのエントリを返す（サブドメインも親ホストの設定に従う）。 */
function findSourceForUrl(url, sources) {
  let host;
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
  return (
    sources.find(s => {
      const allowed = normalizeHost(s.host);
      return host === allowed || host.endsWith(`.${allowed}`);
    }) || null
  );
}

/**
 * 1つのURLを取得してよいかを判定する。
 * 戻り値: { allowed: boolean, reason: string, source: object|null }
 */
function checkUrlAllowed(url, sources = loadReviewSources()) {
  const source = findSourceForUrl(url, sources);
  if (!source) {
    return { allowed: false, reason: 'not_in_allowlist', source: null };
  }
  if (source.enabled !== true) {
    return { allowed: false, reason: 'disabled', source };
  }
  if (source.robots_txt_ok !== true) {
    return { allowed: false, reason: 'robots_txt_not_confirmed', source };
  }
  if (source.terms_ok !== true) {
    return { allowed: false, reason: 'terms_not_confirmed', source };
  }
  if (!source.checked_by_human_at) {
    return { allowed: false, reason: 'human_check_missing', source };
  }
  return { allowed: true, reason: 'ok', source };
}

/** 拒否理由を、実行ログでそのまま読める日本語にする。 */
const REASON_MESSAGES = {
  not_in_allowlist: 'data/review-sources.json の許可リストに無いホストです',
  disabled: 'enabled が false です（人力での robots.txt / 利用規約の確認が未完了）',
  robots_txt_not_confirmed: 'robots_txt_ok が true ではありません（人力確認が未完了）',
  terms_not_confirmed: 'terms_ok が true ではありません（人力確認が未完了）',
  human_check_missing: 'checked_by_human_at が未記入です（人力確認の記録が必要）',
};

function describeReason(reason) {
  return REASON_MESSAGES[reason] || reason;
}

/** enabled かつ人力確認済みのソースだけを返す（実行開始時のサマリ表示に使う）。 */
function enabledSources(sources = loadReviewSources()) {
  return sources.filter(s => checkUrlAllowed(`https://${s.host}/`, sources).allowed);
}

module.exports = {
  SOURCES_PATH,
  loadReviewSources,
  findSourceForUrl,
  checkUrlAllowed,
  describeReason,
  enabledSources,
  normalizeHost,
};
