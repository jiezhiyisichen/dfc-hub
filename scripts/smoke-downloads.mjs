#!/usr/bin/env node
/**
 * smoke-downloads.mjs
 * ---------------------------------------------------------------------------
 * 给 assets/js/downloads.js 做一次"无浏览器"的冒烟测试。
 *
 * 为什么要它：下载页的线路切换（自动 / Gitee / GitHub）全在客户端算出来，
 * 静态检查看不出来；而 Cloudflare Pages 是**推送即上线**，脚本一旦在浏览器里
 * 抛异常，线上就直接白屏。这里用一个极小的 DOM 垫片把脚本真正跑一遍，
 * 断言三种线路下生成的 HTML 地址形态正确、且不会因为缺 mirrors 字段崩溃。
 *
 * 用法：node scripts/smoke-downloads.mjs
 *
 * 注意：本文件**不写反斜杠**（正则一律改成 includes 判断）。
 * Git Bash 在 heredoc 里做路径转换，会把反斜杠吃成斜杠，导致正则全废。
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* --------------------------------------------------------------- DOM 垫片 */
function makeEl(attrs) {
  return {
    innerHTML: "",
    textContent: "",
    hidden: true,
    attrs: attrs || {},
    scrollHeight: 0,
    clientHeight: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
  };
}

function buildEnv(search) {
  const els = new Map();
  const document = {
    readyState: "complete",
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl({ id }));
      return els.get(id);
    },
    querySelector(sel) {
      if (!els.has(sel)) els.set(sel, makeEl({ sel }));
      return els.get(sel);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const store = new Map();
  const win = {
    location: { search: search || "", pathname: "/downloads.html", hash: "" },
    history: { replaceState() {} },
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
    },
    open() {},
  };
  return { win, document, els };
}

const DATA_JS = readFileSync(resolve(ROOT, "assets/data/releases.js"), "utf8");
const LOCAL_JS = readFileSync(resolve(ROOT, "data/releases.js"), "utf8");
const PAGE_JS = readFileSync(resolve(ROOT, "assets/js/downloads.js"), "utf8");

function boot(win, document) {
  new Function("window", DATA_JS + ";" + LOCAL_JS)(win);
  new Function("window", "document", "URLSearchParams", "setTimeout", "clearTimeout", PAGE_JS)(
    win, document, URLSearchParams, setTimeout, clearTimeout
  );
}

function run(search) {
  const { win, document, els } = buildEnv(search);
  boot(win, document);
  return els.get("releaseList").innerHTML || "";
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log("  PASS  " + name);
  } else {
    failures++;
    console.log("  FAIL  " + name + (extra ? "   [" + extra + "]" : ""));
  }
}
function section(t) {
  console.log("");
  console.log("[smoke] " + t);
}

const GITEE_JAR = 'href="https://gitee.com/yi-sichen-jiezhi/';
const GH_JAR = 'href="https://github.com/jiezhiyisichen/';

section("自动线路（有 Gitee 就走 Gitee）");
const auto = run("");
check("渲染出了版本卡片", auto.length > 2000, "len=" + auto.length);
check("默认主下载地址是 Gitee", auto.indexOf(GITEE_JAR) !== -1);
check("给了 GitHub 备用按钮", auto.indexOf("GitHub 备用") !== -1);
check("资产里标注了当前线路", auto.indexOf("线路 Gitee") !== -1);
check("发布页同时给 GitHub 与 Gitee", auto.indexOf("GitHub ↗") !== -1 && auto.indexOf("Gitee ↗") !== -1);

section("强制 Gitee 线路");
const g = run("?mirror=gitee");
check("主下载地址是 Gitee", g.indexOf(GITEE_JAR) !== -1);
check("备用按钮是 GitHub", g.indexOf("GitHub 备用") !== -1);

section("强制 GitHub 线路");
const gh = run("?mirror=github");
check("主下载地址是 GitHub", gh.indexOf(GH_JAR) !== -1);
check("确实是 release 直链", gh.indexOf("/releases/download/") !== -1);
check("备用按钮是 Gitee", gh.indexOf("Gitee 备用") !== -1);

section("旧数据兼容（没有 mirrors 字段）");
{
  const { win, document, els } = buildEnv("");
  new Function("window", DATA_JS)(win);
  const bare = JSON.parse(JSON.stringify(win.__DFC_DATA__));
  bare.releases.forEach((r) => {
    delete r.mirrors;
    (r.assets || []).forEach((a) => delete a.mirrors);
  });
  win.__DFC_DATA__ = bare;
  new Function("window", "document", "URLSearchParams", "setTimeout", "clearTimeout", PAGE_JS)(
    win, document, URLSearchParams, setTimeout, clearTimeout
  );
  const html = els.get("releaseList").innerHTML || "";
  check("不报错且仍能渲染", html.length > 2000, "len=" + html.length);
  check("回落到 GitHub 地址", html.indexOf(GH_JAR) !== -1);
  check("不会凭空出现备用按钮", html.indexOf("Gitee 备用") === -1);
}

section("搜索与筛选");
const q = run("?q=3.8");
check("按关键词过滤有效", q.indexOf("v3.8") !== -1);
const beta = run("?channel=beta");
check("空通道不崩", typeof beta === "string");

/* 「重大更新」是叠加标记，但只允许挂在正式版上。
   数据不变式在这里验一次，前端徽章顺序也验一次。 */
section("重大更新标记（只能配正式版）");
const RAW = JSON.parse(
  readFileSync(resolve(ROOT, "assets/data/releases.json"), "utf8")
);
const majors = (RAW.releases || []).filter((r) => r.major);
check("至少识别出一个重大更新版本", majors.length > 0, "n=" + majors.length);
check(
  "所有重大更新版本都是正式版",
  majors.every((r) => r.channel === "release"),
  majors.filter((r) => r.channel !== "release").map((r) => r.tag).join(",")
);
check(
  "最新正式版带重大更新标记",
  !!(RAW.latest && RAW.latest.release && RAW.latest.release.major),
  RAW.latest && RAW.latest.release ? RAW.latest.release.tag : "no latest"
);
const majorTag = majors.length ? majors[0].tag : "";
if (majorTag) {
  const html = run("?q=" + majorTag.replace(/^v/, ""));
  check("页面渲染出「重大更新」徽章", html.indexOf("badge--major") !== -1);
  check("徽章文案是重大更新", html.indexOf(">重大更新<") !== -1);
  const iMajor = html.indexOf("badge--major");
  const iChan = html.indexOf("badge--release");
  check("徽章排在通道徽章之前", iMajor !== -1 && iChan !== -1 && iMajor < iChan);
  const filtered = run("?nature=major");
  check(
    "按重大更新筛选只剩正式版",
    filtered.indexOf("badge--major") !== -1 && filtered.indexOf("badge--beta") === -1
  );
}

console.log("");
console.log(failures ? "RESULT: FAILED (" + failures + ")" : "RESULT: ALL GREEN");
process.exit(failures ? 1 : 0);
