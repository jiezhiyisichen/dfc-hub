/* ==========================================================================
   DFC HUB — downloads page controller
   Renders release cards from window.__DFC_DATA__, with search + filters.
   ========================================================================== */
(function () {
  "use strict";

  var DATA = window.__DFC_DATA__ || null;
  var LOCAL = window.__DFC_LOCAL__ || null;
  var listEl = document.getElementById("releaseList");
  var emptyEl = document.getElementById("emptyState");
  var resultLine = document.querySelector("[data-result-line]");
  var searchWrap = document.getElementById("searchWrap");
  var qInput = document.getElementById("q");
  var qClear = document.getElementById("qClear");

  if (!listEl) return;

  var CHANNEL_LABEL = {
    release: "正式版",
    beta: "测试版",
    preview: "预览版",
  };

  var MIRROR_KEY = "dfc-hub:mirror";

  function readMirror() {
    try {
      var v = window.localStorage.getItem(MIRROR_KEY);
      if (v === "gitee" || v === "github" || v === "auto") return v;
    } catch (e) {
      /* 隐私模式 / file:// 下可能抛，忽略 */
    }
    return "auto";
  }

  function saveMirror(v) {
    try {
      window.localStorage.setItem(MIRROR_KEY, v);
    } catch (e) {
      /* ignore */
    }
  }

  var state = {
    channel: "all",
    type: "all",
    q: "",
    /* 下载线路：auto / gitee / github。
       auto = 有 Gitee 镜像就优先走 Gitee（国内直连快），没有才回落 GitHub。 */
    mirror: readMirror(),
  };

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
    if (!bytes || bytes < 0) return "";
    var units = ["B", "KB", "MB", "GB"];
    var i = 0;
    var n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
  }

  function fmtDate(iso, withTime) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var p = function (v) {
      return String(v).padStart(2, "0");
    };
    var s = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    if (withTime) s += " " + p(d.getHours()) + ":" + p(d.getMinutes());
    return s;
  }

  function firstAsset(release, kind) {
    var assets = release.assets || [];
    for (var i = 0; i < assets.length; i++) {
      if (assets[i].kind === kind) return assets[i];
    }
    return null;
  }

  function releaseUrl(release) {
    if (release.source === "local") return "";
    return (
      release.url ||
      "https://github.com/jiezhiyisichen/DFC-Map-Creation-Tool/releases/tag/" + release.tag
    );
  }

  /* --------------------------------------------------------------- 下载线路
   * 同一个文件可能同时存在于 GitHub Release 和 Gitee 发行版里：
   *   asset.url        → GitHub 地址（主源，sync-releases.mjs 归一化时写入）
   *   asset.mirrors[]  → 备用线路，目前只有 { host: "gitee", url }
   * 选"自动"时优先 Gitee（国内直连明显更快），没有镜像才回落 GitHub。
   * 数据结构里没有 mirrors 时全部退化成老行为 —— 旧数据不会报错。 */

  function hostLabel(host) {
    return host === "gitee" ? "Gitee" : "GitHub";
  }

  function mirrorUrl(asset, host) {
    var list = (asset && asset.mirrors) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].host === host && list[i].url) return list[i].url;
    }
    return null;
  }

  /** 返回 { host, url } —— 按用户选定的线路挑一个可用地址 */
  function pickPrimary(asset, mirror) {
    var gitee = mirrorUrl(asset, "gitee");
    var github = asset.url || null;
    if (mirror === "gitee") {
      return gitee ? { host: "gitee", url: gitee } : { host: "github", url: github };
    }
    if (mirror === "github") {
      return github ? { host: "github", url: github } : { host: "gitee", url: gitee };
    }
    return gitee ? { host: "gitee", url: gitee } : { host: "github", url: github };
  }

  /** 另一条线路的地址（没有、或与主地址相同就返回 null） */
  function pickAlt(asset, primary) {
    var otherHost = primary.host === "gitee" ? "github" : "gitee";
    var url = otherHost === "gitee" ? mirrorUrl(asset, "gitee") : asset.url || null;
    if (!url || url === primary.url) return null;
    return { host: otherHost, url: url };
  }

  /** 发布页链接：GitHub 一定有（本地条目除外），Gitee 有镜像才显示 */
  function releaseLinksHtml(release) {
    if (release.source === "local") return "<span>本地文件</span>";
    var parts = [
      '<a href="' +
        esc(releaseUrl(release)) +
        '" target="_blank" rel="noopener noreferrer">GitHub ↗</a>',
    ];
    var gitee = release.mirrors && release.mirrors.gitee && release.mirrors.gitee.url;
    if (gitee) {
      parts.push(
        '<a href="' + esc(gitee) + '" target="_blank" rel="noopener noreferrer">Gitee ↗</a>'
      );
    }
    return parts.join('<span class="sep"></span>');
  }

  /* ------------------------------------------------- 本地手动上传的包
   * data/releases.json 里由管理后台上传的条目，结构比 Release 简单，
   * 这里转成同一套形状，和上游数据混排。 */

  function manualToRelease(item) {
    return {
      id: item.id,
      tag: item.tag,
      version: String(item.tag || "").replace(/^v/i, ""),
      channel: item.channel || "release",
      name: item.name || item.fileName,
      publishedAt: item.publishedAt,
      url: "",
      source: "local",
      assets: [
        {
          name: item.fileName,
          kind: item.kind === "tool" ? "tool" : "map",
          size: item.size || 0,
          downloads: 0,
          url: item.url,
        },
      ],
      notesHtml: item.notes ? "<p>" + esc(item.notes) + "</p>" : "",
      notesText: item.notes || "",
    };
  }

  function allReleases() {
    var upstream = DATA && Array.isArray(DATA.releases) ? DATA.releases : [];
    var local = LOCAL && Array.isArray(LOCAL.items) ? LOCAL.items : [];
    return local.map(manualToRelease).concat(upstream);
  }

  /** Release 标题通常以 Tag 开头（"v3.6 · 自定义屏…"），卡片左侧已经单独展示 Tag，这里去掉重复部分 */
  function displayName(release) {
    var name = String(release.name || "").trim();
    var tag = String(release.tag || "").trim();
    if (!name) return tag;
    if (!tag) return name;
    var safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var stripped = name.replace(new RegExp("^" + safeTag + "\\s*[·:：—–-]?\\s*", "i"), "").trim();
    return stripped || name;
  }

  function matchesQuery(release, q) {
    if (!q) return true;
    var hay = [
      release.tag,
      release.version,
      release.name,
      CHANNEL_LABEL[release.channel] || "",
      release.notesText || "",
      (release.assets || [])
        .map(function (a) {
          return a.name + " " + (a.kind === "tool" ? "jar 工具" : "zip 地图 整合包");
        })
        .join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /* --------------------------------------------------------------- render */
  function assetRow(asset, release) {
    var isTool = asset.kind === "tool";
    var label = isTool ? "下载 .jar" : "下载整合包";
    var kindText = isTool ? "工具 · 客户端 + 服务端" : "地图 · 整合包";

    var primary = pickPrimary(asset, state.mirror);
    var alt = pickAlt(asset, primary);

    var meta = [kindText];
    if (asset.size) meta.push(fmtBytes(asset.size));
    if (asset.downloads) meta.push("↓ " + asset.downloads);
    // 只有真的存在备用线路时才标注"经哪条线"，否则纯属噪音
    if (alt) meta.push("线路 " + hostLabel(primary.host));

    var isLocal = release.source === "local";

    return (
      '<div class="asset">' +
      '<div class="asset-kind" data-kind="' +
      esc(asset.kind) +
      '">' +
      (isTool ? "JAR" : "ZIP") +
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
      esc(primary.url || "#") +
      '" rel="noopener noreferrer" download>' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16" /></svg>' +
      label +
      "</a>" +
      (alt
        ? '<a class="btn btn-ghost btn-sm" href="' +
          esc(alt.url) +
          '" rel="noopener noreferrer" download title="换一条线路下载同一个文件">' +
          hostLabel(alt.host) +
          " 备用" +
          "</a>"
        : "") +
      (isLocal
        ? ""
        : '<a class="btn btn-ghost btn-sm" href="' +
          esc(releaseUrl(release)) +
          '" target="_blank" rel="noopener noreferrer" title="查看发布页">' +
          "发布页 ↗" +
          "</a>") +
      "</div>" +
      "</div>"
    );
  }

  function releaseCard(release, index) {
    var channel = release.channel || "release";
    var isLocal = release.source === "local";
    var latestTag = DATA && DATA.latest && DATA.latest.release ? DATA.latest.release.tag : null;
    var isLatest = !isLocal && latestTag === release.tag;

    var assets = (release.assets || []).filter(function (a) {
      if (state.type === "all") return a.kind === "tool" || a.kind === "map";
      return a.kind === state.type;
    });

    if (!assets.length) return "";

    var notesId = "notes-" + esc(release.tag).replace(/[^\w.-]/g, "-");
    var hasNotes = !!(release.notesHtml && release.notesHtml.trim());
    var openNotes = isLatest;

    var badges =
      '<span class="badge badge--' +
      (channel === "release" ? "release" : channel === "beta" ? "beta" : "preview") +
      '">' +
      '<span class="dot"></span>' +
      CHANNEL_LABEL[channel] +
      "</span>";
    if (isLatest) badges += '<span class="badge badge--muted">LATEST</span>';
    if (isLocal) badges += '<span class="badge badge--muted">LOCAL</span>';

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
      releaseLinksHtml(release) +
      "</div>" +
      "</div>" +
      '<div class="release-badges">' +
      badges +
      "</div>" +
      "</div>" +
      '<div class="asset-list">' +
      assets
        .map(function (a) {
          return assetRow(a, release);
        })
        .join("") +
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

  /* ---------------------------------------------------------------- stats */
  function computeCounts(releases) {
    var counts = { all: releases.length, release: 0, beta: 0, preview: 0 };
    releases.forEach(function (r) {
      if (counts[r.channel] != null) counts[r.channel]++;
    });
    return counts;
  }

  function updateCounts(releases) {
    var counts = computeCounts(releases);
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var key = el.getAttribute("data-count");
      if (counts[key] != null) el.textContent = String(counts[key]);
    });
  }

  /* --------------------------------------------------------------- render */
  function render() {
    var pool = allReleases();

    if (!pool.length) {
      if (resultLine) resultLine.textContent = "版本数据未能载入";
      listEl.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.querySelector("h3").textContent = "版本数据载入失败";
        emptyEl.querySelector("p").textContent =
          "可能是数据文件缺失或未生成。请稍后重试，或直接前往 GitHub / Gitee 的 Release 页面下载。";
        var resetBtn = document.getElementById("resetFilters");
        if (resetBtn) {
          resetBtn.textContent = "前往 GitHub Release";
          resetBtn.onclick = function () {
            window.open(
              "https://github.com/jiezhiyisichen/DFC-Map-Creation-Tool/releases",
              "_blank",
              "noopener"
            );
          };
        }
      }
      return;
    }

    var q = state.q.trim().toLowerCase();
    var filtered = pool.filter(function (r) {
      if (state.channel !== "all" && r.channel !== state.channel) return false;
      if (state.type !== "all" && !firstAsset(r, state.type)) return false;
      return matchesQuery(r, q);
    });

    var html = filtered.map(releaseCard).join("");
    // releaseCard returns "" when a release has no assets of the requested type
    var visible = filtered.filter(function (r) {
      return state.type === "all" || !!firstAsset(r, state.type);
    });

    listEl.innerHTML = html;

    if (!html) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      if (resultLine) resultLine.textContent = "没有匹配的版本";
    } else {
      if (emptyEl) emptyEl.hidden = true;
      if (resultLine) {
        var assetCount = visible.reduce(function (sum, r) {
          return (
            sum +
            (r.assets || []).filter(function (a) {
              if (state.type === "all") return a.kind === "tool" || a.kind === "map";
              return a.kind === state.type;
            }).length
          );
        }, 0);
        resultLine.textContent =
          "共 " + visible.length + " 个版本 · " + assetCount + " 个可下载文件" + (q ? " · 关键词「" + state.q.trim() + "」" : "");
      }
    }

    bindNotes();
  }

  function bindNotes() {
    listEl.querySelectorAll(".notes-toggle").forEach(function (btn) {
      var body = document.getElementById(btn.getAttribute("aria-controls"));
      if (body && body.classList.contains("is-open") && body.scrollHeight > body.clientHeight + 4) {
        body.classList.add("is-scroll");
      }
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        var label = btn.querySelector("span");
        if (label) label.textContent = open ? "查看更新内容" : "收起更新内容";
        if (body) {
          body.classList.toggle("is-open", !open);
          if (!open && body.scrollHeight > body.clientHeight + 4) {
            body.classList.add("is-scroll");
          }
        }
      });
    });
  }

  /* --------------------------------------------------------------- filters */
  function syncUrl() {
    var params = new URLSearchParams();
    if (state.channel !== "all") params.set("channel", state.channel);
    if (state.type !== "all") params.set("type", state.type);
    if (state.mirror !== "auto") params.set("mirror", state.mirror);
    if (state.q.trim()) params.set("q", state.q.trim());
    var qs = params.toString();
    var url = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    try {
      window.history.replaceState(null, "", url);
    } catch (e) {
      /* file:// may throw — ignore */
    }
  }

  function applyChips() {
    document.querySelectorAll("[data-filter]").forEach(function (btn) {
      var key = btn.getAttribute("data-filter");
      var val = btn.getAttribute("data-value");
      btn.classList.toggle("is-on", state[key] === val);
      btn.setAttribute("aria-pressed", state[key] === val ? "true" : "false");
    });
  }

  function bindFilters() {
    document.querySelectorAll("[data-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-filter");
        state[key] = btn.getAttribute("data-value");
        if (key === "mirror") saveMirror(state.mirror);
        applyChips();
        render();
        syncUrl();
      });
    });

    if (qInput) {
      var timer = null;
      qInput.addEventListener("input", function () {
        state.q = qInput.value;
        if (searchWrap) searchWrap.classList.toggle("has-value", !!qInput.value);
        clearTimeout(timer);
        timer = setTimeout(function () {
          render();
          syncUrl();
        }, 120);
      });

      qInput.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          qInput.value = "";
          state.q = "";
          if (searchWrap) searchWrap.classList.remove("has-value");
          render();
          syncUrl();
        }
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "/" && document.activeElement !== qInput) {
          e.preventDefault();
          qInput.focus();
        }
      });
    }

    if (qClear) {
      qClear.addEventListener("click", function () {
        qInput.value = "";
        state.q = "";
        if (searchWrap) searchWrap.classList.remove("has-value");
        qInput.focus();
        render();
        syncUrl();
      });
    }

    var reset = document.getElementById("resetFilters");
    if (reset) {
      reset.addEventListener("click", function () {
        state.channel = "all";
        state.type = "all";
        state.q = "";
        if (qInput) qInput.value = "";
        if (searchWrap) searchWrap.classList.remove("has-value");
        applyChips();
        render();
        syncUrl();
      });
    }
  }

  function readUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var ch = params.get("channel");
      var tp = params.get("type");
      var q = params.get("q");
      var mh = params.get("mirror");
      if (ch === "release" || ch === "beta" || ch === "preview") state.channel = ch;
      if (tp === "tool" || tp === "map") state.type = tp;
      if (mh === "gitee" || mh === "github" || mh === "auto") state.mirror = mh;
      if (q) {
        state.q = q;
        if (qInput) {
          qInput.value = q;
          if (searchWrap) searchWrap.classList.add("has-value");
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    updateCounts(allReleases());
    readUrl();
    applyChips();
    bindFilters();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
