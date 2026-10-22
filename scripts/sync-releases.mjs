#!/usr/bin/env node
/**
 * sync-releases.mjs
 * ---------------------------------------------------------------------------
 * 拉取上游工具仓库（以及可选的地图仓库）的全部 GitHub Release，
 * 归一化成站点数据，写入：
 *   assets/data/releases.json   —— 给外部 / 调试用的原始数据
 *   assets/data/releases.js     —— window.__DFC_DATA__，页面直接 <script> 引入
 *
 * 为什么同时生成 .json 和 .js？
 *   .json 是标准数据产物；.js 是对 file:// 本地双击预览的兼容垫片，
 *   避免 fetch() 在 file 协议下被 CORS 拦截导致页面空白。
 *
 * 环境变量：
 *   GITHUB_TOKEN         可选，提高 API 速率限制（GitHub Actions 自动提供）
 *   UPSTREAM_TOOL_REPO   工具仓库，默认 jiezhiyisichen/DFC-Map-Creation-Tool
 *   UPSTREAM_GITEE_REPO  Gitee 镜像仓库，默认 yi-sichen-jiezhi/DFC-Map-Creation-Tool
 *   GITEE_TOKEN          可选，Gitee 私人令牌（公开仓库匿名也能读，只是额度低）
 *   GITEE_MIRROR=off     设为 off 可完全跳过 Gitee（离线 / 只想用 GitHub 时）
 *
 * 双源策略：
 *   · GitHub 是**主源**：版本列表、更新说明、文件体积都来自它；
 *   · Gitee 是**镜像**：按 tag 匹配，只把「同名资产的下载地址」与「发布页地址」挂到主源条目上
 *     （asset.mirrors / release.mirrors）。Gitee 自动生成的源码 zip / tar.gz 一律忽略；
 *   · 只在 Gitee 上发过的版本也会收进来（说明用 Gitee 的 body），只是没有 GitHub 链接；
 *   · 任意一边挂掉都不影响另一边，**绝不因为一方失败就让站点变空**。
 * ---------------------------------------------------------------------------
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "assets/data");
const OUT_JSON = resolve(OUT_DIR, "releases.json");
const OUT_JS = resolve(OUT_DIR, "releases.js");

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const TOOL_REPO = process.env.UPSTREAM_TOOL_REPO || "jiezhiyisichen/DFC-Map-Creation-Tool";
const API = "https://api.github.com";

const GITEE_REPO = process.env.UPSTREAM_GITEE_REPO || "yi-sichen-jiezhi/DFC-Map-Creation-Tool";
const GITEE_API = "https://gitee.com/api/v5";
const GITEE_TOKEN = process.env.GITEE_TOKEN || "";
const GITEE_ENABLED = String(process.env.GITEE_MIRROR || "").toLowerCase() !== "off";

const MAX_NOTES = 6000;

/* -------------------------------------------------------------- utilities */

function log(...args) {
  console.log("[sync]", ...args);
}

function warn(...args) {
  console.warn("[sync][warn]", ...args);
}

async function api(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "dfc-hub-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${path}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

/** 分页拉取全部 release（最多 5 页 / 500 条，足够用） */
async function fetchAllReleases(repo) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await api(`/repos/${repo}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

function stripV(tag) {
  return String(tag || "").replace(/^v/i, "").trim();
}

/** 通道中文名，日志用 */
const CHANNEL_NAMES = { release: "正式版", beta: "测试版", preview: "预览版" };

/* ------------------------------------------------------------- Gitee 镜像
 * Gitee 的 OpenAPI v5 与 GitHub 不同：
 *   · 公开仓库可以匿名读，但有额度；有私人令牌时把 access_token 挂在 query 上；
 *   · **没有内容时返回 200 + 字面量 null**（不是 404、也不是 []），必须自己兜住；
 *   · 资产里的 size 经常是 null，所以体积一律优先用 GitHub 那边的。
 * ------------------------------------------------------------------------ */

async function giteeApi(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = GITEE_API + path + (GITEE_TOKEN ? sep + "access_token=" + GITEE_TOKEN : "");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "dfc-hub-sync" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("Gitee API " + res.status + " " + res.statusText + " for " + path + "\n" + body.slice(0, 300));
  }
  const data = await res.json();
  return data == null ? [] : data;
}

/** 拉 Gitee 的全部发行版（分页，最多 500 条） */
async function fetchGiteeReleases(repo) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await giteeApi("/repos/" + repo + "/releases?per_page=100&page=" + page);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** 把 Gitee 的发行版转成 GitHub 的形状，直接复用 normalizeRelease */
function giteeAsGithubShape(raw, repo) {
  return {
    tag_name: raw.tag_name,
    name: raw.name || raw.tag_name,
    body: raw.body || "",
    prerelease: !!raw.prerelease,
    draft: false,
    published_at: raw.created_at,
    created_at: raw.created_at,
    html_url: raw.html_url || "https://gitee.com/" + repo + "/releases/tag/" + raw.tag_name,
    assets: (raw.assets || []).map((a) => ({
      name: a.name,
      size: a.size || 0,
      download_count: 0,
      updated_at: a.updated_at || raw.created_at,
      browser_download_url: a.browser_download_url,
    })),
  };
}

function tagKey(tag) {
  return String(tag || "").replace(/^v/i, "").trim().toLowerCase();
}

/**
 * 把 Gitee 的镜像信息挂到主列表上。
 *
 * 原则是**只增不改**：主源已有的 url / notes / size 一律不动，Gitee 只贡献"备用地址"。
 * 这样即使 Gitee 那边体积缺失、说明格式不同，也不会污染 GitHub 的数据。
 */
function mergeGiteeMirrors(releases, giteeRawList, giteeRepo) {
  const byTag = new Map();
  for (const raw of giteeRawList) {
    if (!raw || raw.draft) continue;
    byTag.set(tagKey(raw.tag_name), raw);
  }

  let mergedAssets = 0;
  for (const rel of releases) {
    const key = tagKey(rel.tag);
    const raw = byTag.get(key);
    if (!raw) continue;
    byTag.delete(key);

    rel.mirrors = rel.mirrors || {};
    rel.mirrors.gitee = {
      url: raw.html_url || "https://gitee.com/" + giteeRepo + "/releases/tag/" + raw.tag_name,
      tag: raw.tag_name,
    };

    const giteeAssets = (raw.assets || []).filter((a) => detectKind(a.name) !== "other");
    for (const asset of rel.assets) {
      const ga = giteeAssets.find((a) => a.name === asset.name);
      if (!ga || !ga.browser_download_url) continue;
      asset.mirrors = asset.mirrors || [];
      if (!asset.mirrors.some((m) => m.host === "gitee")) {
        asset.mirrors.push({ host: "gitee", url: ga.browser_download_url });
      }
      mergedAssets++;
    }
  }

  // 只在 Gitee 上有的版本：也收进来，避免"某个版本只在一边发过"就漏掉
  const leftovers = [];
  for (const raw of byTag.values()) {
    const normalized = normalizeRelease(giteeAsGithubShape(raw, giteeRepo), giteeRepo);
    if (!normalized.assets.length) continue;
    normalized.mirrors = { gitee: { url: normalized.url, tag: raw.tag_name } };
    leftovers.push(normalized);
  }

  return { mergedAssets, leftovers };
}

/**
 * 版本通道判定（只管「正式 / 测试 / 预览」，紧急修复不在这里）：
 *   -preview / -alpha / -rc  → preview
 *   -beta                   → beta
 *   其它（含纯数字）          → release
 *
 * Tag 没写通道后缀时，再退一步看 Release 标题末尾的显式措辞，
 * 例如「v3.9.1 紧急修复版 + 测试版」这种只把通道写在标题里的情况。
 * 只认标题结尾的 测试版 / beta / 预览版 / preview，避免正文里随口提到就被带偏。
 * GitHub 上勾了 Pre-release 但仍无任何线索的，按 preview 处理。
 */
function detectChannel(tag, prerelease, name) {
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
 * 紧急修复版判定 —— 与通道「正交」，不参与 channel 计算。
 * 所以一个版本可以同时是「紧急修复版 + 测试版」或「紧急修复版 + 正式版」。
 *
 * 识别来源（任意一条命中即算紧急修复）：
 *   1) Tag 里的 hotfix / hot-fix / hot_fix / urgentfix / emergencyfix，或 -fix 收尾
 *      例：v3.9.1-hotfix、v3.9.1-hotfix-beta、v3.9.1-beta-hotfix、v3.9.1-fix
 *   2) Release 标题里出现「紧急修复」或 hotfix
 *      例：v3.9.1 紧急修复版 + 测试版
 *   3) Release 说明前 200 字出现「紧急修复版」或 hotfix（只认这个明确措辞，
 *      避免「修复了 xx 崩溃」这类普通更新被误判）
 */
function detectHotfix(tag, name, body) {
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
 * 重大更新判定 —— 与通道「正交」，但只允许挂在正式版上。
 * 也就是说：v3.9.1-major（正式版）会打标；v3.9.1-major-beta（测试版）不会。
 *
 * 识别来源（任意一条命中即算重大更新）：
 *   1) Tag 里的 major（v3.9.1-major、v3.9.1-major-release）
 *   2) Release 标题里出现「重大更新」或 major
 *   3) Release 说明前 200 字出现「重大更新」
 */
function detectMajor(tag, name, body, channel) {
  if (channel !== "release") return false;

  const t = String(tag || "").toLowerCase();
  if (/(^|[^a-z])major([^a-z]|$)/.test(t)) return true;

  const n = String(name || "");
  if (/重大更新|重大版本/.test(n) || /(^|[^a-z])major([^a-z]|$)/i.test(n)) return true;

  const lead = String(body || "").slice(0, 200);
  if (/重大更新|重大版本/.test(lead)) return true;

  return false;
}

/** 资产归类：只收 .jar → tool。
 *  地图整合包已改为走 123 云盘，Release 里的 zip 一律忽略。 */
function detectKind(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".jar")) return "tool";
  return "other";
}

/**
 * 版本比较。
 *
 * 【为什么不能直接按 [.-+] 切分】"3.9.1-beta" 切开是 [3,9,1,beta]，"3.9-beta" 是 [3,9,beta]，
 * 第三段变成 "1" 与 "beta" 的**数字 vs 字符串**比较 —— 字符串比较里 "1" < "beta"，
 * 于是 3.9.1-beta 反而排在 3.9-beta 前面，站点上的"最新测试版"就永远指着旧的那个。
 *
 * 所以先把「数字核心」和「预发布标签」拆开：核心逐段按数字比，核心相同再比有没有标签
 * （有标签的更低，这是 semver 的规矩：3.9.1 > 3.9.1-beta）。
 */
function compareVersion(a, b) {
  const va = splitVersion(a.tag);
  const vb = splitVersion(b.tag);
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i++) {
    const x = va.core[i] === undefined ? 0 : va.core[i];
    const y = vb.core[i] === undefined ? 0 : vb.core[i];
    if (x !== y) return x - y;
  }
  if (va.pre === vb.pre) return 0;
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  return va.pre > vb.pre ? 1 : -1;
}

/** "v3.9.1-beta.2" -> { core: [3,9,1], pre: "beta.2" } */
function splitVersion(tag) {
  const raw = stripV(tag);
  const dash = raw.indexOf("-");
  const coreStr = dash >= 0 ? raw.slice(0, dash) : raw;
  const pre = dash >= 0 ? raw.slice(dash + 1).toLowerCase() : "";
  const core = coreStr.split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
  return { core, pre };
}

/* --------------------------------------------------- markdown → html (lite)
 * 只支持 Release 说明里实际会出现的语法：标题、列表、粗体、行内代码、
 * 链接、引用、代码块、表格。先整体转义，再做替换，杜绝注入。
 * ------------------------------------------------------------------------ */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text) {
  let s = text;
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  // 裸链接（<https://...> 形式）
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function mdToHtml(markdown) {
  if (!markdown) return "";
  const src = String(markdown).slice(0, MAX_NOTES).replace(/\r\n/g, "\n");

  /* 上游说明里有大量「悬挂缩进」写法（列表项下换行后缩进两格续写）。
     先把这些续行接回上一行，否则每行都会变成一个独立段落。 */
  const lines = [];
  let fence = false;
  for (const raw of src.split("\n")) {
    const isFence = /^```/.test(raw.trim());
    if (isFence) fence = !fence;
    const isCont =
      !fence &&
      !isFence &&
      /^\s{2,}\S/.test(raw) &&
      !/^\s{2,}[-*+]\s/.test(raw) &&
      !/^\s*\|/.test(raw) &&
      lines.length > 0 &&
      lines[lines.length - 1].trim() !== "";
    if (isCont) {
      lines[lines.length - 1] = lines[lines.length - 1].trimEnd() + " " + raw.trim();
    } else {
      lines.push(raw);
    }
  }

  const out = [];
  let i = 0;
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // 代码块
    if (/^```/.test(line.trim())) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(escapeHtml(lines[i]));
        i++;
      }
      i++;
      out.push(`<pre class="notes-pre"><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // 表格
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeList();
      const parseRow = (l) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = Math.min(h[1].length + 2, 6);
      out.push(`<h${level}>${inline(escapeHtml(h[2]))}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(inline(escapeHtml(lines[i].replace(/^>\s?/, ""))));
        i++;
      }
      out.push(`<blockquote>${buf.join("<br>")}</blockquote>`);
      continue;
    }

    // 列表
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    const oli = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (li || oli) {
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inline(escapeHtml((li || oli)[1]))}</li>`);
      i++;
      continue;
    }

    // 普通段落
    closeList();
    out.push(`<p>${inline(escapeHtml(line))}</p>`);
    i++;
  }

  closeList();
  return out.join("\n");
}

function mdToText(markdown) {
  if (!markdown) return "";
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`|~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/* ------------------------------------------------------------------ shape */

function normalizeRelease(raw, repo) {
  const channel = detectChannel(raw.tag_name, raw.prerelease, raw.name);
  const hotfix = detectHotfix(raw.tag_name, raw.name, raw.body);
  const major = detectMajor(raw.tag_name, raw.name, raw.body, channel);
  const assets = (raw.assets || [])
    .map((a) => ({
      name: a.name,
      kind: detectKind(a.name),
      size: a.size || 0,
      downloads: a.download_count || 0,
      url: a.browser_download_url,
      updatedAt: a.updated_at,
    }))
    .filter((a) => a.kind !== "other");

  const notes = raw.body || "";

  return {
    id: `${repo}#${raw.tag_name}`,
    repo,
    tag: raw.tag_name,
    version: stripV(raw.tag_name),
    channel,
    /* 紧急修复标记：独立于 channel，可与任意通道叠加 */
    hotfix,
    /* 重大更新标记：独立于 channel，但只在正式版上生效 */
    major,
    name: raw.name || raw.tag_name,
    publishedAt: raw.published_at || raw.created_at,
    url: raw.html_url,
    prerelease: !!raw.prerelease,
    draft: !!raw.draft,
    assets,
    notes,
    notesText: mdToText(notes),
    notesHtml: mdToHtml(notes),
  };
}

function pickLatest(releases, channel) {
  const pool = releases.filter((r) => r.channel === channel && !r.draft);
  pool.sort(compareVersion);
  return pool.length ? pool[pool.length - 1] : null;
}

function pickLatestWithAsset(releases, kind) {
  const pool = releases.filter(
    (r) => !r.draft && (r.assets || []).some((a) => a.kind === kind)
  );
  if (!pool.length) return null;
  const stable = pool.filter((r) => r.channel === "release").sort(compareVersion);
  if (stable.length) return stable[stable.length - 1];
  const sorted = pool.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return sorted[0];
}

/* ------------------------------------------------------------------- main */

async function main() {
  const repos = [TOOL_REPO];

  let releases = [];
  let failed = false;

  for (const repo of repos) {
    try {
      const raw = await fetchAllReleases(repo);
      log(`${repo}: ${raw.length} 个 release`);
      for (const item of raw) {
        if (item.draft) continue;
        const normalized = normalizeRelease(item, repo);
        if (!normalized.assets.length) continue;
        releases.push(normalized);
      }
    } catch (err) {
      failed = true;
      warn(`拉取 ${repo} 失败：${err.message}`);
    }
  }

  // ---------------- Gitee 镜像（可选，失败不影响主流程） ----------------
  const giteeInfo = {
    repo: GITEE_REPO,
    api: GITEE_API,
    enabled: GITEE_ENABLED,
    ok: false,
    mergedAssets: 0,
    extraReleases: 0,
    primary: false,
  };

  if (GITEE_ENABLED) {
    try {
      const giteeRaw = await fetchGiteeReleases(GITEE_REPO);
      log(`gitee ${GITEE_REPO}: ${giteeRaw.length} 个发行版`);

      if (releases.length) {
        const { mergedAssets, leftovers } = mergeGiteeMirrors(releases, giteeRaw, GITEE_REPO);
        releases.push(...leftovers);
        giteeInfo.mergedAssets = mergedAssets;
        giteeInfo.extraReleases = leftovers.length;
        log(
          `gitee 镜像：${mergedAssets} 个资产挂上备用下载地址` +
            (leftovers.length ? `，另有 ${leftovers.length} 个版本只在 Gitee` : "")
        );
      } else {
        // GitHub 完全不可用：直接用 Gitee 撑起整站，避免页面空白
        for (const raw of giteeRaw) {
          if (!raw || raw.draft) continue;
          const normalized = normalizeRelease(giteeAsGithubShape(raw, GITEE_REPO), GITEE_REPO);
          if (!normalized.assets.length) continue;
          normalized.mirrors = { gitee: { url: normalized.url, tag: raw.tag_name } };
          releases.push(normalized);
        }
        giteeInfo.primary = true;
        if (releases.length) {
          warn("GitHub 不可用，本次已改用 Gitee 作为主数据源。");
        }
      }
      giteeInfo.ok = true;
    } catch (err) {
      warn(`拉取 Gitee ${GITEE_REPO} 失败（不影响 GitHub 数据）：${err.message}`);
    }
  } else {
    log("GITEE_MIRROR=off，跳过 Gitee 镜像。");
  }

  if (!releases.length) {
    // 兜底：保留上一次生成的数据，不让站点变空
    try {
      const prev = await readFile(OUT_JSON, "utf8");
      warn("本次未获取到任何 release，保留已有数据文件。");
      log(`现有数据长度 ${prev.length} 字节`);
      process.exit(0);
    } catch {
      console.error("[sync][fatal] 无法获取 release 且没有可用的历史数据。");
      process.exit(1);
    }
  }

  // 去重 + 排序（发布时间倒序，其次版本号）
  const seen = new Set();
  releases = releases.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  releases.sort((a, b) => {
    const d = new Date(b.publishedAt) - new Date(a.publishedAt);
    return d !== 0 ? d : compareVersion(b, a);
  });

  const counts = { all: releases.length, release: 0, beta: 0, preview: 0, hotfix: 0, major: 0 };
  releases.forEach((r) => {
    counts[r.channel] = (counts[r.channel] || 0) + 1;
    if (r.hotfix) counts.hotfix++;
    if (r.major) counts.major++;
  });

  const latestRelease = pickLatest(releases, "release");
  const latestBeta = pickLatest(releases, "beta");
  const latestPreview = pickLatest(releases, "preview");
  const hotfixReleases = releases
    .filter((r) => r.hotfix && !r.draft)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const latestHotfix = hotfixReleases.length ? hotfixReleases[0] : null;
  const latestMajor = latestRelease && latestRelease.major ? latestRelease : null;

  const data = {
    generatedAt: new Date().toISOString(),
    source: {
      tool: TOOL_REPO,
      api: API,
      gitee: giteeInfo,
    },
    counts,
    latest: {
      release: latestRelease,
      beta: latestBeta,
      preview: latestPreview,
      hotfix: latestHotfix,
      major: latestMajor,
      tool: pickLatestWithAsset(releases, "tool"),
    },
    releases,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  await writeFile(OUT_JSON, json + "\n", "utf8");

  const safeJson = json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const js =
    "/* AUTO-GENERATED by scripts/sync-releases.mjs — do not edit by hand. */\n" +
    `window.__DFC_DATA__ = ${safeJson};\n`;
  await writeFile(OUT_JS, js, "utf8");

  log(`已写入 ${OUT_JSON}`);
  log(`已写入 ${OUT_JS}`);
  log(
    `最新正式版 ${latestRelease ? latestRelease.tag : "—"} · 共 ${releases.length} 个版本` +
      `（正式 ${counts.release} / 测试 ${counts.beta} / 预览 ${counts.preview}）`
  );
  /* 紧急修复版是叠加属性，单独打一行，方便确认新标签有没有被认出来 */
  if (counts.hotfix) {
    const combos = hotfixReleases
      .map((r) => `${r.tag} = 紧急修复+${CHANNEL_NAMES[r.channel] || r.channel}`)
      .join("，");
    log(`识别到 ${counts.hotfix} 个紧急修复版：${combos}`);
  } else {
    log("暂无紧急修复版标记（Tag / 标题 / 说明里出现 hotfix 或「紧急修复」即自动识别）");
  }
  /* 重大更新同理，只认正式版 */
  if (counts.major) {
    const majors = releases.filter((r) => r.major).map((r) => r.tag).join("，");
    log(`识别到 ${counts.major} 个重大更新版本：${majors}`);
  } else {
    log("暂无重大更新标记（正式版的 Tag / 标题 / 说明里出现 major 或「重大更新」即自动识别）");
  }
  if (giteeInfo.ok) {
    log(
      `Gitee 镜像已合并：${giteeInfo.mergedAssets} 个资产有备用地址` +
        (giteeInfo.extraReleases ? `，额外 ${giteeInfo.extraReleases} 个版本来自 Gitee` : "")
    );
  } else if (GITEE_ENABLED) {
    warn("Gitee 镜像不可用，页面只会提供 GitHub 线路。");
  }

  if (failed && releases.length) {
    warn("部分仓库拉取失败，已用其余数据生成。");
  }
}

main().catch((err) => {
  console.error("[sync][fatal]", err);
  process.exit(1);
});
