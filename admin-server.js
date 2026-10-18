#!/usr/bin/env node
/* =============================================================================
 * admin-server.js — DFC Hub 本地管理后台
 * -----------------------------------------------------------------------------
 * 只在本机运行（默认 127.0.0.1:4310），读写两个文件：
 *   data/config.json     站点文案
 *   data/releases.json   本地上传的下载包清单
 *
 * 上传的文件存到 public/downloads/，构建时会被复制成 dist/downloads/，
 * 线上地址形如 https://dfc-hub.pages.dev/downloads/xxx.zip
 *
 * 启动：npm run admin      （或 node admin-server.js）
 * 后台：http://127.0.0.1:4310/admin/
 * 预览：http://127.0.0.1:4310/
 * ============================================================================= */

import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_JSON = path.join(DATA_DIR, "config.json");
const CONFIG_JS = path.join(DATA_DIR, "config.js");
const RELEASES_JSON = path.join(DATA_DIR, "releases.json");
const RELEASES_JS = path.join(DATA_DIR, "releases.js");
const DOWNLOAD_DIR = path.join(ROOT, "public", "downloads");

const PORT = Number(process.env.PORT || 4310);
const HOST = "127.0.0.1";
const MAX_UPLOAD_MB = 100;
const CF_PAGES_LIMIT_MB = 25;

/* ------------------------------------------------------------------ utils */

function log(...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[admin ${t}]`, ...args);
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw new Error(`读取 ${path.basename(file)} 失败：${err.message}`);
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  const body = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(tmp, body, "utf8");
  try {
    await fs.rename(tmp, file);
  } catch {
    await fs.rm(file, { force: true });
    await fs.rename(tmp, file);
  }
}

/** config.json → data/config.js（静态站直接 <script> 引入） */
async function writeConfigShim(config) {
  const js =
    "/* AUTO-GENERATED from data/config.json — 由本地后台生成，请勿手改。 */\n" +
    `window.__DFC_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`;
  await fs.writeFile(CONFIG_JS, js, "utf8");
}

/** releases.json → data/releases.js */
async function writeReleasesShim(data) {
  const js =
    "/* AUTO-GENERATED from data/releases.json — 由本地后台生成，请勿手改。 */\n" +
    `window.__DFC_LOCAL__ = ${JSON.stringify(data, null, 2)};\n`;
  await fs.writeFile(RELEASES_JS, js, "utf8");
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "file"));
  return base
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
}

/** multer 把中文文件名按 latin1 解出来，这里尽量还原 */
function decodeName(name) {
  const raw = String(name || "");
  if (!/[\u0080-\u00ff]/.test(raw)) return raw;
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  if (!utf8.includes("\uFFFD") && /[\u4e00-\u9fa5]/.test(utf8)) return utf8;
  return raw;
}

function extOf(name) {
  return path.extname(String(name || "")).toLowerCase();
}

function kindOf(name) {
  const ext = extOf(name);
  if (ext === ".jar") return "tool";
  if (ext === ".zip") return "map";
  return null;
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onData?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onData?.(text);
    });
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/* --------------------------------------------------------------- app setup */

const app = express();
app.use(express.json({ limit: "2mb" }));

/* 只接受本机来源的写操作，挡住浏览器里其他页面的跨站请求 */
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.get("origin");
  if (!origin) return next();
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return next();
  } catch {
    /* ignore */
  }
  return res.status(403).json({ ok: false, error: "仅允许本机来源的请求" });
});

await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });

/* 初始化：data/config.js 与 data/releases.js 不存在时先生成一份 */
async function ensureShims() {
  const config = await readJson(CONFIG_JSON, null);
  if (config) await writeConfigShim(config);
  const releases = await readJson(RELEASES_JSON, { items: [] });
  await writeReleasesShim(releases);
}
await ensureShims();

/* ------------------------------------------------------------------- upload */

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DOWNLOAD_DIR),
    filename: (_req, file, cb) => {
      const name = sanitizeFilename(decodeName(file.originalname));
      cb(null, name);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (kindOf(file.originalname)) return cb(null, true);
    cb(new Error("只接受 .jar 或 .zip 文件"));
  },
});

/* --------------------------------------------------------------------- api */

app.get("/api/bootstrap", async (_req, res, next) => {
  try {
    const [config, releases, status] = await Promise.all([
      readJson(CONFIG_JSON, {}),
      readJson(RELEASES_JSON, { items: [] }),
      gitStatus(),
    ]);
    res.json({
      ok: true,
      config,
      releases,
      status,
      limits: { maxUploadMb: MAX_UPLOAD_MB, pagesLimitMb: CF_PAGES_LIMIT_MB },
    });
  } catch (err) {
    next(err);
  }
});

app.put("/api/config", async (req, res, next) => {
  try {
    const config = req.body;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return res.status(400).json({ ok: false, error: "config 必须是一个对象" });
    }
    await writeJson(CONFIG_JSON, config);
    await writeConfigShim(config);
    log("文案已保存");
    res.json({ ok: true, config });
  } catch (err) {
    next(err);
  }
});

app.get("/api/releases", async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await readJson(RELEASES_JSON, { items: [] }) });
  } catch (err) {
    next(err);
  }
});

/** 新增条目：可带文件（multipart），也可只登记已有文件（JSON） */
app.post("/api/releases", upload.single("file"), async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await readJson(RELEASES_JSON, { items: [] });
    if (!Array.isArray(data.items)) data.items = [];

    let fileName = String(body.fileName || "").trim();
    let size = Number(body.size || 0) || 0;

    if (req.file) {
      fileName = req.file.filename;
      size = req.file.size;
    }

    if (!fileName) {
      return res.status(400).json({ ok: false, error: "没有文件，也没有填写已有文件名" });
    }

    const kind = body.kind || kindOf(fileName);
    if (!kind) {
      return res.status(400).json({ ok: false, error: "只支持 .jar / .zip" });
    }

    const tag = String(body.tag || "").trim() || "v0.0";
    const item = {
      id: `local-${Date.now().toString(36)}`,
      tag,
      name: String(body.name || "").trim() || fileName,
      channel: ["release", "beta", "preview"].includes(body.channel) ? body.channel : "release",
      kind,
      fileName,
      size,
      url: `downloads/${fileName}`,
      notes: String(body.notes || "").trim(),
      publishedAt: new Date().toISOString(),
    };

    data.items.unshift(item);
    data.updatedAt = new Date().toISOString();
    await writeJson(RELEASES_JSON, data);
    await writeReleasesShim(data);

    log(`新增本地包 ${fileName}（${kind}）`);
    res.json({
      ok: true,
      item,
      data,
      warning:
        size > CF_PAGES_LIMIT_MB * 1024 * 1024
          ? `文件超过 ${CF_PAGES_LIMIT_MB}MB，Cloudflare Pages 单文件上限可能拒绝部署，建议改用 GitHub Release 托管。`
          : null,
    });
  } catch (err) {
    next(err);
  }
});

/** 编辑条目（不含替换文件） */
app.put("/api/releases/:id", async (req, res, next) => {
  try {
    const data = await readJson(RELEASES_JSON, { items: [] });
    const index = (data.items || []).findIndex((it) => it.id === req.params.id);
    if (index === -1) return res.status(404).json({ ok: false, error: "条目不存在" });

    const patch = req.body || {};
    const allowed = ["tag", "name", "channel", "notes", "publishedAt"];
    for (const key of allowed) {
      if (patch[key] != null) data.items[index][key] = String(patch[key]);
    }
    if (patch.channel && !["release", "beta", "preview"].includes(patch.channel)) {
      data.items[index].channel = "release";
    }

    data.updatedAt = new Date().toISOString();
    await writeJson(RELEASES_JSON, data);
    await writeReleasesShim(data);
    res.json({ ok: true, item: data.items[index], data });
  } catch (err) {
    next(err);
  }
});

/** 删除条目；?purge=1 时同时删除 public/downloads 下的文件 */
app.delete("/api/releases/:id", async (req, res, next) => {
  try {
    const data = await readJson(RELEASES_JSON, { items: [] });
    const index = (data.items || []).findIndex((it) => it.id === req.params.id);
    if (index === -1) return res.status(404).json({ ok: false, error: "条目不存在" });

    const [removed] = data.items.splice(index, 1);
    data.updatedAt = new Date().toISOString();
    await writeJson(RELEASES_JSON, data);
    await writeReleasesShim(data);

    let purged = false;
    if (req.query.purge === "1" && removed.fileName) {
      const target = path.join(DOWNLOAD_DIR, path.basename(removed.fileName));
      try {
        await fs.rm(target, { force: true });
        purged = true;
      } catch {
        /* 文件可能已经被手动删掉 */
      }
    }

    log(`删除条目 ${removed.fileName}${purged ? "（含文件）" : ""}`);
    res.json({ ok: true, data, purged });
  } catch (err) {
    next(err);
  }
});

/** 单独上传文件（不建条目），返回文件名与大小 */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "没有收到文件" });
  res.json({
    ok: true,
    fileName: req.file.filename,
    size: req.file.size,
    kind: kindOf(req.file.filename),
    url: `downloads/${req.file.filename}`,
    warning:
      req.file.size > CF_PAGES_LIMIT_MB * 1024 * 1024
        ? `文件超过 ${CF_PAGES_LIMIT_MB}MB，Cloudflare Pages 可能拒绝部署。`
        : null,
  });
});

/** 刷新上游 Release（等价 npm run sync） */
app.post("/api/sync", async (_req, res) => {
  const result = await run(process.execPath, ["scripts/sync-releases.mjs"]);
  res.json({
    ok: result.code === 0,
    code: result.code,
    output: (result.stdout + result.stderr).trim(),
  });
});

/** git 变更概览 */
async function gitStatus() {
  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const changes = await run("git", ["status", "--porcelain"]);
  const last = await run("git", ["log", "-1", "--pretty=%h %s"]);
  const files = changes.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2).trim(), path: line.slice(3) }));
  return {
    branch: branch.stdout.trim() || "main",
    lastCommit: last.stdout.trim() || "—",
    dirty: files.length > 0,
    files,
  };
}

app.get("/api/status", async (_req, res) => {
  res.json({ ok: true, status: await gitStatus() });
});

/* ---------------------------------------------------------------- publish */

let publishing = false;

app.post("/api/publish", async (req, res) => {
  if (publishing) {
    return res.status(409).json({ ok: false, error: "上一次发布还没跑完，请稍等" });
  }
  publishing = true;

  const steps = [];
  const pushLog = (step, text) => {
    if (!text) return;
    steps.push({ step, text });
  };

  try {
    const message = String(req.body?.message || "").trim() || "Update via local admin panel";

    pushLog("status", "检查工作区…");
    const before = await gitStatus();
    if (!before.dirty) {
      return res.json({
        ok: true,
        nothingToDo: true,
        steps: [{ step: "status", text: "工作区没有变更，不需要发布。" }],
      });
    }

    pushLog("add", "$ git add -A");
    const add = await run("git", ["add", "-A"]);
    pushLog("add", (add.stdout + add.stderr).trim() || "已暂存全部改动");
    if (add.code !== 0) throw new Error("git add 失败");

    pushLog("commit", `$ git commit -m "${message}"`);
    const commit = await run("git", ["commit", "-m", message]);
    const commitOut = (commit.stdout + commit.stderr).trim();
    pushLog("commit", commitOut);
    if (commit.code !== 0 && !/nothing to commit/i.test(commitOut)) {
      throw new Error("git commit 失败");
    }

    pushLog("push", "$ git push origin main");
    let push = await run("git", ["push", "origin", "main"]);
    pushLog("push", (push.stdout + push.stderr).trim() || "(无输出)");

    /* 本机 Git 走 schannel 时偶尔会卡在证书吊销检查，降级重试一次 */
    if (
      push.code !== 0 &&
      /schannel|CRYPT_E_NO_REVOCATION_CHECK|SSL certificate/i.test(push.stderr)
    ) {
      pushLog("push", "证书吊销检查失败，关闭本次 SSL 校验后重试…");
      push = await run("git", ["-c", "http.sslVerify=false", "push", "origin", "main"]);
      pushLog("push", (push.stdout + push.stderr).trim() || "(无输出)");
    }

    if (push.code !== 0 && /rejected|non-fast-forward|fetch first/i.test(push.stderr)) {
      pushLog("push", "远端有新提交，先 rebase 再推送…");
      const fetch = await run("git", ["-c", "http.sslVerify=false", "pull", "--rebase", "origin", "main"]);
      pushLog("rebase", (fetch.stdout + fetch.stderr).trim() || "(无输出)");
      push = await run("git", ["-c", "http.sslVerify=false", "push", "origin", "main"]);
      pushLog("push", (push.stdout + push.stderr).trim() || "(无输出)");
    }

    if (push.code !== 0) throw new Error("git push 失败");

    log("发布完成");
    res.json({ ok: true, steps, status: await gitStatus() });
  } catch (err) {
    log("发布失败：", err.message);
    res.status(500).json({ ok: false, error: err.message, steps });
  } finally {
    publishing = false;
  }
});

/* ------------------------------------------------------------------ static */

app.use("/admin", express.static(path.join(ROOT, "admin"), { extensions: ["html"] }));

/* 站点预览：根目录静态资源 + public/ 映射 */
app.use("/downloads", express.static(DOWNLOAD_DIR));
app.use(express.static(ROOT, { extensions: ["html"], index: "index.html" }));

/* 错误处理（multer 的体积/类型错误也走这里） */
app.use((err, _req, res, _next) => {
  const message =
    err?.code === "LIMIT_FILE_SIZE"
      ? `文件超过 ${MAX_UPLOAD_MB}MB 上限`
      : err?.message || "服务器内部错误";
  log("请求失败：", message);
  if (res.headersSent) return;
  res.status(400).json({ ok: false, error: message });
});

app.listen(PORT, HOST, () => {
  console.log("");
  console.log("  DFC Hub 管理后台");
  console.log(`  后台  http://${HOST}:${PORT}/admin/`);
  console.log(`  预览  http://${HOST}:${PORT}/`);
  console.log(`  数据  data/config.json · data/releases.json`);
  console.log(`  上传  public/downloads/`);
  console.log("");
  console.log("  Ctrl+C 退出");
  console.log("");
});
