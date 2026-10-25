/* ==========================================================================
   DFC HUB — 其他下载（二创 Mod）
   数据来自 assets/data/mods.js（window.__DFC_MODS__），由 scripts/sync-mods.mjs 生成。
   页面结构照下载中心：选项卡切模组 → 版本看板 → 版本卡片列表。
   ========================================================================== */
(function () {
  "use strict";

  var CHANNEL_LABEL = { release: "正式版", beta: "测试版", preview: "预览版" };
  var PLATFORM_LABEL = { gitee: "Gitee", github: "GitHub" };

  var DATA = window.__DFC_MODS__ || null;
  var tabsEl = document.getElementById("modTabs");
  var listEl = document.getElementById("modList");
  var emptyEl = document.getElementById("modEmpty");
  var resultEl = document.getElementById("modResult");
  var boardEl = document.getElementById("modBoard");

  var state = { modId: null };

  /* -------------------------------------------------------------- helpers */
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtBytes(bytes) {
    if (window.DFC && window.DFC.formatBytes) return window.DFC.formatBytes(bytes);
    if (!bytes) return "";
    var units = ["B", "KB", "MB", "GB"];
    var i = 0;
    var n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
  }

  function fmtDate(iso) {
    if (window.DFC && window.DFC.formatDate) return window.DFC.formatDate(iso);
    return iso ? String(iso).slice(0, 10) : "—";
  }

  function mods() {
    return (DATA && Array.isArray(DATA.mods) && DATA.mods) || [];
  }

  function current() {
    var list = mods();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.modId) return list[i];
    }
    return list[0] || null;
  }

  function displayName(release) {
    var name = String(release.name || "").trim();
    var tag = String(release.tag || "").trim();
    if (!name) return tag;
    if (!tag) return name;
    var safe = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var stripped = name.replace(new RegExp("^" + safe + "\\s*[·:：—–-]?\\s*", "i"), "").trim();
    if (!stripped) return name;
    var noVersion = stripped.replace(/^v?\d+(?:\.\d+)*(?=$|[\s·:：—–+,，、])[\s·:：—–+,，、]*/i, "").trim();
    return noVersion || stripped;
  }

  /* ---------------------------------------------------------------- cards */
  function assetRow(asset) {
    var isJar = asset.kind === "mod";
    var meta = [isJar ? "模组 jar" : "整合包"];
    if (asset.size) meta.push(fmtBytes(asset.size));
    if (asset.downloads) meta.push("↓ " + asset.downloads);

    return (
      '<div class="asset">' +
      '<div class="asset-kind" data-kind="' +
      esc(isJar ? "tool" : "map") +
      '">' +
      (isJar ? "JAR" : "ZIP") +
      "</div>" +
      '<div class="asset-info">' +
      '<div class="asset-name">' +
      esc(asset.name) +
      "</div>" +
      '<div class="asset-sub">' +
      meta
        .map(function (m) {
          return "<span>" + esc(m) + "</span>";
        })
        .join("") +
      "</div>" +
      "</div>" +
      '<div class="asset-actions">' +
      '<a class="btn btn-primary btn-sm" href="' +
      esc(asset.url) +
      '" rel="noopener noreferrer" download>' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16" /></svg>' +
      (isJar ? "下载 .jar" : "下载整合包") +
      "</a>" +
      "</div>" +
      "</div>"
    );
  }

  function releaseCard(release, isLatest) {
    var channel = release.channel || "release";
    var notesId = "mnotes-" + esc(release.tag).replace(/[^\w.-]/g, "-");
    var hasNotes = !!(release.notesHtml && release.notesHtml.trim());
    var openNotes = !!isLatest;
    var assets = release.assets || [];

    var badges =
      '<span class="badge badge--' +
      (channel === "release" ? "release" : channel === "beta" ? "beta" : "preview") +
      '"><span class="dot"></span>' +
      CHANNEL_LABEL[channel] +
      "</span>";
    if (isLatest) badges += '<span class="badge badge--muted">LATEST</span>';

    var totalSize = assets.reduce(function (sum, a) {
      return sum + (a.size || 0);
    }, 0);

    return (
      '<article class="release' +
      (isLatest ? " is-latest" : "") +
      '" data-tag="' +
      esc(release.tag) +
      '">' +
      '<div class="release-head">' +
      '<div class="release-tag">' +
      esc(release.tag) +
      "</div>" +
      '<div class="release-title">' +
      "<h3>" +
      esc(displayName(release)) +
      "</h3>" +
      '<div class="meta">' +
      "<span>" +
      fmtDate(release.publishedAt) +
      "</span>" +
      '<span class="sep"></span>' +
      "<span>" +
      assets.length +
      " 个文件" +
      (totalSize ? " · " + fmtBytes(totalSize) : "") +
      "</span>" +
      '<span class="sep"></span>' +
      '<a href="' +
      esc(release.url) +
      '" target="_blank" rel="noopener noreferrer">发布页 ↗</a>' +
      "</div>" +
      "</div>" +
      '<div class="release-badges">' +
      badges +
      "</div>" +
      "</div>" +
      '<div class="asset-list">' +
      assets.map(assetRow).join("") +
      "</div>" +
      (hasNotes
        ? '<div class="release-notes">' +
          '<button class="notes-toggle" type="button" aria-expanded="' +
          (openNotes ? "true" : "false") +
          '" aria-controls="' +
          notesId +
          '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>' +
          "<span>" +
          (openNotes ? "收起更新内容" : "查看更新内容") +
          "</span>" +
          "</button>" +
          '<div class="notes-body' +
          (openNotes ? " is-open" : "") +
          '" id="' +
          notesId +
          '">' +
          release.notesHtml +
          "</div>" +
          "</div>"
        : "") +
      "</article>"
    );
  }

  /* ----------------------------------------------------------------- tabs */
  function renderTabs() {
    var list = mods();
    if (!tabsEl) return;

    if (!list.length) {
      tabsEl.innerHTML = '<button class="mod-tab is-on" type="button" role="tab" aria-selected="true">暂无模组</button>';
      return;
    }

    tabsEl.innerHTML = list
      .map(function (m) {
        var count = (m.releases || []).length;
        var on = m.id === state.modId;
        return (
          '<button class="mod-tab' +
          (on ? " is-on" : "") +
          '" type="button" role="tab" data-mod-id="' +
          esc(m.id) +
          '" aria-selected="' +
          (on ? "true" : "false") +
          '">' +
          esc(m.name) +
          '<span class="n">' +
          count +
          "</span></button>"
        );
      })
      .join("");

    tabsEl.querySelectorAll("[data-mod-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        select(btn.getAttribute("data-mod-id"));
      });
    });
  }

  function select(id) {
    if (!id || id === state.modId) return;
    state.modId = id;
    try {
      var url = new URL(window.location.href);
      url.searchParams.set("mod", id);
      window.history.replaceState(null, "", url.toString());
    } catch (e) {
      /* file:// 下可能抛，忽略 */
    }
    renderTabs();
    render();
  }

  /* --------------------------------------------------------------- render */
  function renderBoard(mod) {
    if (!boardEl) return;

    if (!mod) {
      boardEl.hidden = true;
      return;
    }
    boardEl.hidden = false;

    var byLabel = {
      "[data-mod-name]": mod.name,
      "[data-mod-author]": "作者 " + (mod.author || "—") + (mod.note ? " · " + mod.note : ""),
      "[data-mod-latest]": mod.latest ? mod.latest.tag : "暂无",
      "[data-mod-date]": mod.latest ? fmtDate(mod.latest.publishedAt) + " 发布" : "",
      "[data-mod-releases]":
        (mod.releases || []).length +
        " 个版本 · " +
        (mod.releases || []).reduce(function (n, r) {
          return n + (r.assets || []).length;
        }, 0) +
        " 个文件",
      "[data-mod-platform]": PLATFORM_LABEL[mod.platform] || mod.platform,
    };

    Object.keys(byLabel).forEach(function (sel) {
      var el = boardEl.querySelector(sel);
      if (el) el.textContent = byLabel[sel];
    });

    var repoLink = boardEl.querySelector("[data-mod-repo]");
    if (repoLink) repoLink.setAttribute("href", mod.repoUrl || "#");
  }

  function bindNotes() {
    if (!listEl) return;
    listEl.querySelectorAll(".notes-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var body = document.getElementById(btn.getAttribute("aria-controls"));
        var open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        var label = btn.querySelector("span");
        if (label) label.textContent = open ? "查看更新内容" : "收起更新内容";
        if (body) body.classList.toggle("is-open", !open);
      });
    });
  }

  function render() {
    var mod = current();
    renderBoard(mod);

    if (!mod) {
      if (listEl) listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      if (resultEl) resultEl.textContent = "没有可用的二创 Mod 数据";
      return;
    }

    var releases = mod.releases || [];

    if (!releases.length) {
      if (listEl) listEl.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        var h = emptyEl.querySelector("h3");
        var p = emptyEl.querySelector("p");
        if (mod.error) {
          if (h) h.textContent = "这个模组暂时取不到数据";
          if (p) p.textContent = "原因：" + mod.error + "。可以直接去仓库的 Release 页面下载。";
        } else {
          if (h) h.textContent = "这个模组还没有可下载的文件";
          if (p) p.textContent = "作者可能只推了源码、或者发行版里还没挂 jar。稍后再来看，或者直接去仓库的 Release 页面。";
        }
      }
      if (resultEl) resultEl.textContent = mod.name + " · 暂无版本";
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (resultEl) resultEl.textContent = mod.name + " · 共 " + releases.length + " 个版本";
    if (listEl) listEl.innerHTML = releases.map(function (r, i) { return releaseCard(r, i === 0); }).join("");

    bindNotes();
  }

  /* -------------------------------------------------------------- refresh */
  function initRefresh() {
    var btn = document.querySelector("[data-mods-refresh]");
    if (!btn) return;

    var label = btn.querySelector("[data-mods-refresh-label]") || btn;
    var idle = label.textContent;
    var timer = null;

    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-busy")) return;
      btn.classList.add("is-busy");
      btn.setAttribute("disabled", "");
      label.textContent = "同步中…";

      fetch("assets/data/mods.json?t=" + Date.now(), { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (json) {
          DATA = json;
          window.__DFC_MODS__ = json;
          renderTabs();
          render();
          syncMeta();
          label.textContent = "已刷新";
        })
        .catch(function () {
          label.textContent = "同步失败";
        })
        .then(function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            label.textContent = idle;
            btn.classList.remove("is-busy");
            btn.removeAttribute("disabled");
          }, 2200);
        });
    });
  }

  /* ----------------------------------------------------------------- meta */
  function syncMeta() {
    var count = mods().length;
    document.querySelectorAll("[data-mod-count]").forEach(function (el) {
      el.textContent = String(count);
    });

    var line = "";
    if (DATA && DATA.generatedAt) {
      var stamp =
        window.DFC && window.DFC.formatDate
          ? window.DFC.formatDate(DATA.generatedAt, true)
          : String(DATA.generatedAt).slice(0, 16).replace("T", " ");
      line = "MODS SYNC · " + stamp;
    }
    document.querySelectorAll("[data-mod-sync]").forEach(function (el) {
      el.textContent = line || "MODS SYNC · —";
    });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    try {
      var params = new URLSearchParams(window.location.search);
      var want = params.get("mod");
      if (want) state.modId = want;
    } catch (e) {
      /* ignore */
    }

    if (!state.modId) {
      var first = mods()[0];
      state.modId = first ? first.id : null;
    }

    renderTabs();
    render();
    syncMeta();
    initRefresh();

    var reset = document.getElementById("modReset");
    if (reset) {
      reset.addEventListener("click", function () {
        window.location.reload();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
