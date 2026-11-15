/**
 * release-labels.mjs — 版本标签判定（本体与附属共用同一套规则）
 *
 * 两个同步脚本（sync-releases.mjs / sync-mods.mjs）都用这里的函数，
 * 避免「本体认得出来、附属认不出来」这种两边规则漂移的问题。
 *
 * 四类标记互相独立：
 *   channel  正式版 / 测试版 / 预览版 —— 三选一，决定卡片主色
 *   hotfix   紧急修复  —— 叠加，可与任意通道组合
 *   major    重大更新  —— 叠加，但只允许正式版
 *   unstable 不稳定    —— 叠加，实验性 / 可能崩的版本
 */

export const CHANNEL_NAMES = { release: "正式版", beta: "测试版", preview: "预览版" };

/**
 * 版本通道判定：
 *   -preview / -alpha / -rc / -snapshot → preview
 *   -beta                               → beta
 *   其它（含纯数字）                     → release
 *
 * Tag 没写通道后缀时，再退一步看标题末尾的显式措辞，
 * 例如「v3.9.1 紧急修复版 + 测试版」这种只把通道写在标题里的情况。
 * 只认标题结尾的 测试版 / beta / 预览版 / preview，避免正文里随口提到就被带偏。
 * GitHub 上勾了 Pre-release 但仍无任何线索的，按 preview 处理。
 */
export function detectChannel(tag, prerelease, name) {
  const t = String(tag || "").toLowerCase();
  if (/-preview\b|-alpha\b|-rc\d*\b|-snapshot\b/.test(t)) return "preview";
  if (/-beta\b/.test(t)) return "beta";

  const n = String(name || "").trim();
  if (/(^|[+＋·、,，\s])(测试版|beta)\s*$/i.test(n)) return "beta";
  if (/(^|[+＋·、,，\s])(预览版|preview|alpha|rc)\s*$/i.test(n)) return "preview";

  if (prerelease) return "preview";
  return "release";
}

/**
 * 紧急修复版判定 —— 与通道正交。
 * 识别来源（任意一条命中即算）：
 *   1) Tag：hotfix / hot-fix / hot_fix / urgentfix / emergencyfix，或 -fix 收尾
 *   2) 标题含「紧急修复」或 hotfix
 *   3) 说明前 200 字含「紧急修复版」或 hotfix
 */
export function detectHotfix(tag, name, body) {
  const t = String(tag || "").toLowerCase();
  const n = String(name || "").toLowerCase();

  if (/(^|[^a-z])(hot[-_]?fix|urgent[-_]?fix|emergency[-_]?fix)([^a-z]|$)/.test(t)) return true;
  if (/(^|[^a-z])fix([^a-z]|$)/.test(t)) return true;
  if (/hot\s*fix|紧急修复/.test(n)) return true;

  const lead = String(body || "").slice(0, 200).toLowerCase();
  if (/紧急修复版|hotfix/.test(lead)) return true;

  return false;
}

/**
 * 重大更新判定 —— 与通道正交，但只允许挂在正式版上。
 * v3.9.1-major（正式版）打标；v3.9.1-major-beta（测试版）不打。
 * 识别来源（任意一条命中即算）：
 *   1) Tag 含 major
 *   2) 标题含「重大更新」/「重大版本」/ major
 *   3) 说明前 200 字含「重大更新」/「重大版本」
 */
export function detectMajor(tag, name, body, channel) {
  if (channel !== "release") return false;

  const t = String(tag || "").toLowerCase();
  if (/(^|[^a-z])major([^a-z]|$)/.test(t)) return true;

  const n = String(name || "");
  if (/重大更新|重大版本/.test(n) || /(^|[^a-z])major([^a-z]|$)/i.test(n)) return true;

  const lead = String(body || "").slice(0, 200);
  if (/重大更新|重大版本/.test(lead)) return true;

  return false;
}

/**
 * 不稳定版判定 —— 叠加属性，任何通道都能挂。
 * 用来标「能跑但可能崩 / 还在改」的实验构建，官方不建议日常玩。
 *
 * 识别来源（任意一条命中即算）：
 *   1) Tag：unstable / exp / experimental / nightly / dev
 *      例：v4.0-unstable、v4.0-experimental、v4.0-beta-dev
 *   2) 标题含「不稳定」/「实验版」/「实验性」/ unstable / experimental
 *   3) 说明前 200 字含「不稳定版」/「实验性版本」/ unstable
 *
 * 注意：-alpha / -snapshot 已经算「预览版」通道，这里不重复认，
 * 但如果作者同时写了 -unstable，两个标会一起出现（通道 + 性质）。
 */
export function detectUnstable(tag, name, body) {
  const t = String(tag || "").toLowerCase();
  if (/(^|[^a-z])(unstable|nightly|experimental|exp)([^a-z]|$)/.test(t)) return true;
  if (/(^|[^a-z])dev([^a-z]|$)/.test(t)) return true;

  const n = String(name || "");
  if (/不稳定|实验版|实验性/.test(n)) return true;
  if (/(^|[^a-z])(unstable|experimental)([^a-z]|$)/i.test(n)) return true;

  const lead = String(body || "").slice(0, 200);
  if (/不稳定版|实验性版本/.test(lead)) return true;

  return false;
}

/** 一次性算出四个标记，调用方少写点 */
export function classify(raw, channelHint) {
  const tag = raw.tag || raw.tag_name || "";
  const name = raw.name || "";
  const body = raw.body || "";
  const channel = channelHint || detectChannel(tag, !!raw.prerelease, name);
  return {
    channel,
    hotfix: detectHotfix(tag, name, body),
    major: detectMajor(tag, name, body, channel),
    unstable: detectUnstable(tag, name, body),
  };
}
