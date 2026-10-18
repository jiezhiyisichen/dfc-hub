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
 *   UPSTREAM_MAP_REPO    地图仓库（若地图整合包单独发在别的仓库）
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
const MAP_REPO = process.env.UPSTREAM_MAP_REPO || "";
const API = "https://api.github.com";

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

/**
 * 版本通道判定：
 *   -preview / -alpha / -rc  → preview
 *   -beta                   → beta
 *   其它（含纯数字）          → release
 * GitHub 上勾了 Pre-release 但没有约定后缀的，按 preview 处理。
 */
function detectChannel(tag, prerelease) {
  const t = String(tag || "").toLowerCase();
  if (/-preview\b|-alpha\b|-rc\d*\b|-snapshot\b/.test(t)) return "preview";
  if (/-beta\b/.test(t)) return "beta";
  if (prerelease) return "preview";
  return "release";
}

/** 资产归类：.jar → tool，.zip/.7z/.rar → map，其它忽略 */
function detectKind(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".jar")) return "tool";
  if (/\.(zip|7z|rar)$/.test(n)) return "map";
  return "other";
}

function compareVersion(a, b) {
  const pa = stripV(a.tag).split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = stripV(b.tag).split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else {
      const sx = String(x);
      const sy = String(y);
      if (sx !== sy) return sx > sy ? 1 : -1;
    }
  }
  return 0;
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
  const channel = detectChannel(raw.tag_name, raw.prerelease);
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
  if (MAP_REPO && MAP_REPO !== TOOL_REPO) repos.push(MAP_REPO);

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

  const counts = { all: releases.length, release: 0, beta: 0, preview: 0 };
  releases.forEach((r) => {
    counts[r.channel] = (counts[r.channel] || 0) + 1;
  });

  const latestRelease = pickLatest(releases, "release");
  const latestBeta = pickLatest(releases, "beta");
  const latestPreview = pickLatest(releases, "preview");
  const latestMap = pickLatestWithAsset(releases, "map");

  const data = {
    generatedAt: new Date().toISOString(),
    source: {
      tool: TOOL_REPO,
      map: MAP_REPO || TOOL_REPO,
      api: API,
    },
    counts,
    latest: {
      release: latestRelease,
      beta: latestBeta,
      preview: latestPreview,
      map: latestMap,
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

  if (failed && releases.length) {
    warn("部分仓库拉取失败，已用其余数据生成。");
  }
}

main().catch((err) => {
  console.error("[sync][fatal]", err);
  process.exit(1);
});
