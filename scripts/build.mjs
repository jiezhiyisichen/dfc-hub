#!/usr/bin/env node
/**
 * build.mjs — 组装可部署目录 dist/
 * 纯静态站点，只做「挑文件 + 拷贝」，不做压缩混淆，方便排查线上问题。
 *
 * 会先把 data/*.json 编译成同名 .js（静态站用 <script> 直接引入），
 * 再把 public/ 下的内容铺到 dist 根目录：public/downloads/x.zip → /downloads/x.zip
 */

import { cp, mkdir, rm, readdir, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");

const ROOT_FILES = [
  "index.html",
  "downloads.html",
  "404.html",
  "robots.txt",
  "_headers",
];

/** 每次构建一个指纹：优先用提交 SHA，本地构建用时间戳 */
const BUILD_ID = (process.env.GITHUB_SHA || "").slice(0, 7) || Date.now().toString(36);

/**
 * 给 dist 里页面上的本地资源引用加 ?v=<BUILD_ID>。
 * 目的：部署一次换一次 URL，让浏览器里已经存下的旧条目（哪怕是以前按 7 天缓存的）
 * 直接失效，不需要访客手动 Ctrl+F5。只改 dist，不动仓库里的源文件。
 */
async function stampAssets() {
  const pages = ["index.html", "downloads.html", "404.html"];
  const re = /(\s(?:src|href)=")((?:assets|data)\/[^"?#]+)(")/g;
  let touched = 0;

  for (const page of pages) {
    const p = join(DIST, page);
    if (!existsSync(p)) continue;

    const html = await readFile(p, "utf8");
    const stamped = html.replace(re, (_m, pre, url, post) => `${pre}${url}?v=${BUILD_ID}${post}`);
    if (stamped !== html) {
      await writeFile(p, stamped, "utf8");
      touched++;
    }
  }

  console.log(`[build] 资源指纹 ?v=${BUILD_ID}，已写入 ${touched} 个页面`);
}

/** data/config.json → data/config.js；data/releases.json → data/releases.js */
async function compileDataShims() {
  const pairs = [
    { json: "config.json", js: "config.js", global: "__DFC_CONFIG__" },
    { json: "releases.json", js: "releases.js", global: "__DFC_LOCAL__" },
  ];

  for (const pair of pairs) {
    const jsonPath = resolve(ROOT, "data", pair.json);
    if (!existsSync(jsonPath)) continue;

    const raw = await readFile(jsonPath, "utf8");
    const data = JSON.parse(raw);
    const body =
      `/* AUTO-GENERATED from data/${pair.json} — 由 npm run build / 管理后台生成。 */\n` +
      `window.${pair.global} = ${JSON.stringify(data, null, 2)};\n`;
    await writeFile(resolve(ROOT, "data", pair.js), body, "utf8");
    console.log(`[build] data/${pair.js} 已从 ${pair.json} 生成`);
  }
}

async function main() {
  if (!existsSync(resolve(ROOT, "assets/data/releases.js"))) {
    console.warn("[build][warn] 缺少 assets/data/releases.js，请先运行 npm run sync");
  }

  await compileDataShims();

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  let copied = 0;
  for (const file of ROOT_FILES) {
    const src = resolve(ROOT, file);
    if (!existsSync(src)) continue;
    await cp(src, join(DIST, file));
    copied++;
  }

  await cp(resolve(ROOT, "assets"), join(DIST, "assets"), { recursive: true });
  copied++;

  /* 站点文案与本地发布清单 */
  if (existsSync(resolve(ROOT, "data"))) {
    await cp(resolve(ROOT, "data"), join(DIST, "data"), { recursive: true });
    copied++;
  }

  /* 资源指纹：破掉访客浏览器里的旧缓存 */
  await stampAssets();

  /* public/ 下的文件铺到站点根：public/downloads → dist/downloads */
  const publicDir = resolve(ROOT, "public");
  if (existsSync(publicDir)) {
    for (const entry of await readdir(publicDir)) {
      await cp(join(publicDir, entry), join(DIST, entry), { recursive: true });
      copied++;
    }
  }

  // 记录构建时间，便于线上确认版本
  await writeFile(
    join(DIST, "build-info.json"),
    JSON.stringify(
      { buildId: BUILD_ID, builtAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const list = await readdir(DIST, { withFileTypes: true });
  console.log(`[build] dist/ 已生成，${copied} 个条目：`);
  for (const item of list) {
    const p = join(DIST, item.name);
    const s = await stat(p);
    console.log(`  ${item.isDirectory() ? "dir " : "file"}  ${item.name}${item.isDirectory() ? "" : `  (${s.size} B)`}`);
  }
}

main().catch((err) => {
  console.error("[build][fatal]", err);
  process.exit(1);
});
