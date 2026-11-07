#!/usr/bin/env node
/**
 * sync-mods.mjs — 拉取「二创 Mod」的发行版，生成 assets/data/mods.json / mods.js
 *
 * 数据源写在 data/mods.json 里，每条支持：
 *   platform: "gitee" | "github"
 *   repo:     "owner/repo"
 *
 * 环境变量：
 *   GITHUB_TOKEN  可选，提高 GitHub API 额度（Actions 自动提供）
 *   GITEE_TOKEN   可选，提高 Gitee API 额度
 *   MODS_LIMIT    每个 mod 最多取多少个版本，默认 30
 *
 * 设计取舍：
 *   · 只收真实附件；Gitee 会自动挂上 "1.0.0.zip / .tar.gz" 这种源码包（URL 含 /archive/refs/），一律丢掉。
 *   · 单个 mod 拉取失败不影响其它 mod，失败信息写进数据里，页面会显示出来而不是白屏。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = resolve(ROOT, "data", "mods.json");
const OUT_DIR = resolve(ROOT, "assets", "data");
const OUT_JSON = resolve(OUT_DIR, "mods.json");
const OUT_JS = resolve(OUT_DIR, "mods.js");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITEE_TOKEN = process.env.GITEE_TOKEN || "";
const LIMIT = Number(process.env.MODS_LIMIT || 30);

const API = {
  github: "https://api.github.com",
  gitee: "https://gitee.com/api/v5",
};

function log(msg) {
  console.log(`[mods] ${msg}`);
}

function warn(msg) {
  console.warn(`[mods][warn] ${msg}`);
}

/* ------------------------------------------------------------------ utils */

function stripV(tag) {
  return String(tag || "").replace(/^v/i, "").trim();
}

function detectChannel(tag, prerelease) {
  const t = String(tag || "").toLowerCase();
  if (/-preview\b|-alpha\b|-rc\d*\b|-snapshot\b/.test(t)) return "preview";
  if (/-beta\b/.test(t)) return "beta";
  if (prerelease) return "preview";
  return "release";
}

/** 附件归类；Gitee 自动生成的源码包要单独排除
 *  另外 -sources / -javadoc / -dev 这类 jar 不是能直接丢进 mods/ 的产物，也不收。 */
function detectKind(name, url) {
  const n = String(name || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  if (u.includes("/archive/refs/") || u.includes("/repository/archive/")) return "other";
  if (/-sources\.jar$|-javadoc\.jar$|-dev\.jar$|-sources-\w+\.jar$/.test(n)) return "other";
  if (n.endsWith(".jar")) return "mod";
  /* 源码包不是给玩家下的整合包：xxx-src.zip / xxx-src_3b726a77.zip / 修改后源码.zip */
  if (/\.(zip|7z|rar)$/.test(n)) {
    if (/(^|[-_.])(src|source|sources)([-_.]|$)/.test(n) || n.includes("源码")) return "other";
    return "pack";
  }
  return "other";
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mdToText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 1200);
}

function mdToHtml(md) {
  const src = String(md || "").slice(0, 4000);
  if (!src.trim()) return "";
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false;

  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }
    const li = line.match(/^[-*+]\s+(.*)$/);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + inline(li[1]) + "</li>");
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      out.push("<h4>" + inline(h[1]) + "</h4>");
      continue;
    }
    out.push("<p>" + inline(line) + "</p>");
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

async function fetchJson(url, headers) {
  const res = await fetch(url, {
    headers: Object.assign({ "User-Agent": "dfc-hub-sync", Accept: "application/json" }, headers || {}),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  // Gitee 在没内容时会返回字面量 null，这里统一兜成数组
  if (!text || text === "null") return [];
  return JSON.parse(text);
}

/* --------------------------------------------------------------- fetching */

async function fetchGithub(repo) {
  const headers = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
  const url = `${API.github}/repos/${repo}/releases?per_page=${LIMIT}`;
  return fetchJson(url, headers);
}

async function fetchGitee(repo) {
  const q = new URLSearchParams({ per_page: String(LIMIT) });
  if (GITEE_TOKEN) q.set("access_token", GITEE_TOKEN);
  const url = `${API.gitee}/repos/${repo}/releases?${q.toString()}`;
  return fetchJson(url);
}

/** 仓库元信息：开源许可、官网、默认分支。
 *  拿不到就算了，绝不能因为它让整个 mod 变成 error。 */
async function fetchRepoMeta(platform, repo) {
  try {
    if (platform === "gitee") {
      const d = await fetchJson(`${API.gitee}/repos/${repo}`);
      return {
        license: (d && d.license) || "",
        homepage: (d && d.homepage) || "",
        branch: (d && d.default_branch) || "master",
      };
    }
    const headers = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
    const d = await fetchJson(`${API.github}/repos/${repo}`, headers);
    return {
      license: (d && d.license && (d.license.spdx_id || d.license.name)) || "",
      homepage: (d && d.homepage) || "",
      branch: (d && d.default_branch) || "master",
    };
  } catch (err) {
    warn(`仓库信息读取失败（不影响版本列表）：${err.message || err}`);
    return {};
  }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "dfc-hub-sync" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* 平台不一定填了 license 字段（Gitee 经常是 null），所以还要读 LICENSE 正文自己认。
   顺序很重要：GPL 的正文里会同时出现 "Lesser"/"Affero" 字样，长名字要先判。 */
const LICENSE_SIGNS = [
  { id: "AGPL-3.0", re: /gnu\s+affero\s+general\s+public\s+license/i },
  { id: "LGPL-3.0", re: /gnu\s+(lesser|library)\s+general\s+public\s+license[\s\S]{0,120}?version\s*3/i },
  { id: "LGPL-2.1", re: /gnu\s+(lesser|library)\s+general\s+public\s+license[\s\S]{0,120}?version\s*2\.1/i },
  { id: "GPL-3.0", re: /gnu\s+general\s+public\s+license[\s\S]{0,120}?version\s*3/i },
  { id: "GPL-2.0", re: /gnu\s+general\s+public\s+license[\s\S]{0,120}?version\s*2/i },
  { id: "MPL-2.0", re: /mozilla\s+public\s+license[\s\S]{0,40}?2\.0|mozilla\s*公共许可协议\s*2\.0/i },
  { id: "Apache-2.0", re: /apache\s+license[\s\S]{0,80}?version\s*2\.0/i },
  { id: "CC-BY-4.0", re: /creative\s+commons\s+attribution[\s\S]{0,80}?4\.0/i },
  { id: "Unlicense", re: /free\s+and\s+unencumbered\s+software\s+released\s+into\s+the\s+public\s+domain/i },
  { id: "MIT", re: /mit\s+license|permission\s+is\s+hereby\s+granted,\s*free\s+of\s+charge/i },
  { id: "BSD-3-Clause", re: /neither\s+the\s+name\s+of/i },
  { id: "BSD-2-Clause", re: /redistribution\s+and\s+use\s+in\s+source\s+and\s+binary\s+forms/i },
];

function detectLicense(text) {
  if (!text) return "";
  const head = text.slice(0, 6000);
  for (const s of LICENSE_SIGNS) {
    if (s.re.test(head)) return s.id;
  }
  /* 认不出来又确实是自定义协议：截一行标题当名字，比写「未知」有用 */
  const firstLine = head
    .split(/\r?\n/)
    .map((l) => l.replace(/^[#\s*]+/, "").trim())
    .find((l) => l.length > 3);
  return firstLine ? firstLine.slice(0, 40) : "";
}

/** 读仓库里的 LICENSE 正文（Gitee / GitHub 都能读 raw） */
async function fetchLicenseText(platform, repo, branch) {
  const names = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING", "COPYING.md"];
  for (const name of names) {
    const url =
      platform === "gitee"
        ? `https://gitee.com/${repo}/raw/${branch || "master"}/${name}`
        : `https://raw.githubusercontent.com/${repo}/${branch || "master"}/${name}`;
    try {
      const text = await fetchText(url);
      if (text && text.trim().length > 40 && !/^\s*404/i.test(text)) return text;
    } catch (err) {
      /* 该文件名不存在，试下一个 */
    }
  }
  return "";
}

/* -------------------------------------------------------------- normalize */

function normalizeRelease(raw, mod, ignoreRes) {
  const tag = raw.tag_name || raw.name || "unknown";
  const platform = mod.platform;
  const htmlUrl =
    raw.html_url ||
    (platform === "gitee"
      ? `https://gitee.com/${mod.repo}/releases/tag/${encodeURIComponent(tag)}`
      : `https://github.com/${mod.repo}/releases/tag/${encodeURIComponent(tag)}`);

  const assets = (raw.assets || [])
    .map((a) => {
      const kind = detectKind(a.name, a.browser_download_url);
      return {
        name: a.name,
        kind,
        size: a.size || 0,
        /* GitHub 给 download_count，Gitee 的接口压根没有这个字段 —— 用 null 表示「不知道」，
           别和「确实 0 次」混为一谈 */
        downloads: typeof a.download_count === "number" ? a.download_count : null,
        url: a.browser_download_url,
        mirror: null,
      };
    })
    .filter((a) => a.kind !== "other" && a.url && !ignoreRes.some((re) => re.test(a.name)));

  const body = raw.body || "";
  const counted = assets.filter((a) => typeof a.downloads === "number");

  return {
    id: `${mod.id}#${tag}`,
    modId: mod.id,
    platform,
    repo: mod.repo,
    tag,
    version: stripV(tag),
    channel: detectChannel(tag, !!raw.prerelease),
    name: raw.name || tag,
    publishedAt: raw.published_at || raw.created_at || null,
    url: htmlUrl,
    prerelease: !!raw.prerelease,
    draft: !!raw.draft,
    assets,
    /* 该版本合计下载：平台给了数字才算，全都没给就是 null */
    downloads: counted.length ? counted.reduce((n, a) => n + a.downloads, 0) : null,
    notesText: mdToText(body),
    notesHtml: mdToHtml(body),
  };
}

/** 汇总一个 mod 的下载次数：不把 null 当 0 加 */
function sumDownloads(list) {
  const nums = list.filter((n) => typeof n === "number");
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function pickLatest(releases) {
  const list = releases.filter((r) => !r.draft).slice();
  list.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return list[0] || null;
}

/* ------------------------------------------------------------------- main */

async function main() {
  if (!existsSync(CONFIG)) {
    warn("缺少 data/mods.json，跳过二创 Mod 同步");
    return;
  }

  const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
  const mods = (cfg.mods || []).filter((m) => m && m.enabled !== false && m.repo);

  const out = [];

  for (const mod of mods) {
    const entry = {
      id: mod.id || mod.repo.replace(/[^\w]+/g, "-"),
      name: mod.name || mod.repo,
      platform: mod.platform || "github",
      repo: mod.repo,
      repoUrl:
        mod.repoUrl ||
        (mod.platform === "gitee" ? `https://gitee.com/${mod.repo}` : `https://github.com/${mod.repo}`),
      author: mod.author || mod.repo.split("/")[0],
      desc: mod.desc || "",
      note: mod.note || "",
      /* 参数表（页面选项卡下方那张）：这些值都能在 data/mods.json 里覆盖，
         不写就走站点默认 —— MC 1.12.2 / Forge 14.23.5.2864。 */
      requiresJiezhimod: mod.requiresJiezhimod === true,
      requires: mod.requires || "",
      hint: mod.hint || "",
      minecraft: mod.minecraft || "1.12.2",
      loader: mod.loader || "Forge 14.23.5.2864",
      license: mod.license || "",
      homepage: mod.homepage || "",
      releases: [],
      latest: null,
      downloads: null,
      error: null,
    };

    /* data/mods.json 里可选的 ignore：正则字符串数组，命中的附件直接丢掉 */
    const ignoreRes = (Array.isArray(mod.ignore) ? mod.ignore : []).map((src) => new RegExp(src, "i"));

    try {
      const raw = entry.platform === "gitee" ? await fetchGitee(mod.repo) : await fetchGithub(mod.repo);
      if (!Array.isArray(raw)) throw new Error("返回格式不是数组");

      entry.releases = raw
        .map((r) => normalizeRelease(r, entry, ignoreRes))
        .filter((r) => r.assets.length > 0 || r.notesHtml);
      entry.releases.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
      entry.latest = pickLatest(entry.releases);

      /* 开源许可：**以仓库为准**，data/mods.json 里写的只当离线兜底。
         上游会换协议（比如 RBMK 从 GPL-3.0 换成 MPL-2.0），手写值必然过期。
         顺序：平台 license 字段 → LICENSE 正文识别 → 手写值 → 未标注。 */
      const meta = await fetchRepoMeta(entry.platform, entry.repo);
      if (!entry.homepage) entry.homepage = meta.homepage || "";

      let lic = String(meta.license || "").trim();
      if (!lic) {
        const text = await fetchLicenseText(entry.platform, entry.repo, meta.branch);
        lic = detectLicense(text);
      }
      entry.license = lic || entry.license || "未标注";
      entry.licenseSource = lic ? "repo" : entry.license === "未标注" ? "none" : "manual";

      entry.downloads = sumDownloads(entry.releases.map((r) => r.downloads));

      const assetCount = entry.releases.reduce((n, r) => n + r.assets.length, 0);
      log(
        `${entry.name} (${entry.platform} ${entry.repo}): ${entry.releases.length} 个版本 · ${assetCount} 个文件` +
          (entry.latest ? ` · 最新 ${entry.latest.tag}` : "") +
          ` · ${entry.license}`
      );
    } catch (err) {
      entry.error = err.message || String(err);
      warn(`${entry.name} 拉取失败：${entry.error}`);
    }

    out.push(entry);
  }

  const data = {
    generatedAt: new Date().toISOString(),
    count: out.length,
    mods: out,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  await writeFile(OUT_JSON, json + "\n", "utf8");

  const safe = json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  await writeFile(
    OUT_JS,
    "/* AUTO-GENERATED by scripts/sync-mods.mjs — do not edit by hand. */\n" +
      `window.__DFC_MODS__ = ${safe};\n`,
    "utf8"
  );

  log(`已写入 ${OUT_JSON}`);
  log(`已写入 ${OUT_JS}`);
  log(`共 ${out.length} 个二创 mod`);
}

main().catch((err) => {
  console.error("[mods][fatal]", err);
  process.exit(1);
});
