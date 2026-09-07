'use strict';

/**
 * agent-zukan / freelance-anken-zukan の scraper/lib/http.js をそのまま移植し、
 * 本サイト固有の事情を2点だけ足したもの。
 *
 *   1. VERIFY_UA: 候補スクールの公式サイトへの実在照合に限り、実ブラウザに近い
 *      User-Agent を使う。既存サイトでの診断の結果、正直なbot UAだと単純にブロック
 *      されて誤って fetch_failed と判定される実在企業サイトが複数見つかったため
 *      （lib/school-discovery.js でのみ使用）。
 *   2. reviewDelay(): 口コミサイトへのアクセス用。仕様上「1リクエストあたり最低2秒」
 *      が要件のため、politeDelay() とは別に下限を明示した待機を用意する。
 */

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ||
  'SkillupZukanBot/1.0 (+https://github.com/ttr-fjmt/skillup-zukan)';

/**
 * 候補サイトの実在照合専用のUser-Agent。上のUSER_AGENT（ボットとして正直に名乗る）
 * とは目的が異なる。ここでの目的は「実在するのにbotブロックで落ちる」誤判定を避けること。
 */
const VERIFY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIN_DELAY_MS = Number(process.env.SCRAPER_MIN_DELAY_MS || 3000);
const JITTER_MS = Number(process.env.SCRAPER_JITTER_MS || 2000);

/** 口コミサイト巡回時の最低インターバル（仕様: 1リクエストあたり最低2秒）。 */
const REVIEW_MIN_DELAY_MS = Number(process.env.REVIEW_MIN_DELAY_MS || 2000);
const REVIEW_JITTER_MS = Number(process.env.REVIEW_JITTER_MS || 1000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 3〜5秒間隔（既定値）を空けるための、リクエスト間のポライトウェイト。 */
function politeDelay() {
  return sleep(MIN_DELAY_MS + Math.random() * JITTER_MS);
}

/** 口コミサイト向け。最低2秒＋ジッタ。 */
function reviewDelay() {
  return sleep(REVIEW_MIN_DELAY_MS + Math.random() * REVIEW_JITTER_MS);
}

async function fetchText(url, { timeoutMs = 20000, userAgent = USER_AGENT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'ja,en;q=0.5' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 実在照合用（ブラウザ相当のUAで取得する）。 */
function fetchWithVerifyUA(url, { timeoutMs = 15000 } = {}) {
  return fetchText(url, { timeoutMs, userAgent: VERIFY_UA });
}

module.exports = {
  USER_AGENT,
  VERIFY_UA,
  REVIEW_MIN_DELAY_MS,
  sleep,
  politeDelay,
  reviewDelay,
  fetchText,
  fetchWithVerifyUA,
};
