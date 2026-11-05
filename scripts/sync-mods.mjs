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

/** 仓库元信息：只取开源许可与官网地址，用来补参数表里没手填的项。
 *  拿不到就算了，绝不能因为它让整个 mod 变成 error。 */
async function fetchRepoMeta(platform, repo) {
  try {
    if (platform === "gitee") {
      const d = await fetchJson(`${API.gitee}/repos/${repo}`);
      return { license: (d && d.license) || "", homepage: (d && d.homepage) || "" };
    }
    const headers = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
    const d = await fetchJson(`${API.github}/repos/${repo}`, headers);
    return {
      license: (d && d.license && (d.license.spdx_id || d.license.name)) || "",
      homepage: (d && d.homepage) || "",
    };
  } catch (err) {
    warn(`仓库信息读取失败（不影响版本列表）：${err.message || err}`);
    return {};
  }
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
        downloads: a.download_count || 0,
        url: a.browser_download_url,
        mirror: null,
      };
    })
    .filter((a) => a.kind !== "other" && a.url && !ignoreRes.some((re) => re.test(a.name)));

  const body = raw.body || "";

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
    notesText: mdToText(body),
    notesHtml: mdToHtml(body),
  };
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

      /* 参数表里没手填的许可 / 官网，尽量从仓库元信息补齐 */
      if (!entry.license || !entry.homepage) {
        const meta = await fetchRepoMeta(entry.platform, entry.repo);
        if (!entry.license) entry.license = meta.license || "";
        if (!entry.homepage) entry.homepage = meta.homepage || "";
      }
      if (!entry.license) entry.license = "未标注";

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
