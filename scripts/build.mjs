#!/usr/bin/env node
/**
 * build.mjs — 组装可部署目录 dist/
 * 纯静态站点，只做「挑文件 + 拷贝」，不做压缩混淆，方便排查线上问题。
 */

import { cp, mkdir, rm, readdir, stat, writeFile } from "node:fs/promises";
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
  "_redirects",
];

async function main() {
  if (!existsSync(resolve(ROOT, "assets/data/releases.js"))) {
    console.warn("[build][warn] 缺少 assets/data/releases.js，请先运行 npm run sync");
  }

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

  // 记录构建时间，便于线上确认版本
  await writeFile(
    join(DIST, "build-info.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null }, null, 2) +
      "\n",
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
