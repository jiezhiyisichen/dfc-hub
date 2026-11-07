/* ==========================================================================
   HBM-DFC 圈下载站 — 下载中心
   一个页面管所有：本体（JiezhiMod）+ 各附属 mod。
   数据来自 assets/data/releases.js（window.__DFC_DATA__）与 assets/data/mods.js
   （window.__DFC_MODS__），都由 Actions 定时重新生成。
   ========================================================================== */
(function () {
  "use strict";

  var BASE = window.__DFC_DATA__ || null;
  var LOCAL = window.__DFC_LOCAL__ || null;
  var MODS = window.__DFC_MODS__ || null;

  var listEl = document.getElementById("releaseList");
  var emptyEl = document.getElementById("emptyState");
  var resultLine = document.querySelector("[data-result-line]");
  var searchWrap = document.getElementById("searchWrap");
  var qInput = document.getElementById("q");
  var qClear = document.getElementById("qClear");
  var tabsEl = document.getElementById("modTabs");
  var boardEl = document.getElementById("versionBoard");
  var infoEl = document.getElementById("modInfo");

  if (!listEl) return;

  var CHANNEL_LABEL = { release: "正式版", beta: "测试版", preview: "预览版" };
  var PLATFORM_LABEL = { gitee: "Gitee", github: "GitHub" };
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
    mod: "jiezhimod",
    channel: "all",
    nature: "all",
    type: "all",
    q: "",
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

  function fmtNum(n) {
    if (typeof n !== "number") return "";
    return n.toLocaleString("zh-CN");
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

  /* ---------------------------------------------------------------- 模型
   * 本体和附属最后都归一成同一个形状：
   *   { id, name, sub, star, isBase, releases[], latest, desc, params, platform, repoUrl, homepage }
   * 这样列表、筛选、卡片渲染只写一套。 */

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
      downloads: null,
      assets: [
        {
          name: item.fileName,
          kind: item.kind === "tool" ? "tool" : "map",
          size: item.size || 0,
          downloads: null,
          url: item.url,
        },
      ],
      notesHtml: item.notes ? "<p>" + esc(item.notes) + "</p>" : "",
      notesText: item.notes || "",
    };
  }

  /** 附属的附件类型叫 mod / pack，本体的叫 tool / map，这里统一 */
  function normalizeModRelease(r) {
    return {
      id: r.id,
      tag: r.tag,
      version: r.version,
      channel: r.channel || "release",
      name: r.name,
      publishedAt: r.publishedAt,
      url: r.url,
      source: "mod",
      hotfix: !!r.hotfix,
      major: !!r.major,
      downloads: typeof r.downloads === "number" ? r.downloads : null,
      assets: (r.assets || []).map(function (a) {
        return {
          name: a.name,
          kind: a.kind === "mod" ? "tool" : a.kind === "pack" ? "map" : a.kind,
          size: a.size || 0,
          downloads: typeof a.downloads === "number" ? a.downloads : null,
          url: a.url,
          mirrors: a.mirrors || null,
        };
      }),
      notesHtml: r.notesHtml || "",
      notesText: r.notesText || "",
    };
  }

  function baseModel() {
    var upstream = BASE && Array.isArray(BASE.releases) ? BASE.releases : [];
    var local = LOCAL && Array.isArray(LOCAL.items) ? LOCAL.items : [];
    var latest = BASE && BASE.latest && BASE.latest.release ? BASE.latest.release : null;
    return {
      id: "jiezhimod",
      name: "JiezhiMod",
      sub: "本体",
      star: true,
      isBase: true,
      releases: local.map(manualToRelease).concat(upstream),
      latest: latest,
      desc: "节枝特效工具本体：特效指令、DFC 显示器、灯圈、红石工具。",
      params: null,
      platform: "github",
      repoUrl: "https://github.com/jiezhiyisichen/DFC-Map-Creation-Tool",
      homepage: "",
    };
  }

  function modModels() {
    var list = MODS && Array.isArray(MODS.mods) ? MODS.mods : [];
    return list.map(function (m) {
      return {
        id: m.id,
        name: m.name,
        sub: "",
        star: false,
        isBase: false,
        releases: (m.releases || []).map(normalizeModRelease),
        latest: m.latest || null,
        desc: m.desc || "",
        params: m,
        platform: m.platform,
        repoUrl: m.repoUrl,
        homepage: m.homepage || "",
        error: m.error || null,
      };
    });
  }

  function models() {
    return [baseModel()].concat(modModels());
  }

  function currentModel() {
    var all = models();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === state.mod) return all[i];
    }
    return all[0];
  }

  /** 该模组的下载合计；平台不给数字时返回 null（不是 0） */
  function modelDownloads(model) {
    var sum = 0;
    var counted = 0;
    (model.releases || []).forEach(function (r) {
      if (typeof r.downloads === "number") {
        sum += r.downloads;
        counted++;
        return;
      }
      (r.assets || []).forEach(function (a) {
        if (typeof a.downloads === "number") {
          sum += a.downloads;
          counted++;
        }
      });
    });
    if (!counted) return model.platform === "github" ? 0 : null;
    return sum;
  }

  /* --------------------------------------------------------------- 下载线路
   * 同一文件可能同时挂在 GitHub Release 和 Gitee 发行版：asset.url 是主源，
   * asset.mirrors[] 是备用线路。「自动」优先 Gitee（国内直连快）。 */
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

  function pickAlt(asset, primary) {
    var otherHost = primary.host === "gitee" ? "github" : "gitee";
    var url = otherHost === "gitee" ? mirrorUrl(asset, "gitee") : asset.url || null;
    if (!url || url === primary.url) return null;
    return { host: otherHost, url: url };
  }

  function releaseUrl(release) {
    if (release.source === "local") return "";
    return release.url || "";
  }

  function releaseLinksHtml(release, model) {
    if (release.source === "local") return "<span>本地文件</span>";
    if (release.source === "mod") {
      return (
        '<a href="' +
        esc(releaseUrl(release)) +
        '" target="_blank" rel="noopener noreferrer">' +
        (PLATFORM_LABEL[model.platform] || "发布页") +
        " 发布页 ↗</a>"
      );
    }
    var parts = [
      '<a href="' +
        esc(releaseUrl(release)) +
        '" target="_blank" rel="noopener noreferrer">GitHub ↗</a>',
    ];
    var gitee = release.mirrors && release.mirrors.gitee && release.mirrors.gitee.url;
    if (gitee) {
      parts.push('<a href="' + esc(gitee) + '" target="_blank" rel="noopener noreferrer">Gitee ↗</a>');
    }
    return parts.join('<span class="sep"></span>');
  }

  /** Release 标题常以 Tag 开头，卡片左侧已单独展示 Tag，这里去掉重复部分 */
  function displayName(release) {
    var name = String(release.name || "").trim();
    var tag = String(release.tag || "").trim();
    if (!name) return tag;
    if (!tag) return name;
    var safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var stripped = name.replace(new RegExp("^" + safeTag + "\\s*[·:：—–-]?\\s*", "i"), "").trim();
    var noVersion = stripped.replace(/^v?\d+(?:\.\d+)*(?=$|[\s·:：—–+,，、])[\s·:：—–+,，、]*/i, "").trim();
    if (noVersion) stripped = noVersion;
    return stripped || name;
  }

  function matchesQuery(release, q) {
    if (!q) return true;
    var hay = [
      release.tag,
      release.version,
      release.name,
      CHANNEL_LABEL[release.channel] || "",
      release.hotfix ? "紧急修复 紧急修复版 hotfix" : "",
      release.major ? "重大更新 重大版本 major" : "",
      release.notesText || "",
      (release.assets || [])
        .map(function (a) {
          return a.name + " " + (a.kind === "tool" ? "jar 模组 工具" : "zip 地图 整合包");
        })
        .join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /* --------------------------------------------------------------- render */
  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = models()
      .map(function (m) {
        var on = m.id === state.mod;
        var count = (m.releases || []).length;
        return (
          '<button class="mod-tab' +
          (on ? " is-on" : "") +
          (m.star ? " mod-tab--star" : "") +
          '" type="button" role="tab" data-mod-id="' +
          esc(m.id) +
          '" aria-selected="' +
          (on ? "true" : "false") +
          '">' +
          (m.star ? '<span class="star" aria-hidden="true">★</span>' : "") +
          esc(m.name) +
          (m.sub ? '<span class="mod-tab-sub">' + esc(m.sub) + "</span>" : "") +
          '<span class="n">' + count + "</span>" +
          "</button>"
        );
      })
      .join("");

    tabsEl.querySelectorAll("[data-mod-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectModel(btn.getAttribute("data-mod-id"));
      });
    });
  }

  function selectModel(id) {
    if (!id || id === state.mod) return;
    state.mod = id;
    /* 换模组等于换一池版本，筛选条件跟着清掉，免得看到空列表 */
    state.channel = "all";
    state.nature = "all";
    state.type = "all";
    state.q = "";
    if (qInput) qInput.value = "";
    if (searchWrap) searchWrap.classList.remove("has-value");
    applyChips();
    renderTabs();
    render();
    syncUrl();
  }

  function renderBoard(model) {
    if (!boardEl) return;
    boardEl.classList.toggle("is-mod", !model.isBase);

    var latest = model.latest;
    var setText = function (sel, text) {
      var el = boardEl.querySelector(sel);
      if (el) el.textContent = text;
    };

    setText("[data-board-label]", model.isBase ? "最新正式版" : "最新版本");
    setText("[data-latest-version]", latest ? latest.tag : "暂无");
    setText("[data-latest-date]", latest ? fmtDate(latest.publishedAt) : "");
    setText("[data-board-desc]", model.desc || "");

    var mapCell = boardEl.querySelector("[data-cell-map]");
    if (mapCell) mapCell.hidden = !model.isBase;

    var totalEl = boardEl.querySelector("[data-board-downloads]");
    if (totalEl) {
      var total = modelDownloads(model);
      totalEl.textContent =
        total == null ? "平台未统计下载次数" : "累计下载 " + fmtNum(total) + " 次";
    }
  }

  function renderParams(model) {
    if (!infoEl) return;
    if (model.isBase || !model.params) {
      infoEl.hidden = true;
      return;
    }
    infoEl.hidden = false;

    var p = model.params;
    var needsJz = !!p.requiresJiezhimod;
    var rows = [
      {
        k: "需要 JiezhiMod 作为前置",
        v: needsJz ? "是" : "否，可独立安装",
        cls: needsJz ? "is-yes" : "is-no",
      },
      { k: "前置模组", v: p.requires || (needsJz ? "节枝特效工具（JiezhiMod）" : "无") },
      { k: "游戏版本", v: "Minecraft " + (p.minecraft || "1.12.2") },
      { k: "模组加载器", v: p.loader || "Forge 14.23.5.2864" },
      { k: "开源许可", v: p.license || "见仓库" },
    ];

    var body = infoEl.querySelector("[data-mod-spec]");
    if (body) {
      body.innerHTML = rows
        .map(function (r) {
          return (
            '<tr><th scope="row">' +
            esc(r.k) +
            "</th><td" +
            (r.cls ? ' class="' + r.cls + '"' : "") +
            ">" +
            esc(r.v) +
            "</td></tr>"
          );
        })
        .join("");
    }

    var hint = infoEl.querySelector("[data-mod-hint]");
    if (hint) {
      hint.textContent = p.hint || "";
      hint.hidden = !p.hint;
    }

    var repo = infoEl.querySelector("[data-mod-links]");
    if (repo) {
      var links = [];
      if (model.repoUrl) {
        links.push(
          '<a href="' +
            esc(model.repoUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            (PLATFORM_LABEL[model.platform] || "仓库") +
            " 仓库 ↗</a>"
        );
      }
      /* 有的仓库把 homepage 填成了本站旧地址，那不叫官网，跳过去只会绕圈 */
      if (model.homepage && !/dfc-hub\.pages\.dev|\/mods/i.test(model.homepage)) {
        links.push(
          '<a href="' + esc(model.homepage) + '" target="_blank" rel="noopener noreferrer">官网 ↗</a>'
        );
      }
      repo.innerHTML = links.join("");
      repo.hidden = !links.length;
    }
  }

  /** 附属没有紧急修复 / 重大更新 / 镜像线路这些概念，对应的筛选组直接隐藏 */
  function renderFilterVisibility(model) {
    document.querySelectorAll("[data-only-base]").forEach(function (el) {
      el.hidden = !model.isBase;
    });
  }

  function assetRow(asset, release, model) {
    var isTool = asset.kind === "tool";
    var label = isTool ? "下载 .jar" : "下载整合包";
    var kindText = isTool
      ? model.isBase
        ? "工具 · 客户端 + 服务端"
        : "模组 jar"
      : "地图 · 整合包";

    var primary = pickPrimary(asset, state.mirror);
    var alt = pickAlt(asset, primary);

    var meta = [kindText];
    if (asset.size) meta.push(fmtBytes(asset.size));
    if (typeof asset.downloads === "number") meta.push("已下载 " + fmtNum(asset.downloads) + " 次");
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
          " 备用</a>"
        : "") +
      (isLocal
        ? ""
        : '<a class="btn btn-ghost btn-sm" href="' +
          esc(releaseUrl(release)) +
          '" target="_blank" rel="noopener noreferrer" title="查看发布页">发布页 ↗</a>') +
      "</div>" +
      "</div>"
    );
  }

  function releaseCard(release, model, isLatest) {
    var channel = release.channel || "release";
    var isLocal = release.source === "local";

    var assets = (release.assets || []).filter(function (a) {
      if (state.type === "all") return a.kind === "tool" || a.kind === "map";
      return a.kind === state.type;
    });

    if (!assets.length) return "";

    var notesId = "notes-" + esc(release.tag).replace(/[^\w.-]/g, "-");
    var hasNotes = !!(release.notesHtml && release.notesHtml.trim());
    var openNotes = isLatest;

    var badges = "";
    if (release.hotfix) {
      badges +=
        '<span class="badge badge--hotfix" title="包含重大紧急 bug 的修复，可与任意通道叠加">' +
        '<span class="dot"></span>紧急修复</span>';
    }
    if (release.major) {
      badges +=
        '<span class="badge badge--major" title="重大更新，只与正式版一起出现">' +
        '<span class="dot"></span>重大更新</span>';
    }
    badges +=
      '<span class="badge badge--' +
      (channel === "release" ? "release" : channel === "beta" ? "beta" : "preview") +
      '"><span class="dot"></span>' +
      CHANNEL_LABEL[channel] +
      "</span>";
    if (isLatest) badges += '<span class="badge badge--muted">最新</span>';
    if (isLocal) badges += '<span class="badge badge--muted">本站上传</span>';

    var totalSize = assets.reduce(function (sum, a) {
      return sum + (a.size || 0);
    }, 0);
    var dl = typeof release.downloads === "number" ? release.downloads : null;

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
      (dl != null ? '<span class="sep"></span><span>下载 ' + fmtNum(dl) + " 次</span>" : "") +
      '<span class="sep"></span>' +
      releaseLinksHtml(release, model) +
      "</div>" +
      "</div>" +
      '<div class="release-badges">' +
      badges +
      "</div>" +
      "</div>" +
      '<div class="asset-list">' +
      assets
        .map(function (a) {
          return assetRow(a, release, model);
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
    var counts = { all: releases.length, release: 0, beta: 0, preview: 0, hotfix: 0, major: 0 };
    releases.forEach(function (r) {
      if (counts[r.channel] != null) counts[r.channel]++;
      if (r.hotfix) counts.hotfix++;
      if (r.major) counts.major++;
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
    var model = currentModel();
    var pool = model.releases || [];

    renderTabs();
    renderBoard(model);
    renderParams(model);
    renderFilterVisibility(model);
    updateCounts(pool);

    if (!pool.length) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      if (resultLine) {
        resultLine.textContent = model.error
          ? model.name + "：取不到版本数据（" + model.error + "），可以直接去发布页看"
          : "还没拿到版本数据，稍后重试或直接去发布页";
      }
      return;
    }

    var q = state.q.trim().toLowerCase();
    var filtered = pool.filter(function (r) {
      if (state.channel !== "all" && r.channel !== state.channel) return false;
      if (state.nature === "hotfix" && !r.hotfix) return false;
      if (state.nature === "major" && !r.major) return false;
      if (state.type !== "all" && !firstAsset(r, state.type)) return false;
      return matchesQuery(r, q);
    });

    var latestTag = model.latest ? model.latest.tag : null;
    var html = filtered
      .map(function (r) {
        return releaseCard(r, model, !!latestTag && r.tag === latestTag);
      })
      .join("");

    listEl.innerHTML = html;

    if (!html) {
      if (emptyEl) emptyEl.hidden = false;
      if (resultLine) resultLine.textContent = "没有匹配的版本";
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (resultLine) {
      var visible = filtered.filter(function (r) {
        return state.type === "all" || !!firstAsset(r, state.type);
      });
      var assetCount = visible.reduce(function (sum, r) {
        return (
          sum +
          (r.assets || []).filter(function (a) {
            if (state.type === "all") return a.kind === "tool" || a.kind === "map";
            return a.kind === state.type;
          }).length
        );
      }, 0);
      var total = modelDownloads(model);
      resultLine.textContent =
        "共 " + visible.length + " 个版本 · " + assetCount + " 个文件" +
        (total == null ? " · 该平台不提供下载次数" : " · 累计下载 " + fmtNum(total) + " 次") +
        (q ? " · 关键词「" + state.q.trim() + "」" : "");
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
    if (state.mod !== "jiezhimod") params.set("mod", state.mod);
    if (state.channel !== "all") params.set("channel", state.channel);
    if (state.nature !== "all") params.set("nature", state.nature);
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
        state.nature = "all";
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
      var md = params.get("mod");
      if (md) state.mod = md;
      var ch = params.get("channel");
      var tp = params.get("type");
      var q = params.get("q");
      var mh = params.get("mirror");
      if (ch === "release" || ch === "beta" || ch === "preview") state.channel = ch;
      var nt = params.get("nature");
      if (nt === "hotfix" || nt === "major") state.nature = nt;
      if (params.get("hotfix") === "1") state.nature = "hotfix";
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

  /* 供「手动刷新数据」按钮调用：拉到新数据后就地重渲染，不用刷新整页 */
  window.__DFC_RERENDER__ = function () {
    applyChips();
    render();
  };
})();
