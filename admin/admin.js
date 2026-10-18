/* ==========================================================================
   DFC Hub admin — 前端逻辑（原生 JS，无依赖）
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };

  var state = {
    config: null,
    releases: { items: [] },
    status: null,
    limits: { maxUploadMb: 100, pagesLimitMb: 25 },
    dirtyConfig: false,
  };

  var SECTION_TITLES = {
    site: "站点与品牌",
    hero: "首页首屏",
    video: "视频区",
    downloadsPage: "下载页",
    footer: "页脚",
    links: "链接",
  };

  var FIELD_LABELS = {
    "site.title": "页面标题",
    "site.description": "页面描述（搜索引擎用）",
    "site.brandName": "站点名（导航左侧）",
    "site.brandSub": "站点副标题",
    "site.tickerBadge": "顶部信息条徽章",
    "site.tickerLabel": "顶部信息条文案",
    "site.tickerNote": "顶部同步说明",
    "site.tickerLinkText": "顶部信息条链接文字",
    "hero.tag": "首屏小标签",
    "hero.title": "首屏大标题",
    "hero.lede": "首屏说明",
    "hero.primaryText": "主按钮文字",
    "hero.secondaryText": "次按钮文字",
    "hero.mapLink": "地图网盘链接文字",
    "video.title": "视频封面标题",
    "video.sub": "视频封面副标题",
    "video.upName": "UP 主说明",
    "video.externalText": "外部链接文字",
    "downloadsPage.title": "下载页标题",
    "downloadsPage.lede": "下载页说明",
    "downloadsPage.boardLatest": "看板 · 最新正式版",
    "downloadsPage.boardMap": "看板 · 地图整合包",
    "downloadsPage.boardSync": "看板 · 数据同步",
    "downloadsPage.boardSyncNote": "看板 · 同步说明",
    "downloadsPage.mapCta": "地图按钮文字",
    "downloadsPage.mapNote": "地图按钮说明",
    "downloadsPage.installEyebrow": "安装区小标签",
    "downloadsPage.installTitle": "安装区标题",
    "downloadsPage.installSub": "安装区说明",
    "footer.note": "页脚简介",
    "footer.copyright": "版权文字",
    "footer.navTitle": "页脚 · 导航列标题",
    "footer.resourcesTitle": "页脚 · 资源列标题",
    "links.bilibiliSpace": "B 站个人空间",
    "links.video": "宣传视频地址",
    "links.toolRepo": "工具仓库",
    "links.toolReleases": "全部 Release",
    "links.toolDocs": "使用文档",
    "links.siteRepo": "站点仓库",
    "links.mapPan": "地图整合包网盘链接",
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
    var n = Number(bytes);
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var p = function (v) {
      return String(v).padStart(2, "0");
    };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function toast(message, kind) {
    var el = $("#toast");
    el.textContent = message;
    el.className = "toast is-on" + (kind ? " is-" + kind : "");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      el.className = "toast";
    }, 3200);
  }

  async function api(url, options) {
    var res = await fetch(url, options);
    var data = null;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: "返回内容不是 JSON" };
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "请求失败：" + res.status);
    }
    return data;
  }

  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) {
      return o == null ? null : o[k];
    }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split(".");
    var target = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (target[keys[i]] == null || typeof target[keys[i]] !== "object") target[keys[i]] = {};
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
  }

  /* ---------------------------------------------------------------- boot */

  async function load() {
    try {
      var data = await api("/api/bootstrap");
      state.config = data.config || {};
      state.releases = data.releases || { items: [] };
      state.status = data.status || null;
      state.limits = data.limits || state.limits;
      state.dirtyConfig = false;

      renderStatus();
      renderConfig(state.config);
      renderPackages(state.releases.items || []);
      renderGitFiles(state.status);
      setConfigHint("尚未修改");
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* -------------------------------------------------------------- status */

  function renderStatus() {
    var s = state.status || {};
    $("#chipBranch").textContent = s.branch || "main";
    $("#chipCommit").textContent = s.lastCommit ? s.lastCommit.slice(0, 42) : "—";

    var dirty = $("#chipDirty");
    if (s.dirty) {
      dirty.textContent = (s.files || []).length + " 个改动未发布";
      dirty.className = "chip is-dirty";
    } else {
      dirty.textContent = "工作区干净";
      dirty.className = "chip is-clean";
    }
  }

  function renderGitFiles(status) {
    var root = $("#gitFiles");
    var files = (status && status.files) || [];
    if (!files.length) {
      root.innerHTML = '<div class="empty">没有待提交的改动。改完文案或上传包之后，这里会列出来。</div>';
      return;
    }

    root.innerHTML = files
      .map(function (f) {
        var cls = "";
        if (f.code.indexOf("A") === 0 || f.code === "??") cls = " is-add";
        if (f.code.indexOf("D") === 0) cls = " is-del";
        return (
          '<div class="git-file' +
          cls +
          '"><b>' +
          esc(f.code || "M") +
          "</b><span>" +
          esc(f.path) +
          "</span></div>"
        );
      })
      .join("");
  }

  /* ---------------------------------------------------------- config form */

  function fieldHtml(path, value) {
    var label = FIELD_LABELS[path] || path;
    var isLong =
      typeof value === "string" &&
      (value.length > 55 || /lede|description|note|copyright|\.sub$|installSub/i.test(path));
    var isLink = /^links\./.test(path);

    return (
      '<label class="field' +
      (isLong ? " is-wide" : "") +
      '">' +
      "<span>" +
      esc(label) +
      " <em>" +
      esc(path) +
      "</em></span>" +
      (isLong
        ? '<textarea rows="3" data-path="' + esc(path) + '">' + esc(value) + "</textarea>"
        : '<input type="' +
          (isLink ? "url" : "text") +
          '" data-path="' +
          esc(path) +
          '" value="' +
          esc(value) +
          '" />') +
      "</label>"
    );
  }

  function stepsHtml(path, steps) {
    var rows = (steps || [])
      .map(function (step) {
        return (
          '<div class="step-row">' +
          '<textarea rows="2" data-step-title placeholder="小标题">' +
          esc(step.title || "") +
          "</textarea>" +
          '<textarea rows="2" data-step-text placeholder="说明文字，可用 [c]代码[/c] 标记">' +
          esc(step.text || "") +
          "</textarea>" +
          '<button class="btn btn-danger btn-xs" type="button" data-remove-step>删除</button>' +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="field is-wide">' +
      "<span>安装步骤 <em>" +
      esc(path) +
      "</em></span>" +
      '<div class="steps-editor" data-steps="' +
      esc(path) +
      '">' +
      rows +
      "</div>" +
      '<div><button class="btn btn-quiet btn-xs" type="button" data-add-step style="margin-top:8px">+ 添加一步</button></div>' +
      "</div>"
    );
  }

  function sectionHtml(key, obj) {
    var fields = Object.keys(obj)
      .map(function (field) {
        var path = key + "." + field;
        var value = obj[field];
        if (Array.isArray(value)) return stepsHtml(path, value);
        if (value && typeof value === "object") return "";
        return fieldHtml(path, value);
      })
      .join("");

    return (
      '<section class="form-section" data-section="' +
      esc(key) +
      '">' +
      "<header><h2>" +
      esc(SECTION_TITLES[key] || key) +
      "</h2><span>" +
      esc(key) +
      "</span></header>" +
      '<div class="fields">' +
      fields +
      "</div>" +
      "</section>"
    );
  }

  function renderConfig(config) {
    var root = $("#configForm");
    var order = ["site", "hero", "video", "downloadsPage", "footer", "links"];
    var keys = order
      .filter(function (k) {
        return config[k] && typeof config[k] === "object";
      })
      .concat(
        Object.keys(config).filter(function (k) {
          return order.indexOf(k) === -1 && config[k] && typeof config[k] === "object";
        })
      );

    if (!keys.length) {
      root.innerHTML = '<div class="empty">data/config.json 还没有内容。</div>';
      return;
    }

    root.innerHTML = keys
      .map(function (k) {
        return sectionHtml(k, config[k]);
      })
      .join("");

    bindConfigEvents();
  }

  function bindConfigEvents() {
    var root = $("#configForm");

    root.addEventListener("input", function () {
      setConfigHint("有未保存的修改");
    });

    root.addEventListener("click", function (e) {
      var addBtn = e.target.closest("[data-add-step]");
      if (addBtn) {
        var editor = addBtn.closest(".field").querySelector(".steps-editor");
        var row = document.createElement("div");
        row.className = "step-row";
        row.innerHTML =
          '<textarea rows="2" data-step-title placeholder="小标题"></textarea>' +
          '<textarea rows="2" data-step-text placeholder="说明文字，可用 [c]代码[/c] 标记"></textarea>' +
          '<button class="btn btn-danger btn-xs" type="button" data-remove-step>删除</button>';
        editor.appendChild(row);
        setConfigHint("有未保存的修改");
        return;
      }

      var removeBtn = e.target.closest("[data-remove-step]");
      if (removeBtn) {
        removeBtn.closest(".step-row").remove();
        setConfigHint("有未保存的修改");
      }
    });
  }

  function collectConfig() {
    var config = JSON.parse(JSON.stringify(state.config || {}));

    $("#configForm")
      .querySelectorAll("[data-path]")
      .forEach(function (el) {
        setPath(config, el.getAttribute("data-path"), el.value);
      });

    $("#configForm")
      .querySelectorAll("[data-steps]")
      .forEach(function (editor) {
        var path = editor.getAttribute("data-steps");
        var steps = Array.prototype.map
          .call(editor.querySelectorAll(".step-row"), function (row) {
            return {
              title: row.querySelector("[data-step-title]").value.trim(),
              text: row.querySelector("[data-step-text]").value.trim(),
            };
          })
          .filter(function (s) {
            return s.title || s.text;
          });
        setPath(config, path, steps);
      });

    return config;
  }

  function setConfigHint(text) {
    var el = $("#configHint");
    el.textContent = text;
    el.className = "hint" + (/未保存/.test(text) ? " is-err" : "");
  }

  async function saveConfig() {
    var buttons = [$("#btnSaveConfig"), $("#btnSaveConfigBottom")];
    buttons.forEach(function (b) {
      b.disabled = true;
      b.textContent = "保存中…";
    });

    try {
      var config = collectConfig();
      var data = await api("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      state.config = data.config;
      setConfigHint("已保存");
      toast("文案已保存，刷新预览即可看到", "ok");
      refreshStatus();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      buttons[0].disabled = false;
      buttons[0].textContent = "保存文案";
      buttons[1].disabled = false;
      buttons[1].textContent = "保存文案";
    }
  }

  /* ------------------------------------------------------------- packages */

  function renderPackages(items) {
    var root = $("#pkgList");
    $("#pkgCount").textContent = items.length + " 项";

    if (!items.length) {
      root.innerHTML =
        '<div class="empty">还没有本地包。左侧上传一个 .jar 或 .zip，它会立刻出现在下载中心。</div>';
      return;
    }

    root.innerHTML = items
      .map(function (item) {
        var isMap = item.kind === "map";
        return (
          '<div class="pkg" data-id="' +
          esc(item.id) +
          '">' +
          '<div class="pkg-top">' +
          '<span class="pkg-kind' +
          (isMap ? " is-map" : "") +
          '">' +
          (isMap ? "ZIP" : "JAR") +
          "</span>" +
          '<span class="pkg-name">' +
          esc(item.name || item.fileName) +
          "</span>" +
          "</div>" +
          '<div class="pkg-meta">' +
          "<span>" +
          esc(item.tag) +
          "</span>" +
          "<span>" +
          esc(channelLabel(item.channel)) +
          "</span>" +
          "<span>" +
          esc(fmtBytes(item.size)) +
          "</span>" +
          "<span>" +
          esc(fmtDate(item.publishedAt)) +
          "</span>" +
          "</div>" +
          '<div class="pkg-meta"><span>' +
          esc(item.fileName) +
          "</span></div>" +
          '<div class="pkg-actions">' +
          '<a class="btn btn-quiet btn-xs" href="/' +
          esc(item.url) +
          '" target="_blank" rel="noopener">查看文件</a>' +
          '<button class="btn btn-quiet btn-xs" type="button" data-edit>编辑</button>' +
          '<button class="btn btn-danger btn-xs" type="button" data-delete>删除</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    bindPackages();
  }

  function channelLabel(channel) {
    return channel === "beta" ? "测试版" : channel === "preview" ? "预览版" : "正式版";
  }

  function bindPackages() {
    var root = $("#pkgList");

    root.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var pkg = btn.closest(".pkg");
        var id = pkg.getAttribute("data-id");
        if (!confirm("删除这条发布记录？\n\n点确定只删记录，文件保留在 public/downloads/。")) return;
        try {
          var data = await api("/api/releases/" + encodeURIComponent(id), { method: "DELETE" });
          state.releases = data.data;
          renderPackages(data.data.items || []);
          toast("条目已删除", "ok");
          refreshStatus();
        } catch (err) {
          toast(err.message, "err");
        }
      });
    });

    root.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pkg = btn.closest(".pkg");
        var id = pkg.getAttribute("data-id");
        var item = (state.releases.items || []).find(function (it) {
          return it.id === id;
        });
        if (item) editPackage(pkg, item);
      });
    });
  }

  function editPackage(pkgEl, item) {
    pkgEl.innerHTML =
      '<div class="stack">' +
      '<div class="row">' +
      '<label class="field"><span>版本号 / Tag</span><input type="text" data-edit-tag value="' +
      esc(item.tag) +
      '" /></label>' +
      '<label class="field"><span>通道</span><select data-edit-channel>' +
      '<option value="release"' +
      (item.channel === "release" ? " selected" : "") +
      ">正式版</option>" +
      '<option value="beta"' +
      (item.channel === "beta" ? " selected" : "") +
      ">测试版</option>" +
      '<option value="preview"' +
      (item.channel === "preview" ? " selected" : "") +
      ">预览版</option>" +
      "</select></label>" +
      "</div>" +
      '<label class="field"><span>显示名称</span><input type="text" data-edit-name value="' +
      esc(item.name) +
      '" /></label>' +
      '<label class="field"><span>更新说明</span><textarea rows="2" data-edit-notes>' +
      esc(item.notes || "") +
      "</textarea></label>" +
      '<div class="form-actions">' +
      '<button class="btn btn-primary btn-xs" type="button" data-save-edit>保存</button>' +
      '<button class="btn btn-quiet btn-xs" type="button" data-cancel-edit>取消</button>' +
      "</div>" +
      "</div>";

    pkgEl.querySelector("[data-cancel-edit]").addEventListener("click", function () {
      renderPackages(state.releases.items || []);
    });

    pkgEl.querySelector("[data-save-edit]").addEventListener("click", async function () {
      var payload = {
        tag: pkgEl.querySelector("[data-edit-tag]").value,
        name: pkgEl.querySelector("[data-edit-name]").value,
        channel: pkgEl.querySelector("[data-edit-channel]").value,
        notes: pkgEl.querySelector("[data-edit-notes]").value,
      };
      try {
        var data = await api("/api/releases/" + encodeURIComponent(item.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        state.releases = data.data;
        renderPackages(data.data.items || []);
        toast("已保存", "ok");
        refreshStatus();
      } catch (err) {
        toast(err.message, "err");
      }
    });
  }

  /* --------------------------------------------------------------- upload */

  function bindUpload() {
    var form = $("#pkgForm");
    var input = $("#pkgFile");
    var drop = $("#dropZone");
    var title = $("#dropTitle");
    var sub = $("#dropSub");
    var hint = $("#pkgHint");

    function showFile(file) {
      if (!file) {
        title.textContent = "点击选择，或把 .jar / .zip 拖到这里";
        sub.textContent = "单个文件上限 " + state.limits.maxUploadMb + "MB · 建议不超过 " + state.limits.pagesLimitMb + "MB";
        return;
      }
      title.textContent = file.name;
      var over = file.size > state.limits.pagesLimitMb * 1024 * 1024;
      sub.textContent = fmtBytes(file.size) + (over ? " · 超过 " + state.limits.pagesLimitMb + "MB，Pages 可能拒绝部署" : "");
      sub.style.color = over ? "var(--amber)" : "";
    }

    input.addEventListener("change", function () {
      showFile(input.files[0]);
    });

    ["dragenter", "dragover"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.add("is-over");
      });
    });

    ["dragleave", "drop"].forEach(function (type) {
      drop.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.remove("is-over");
      });
    });

    drop.addEventListener("drop", function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      showFile(file);

      if (!/\.(jar|zip)$/i.test(file.name)) {
        toast("只支持 .jar / .zip", "err");
      }
      if (!$("#pkgName").value) {
        $("#pkgName").value = file.name.replace(/\.(jar|zip)$/i, "");
      }
    });

    input.addEventListener("change", function () {
      var file = input.files[0];
      if (file && !$("#pkgName").value) {
        $("#pkgName").value = file.name.replace(/\.(jar|zip)$/i, "");
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var file = input.files[0];
      var tag = $("#pkgTag").value.trim();
      if (!file) return toast("先选一个 .jar 或 .zip 文件", "err");
      if (!tag) return toast("填一下版本号，例如 v1.0", "err");

      var fd = new FormData();
      fd.append("file", file);
      fd.append("tag", tag);
      fd.append("name", $("#pkgName").value.trim());
      fd.append("channel", $("#pkgChannel").value);
      fd.append("notes", $("#pkgNotes").value.trim());

      var btn = $("#btnUpload");
      btn.disabled = true;
      btn.textContent = "上传中 0%";

      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/releases");

      xhr.upload.onprogress = function (ev) {
        if (!ev.lengthComputable) return;
        btn.textContent = "上传中 " + Math.round((ev.loaded / ev.total) * 100) + "%";
      };

      xhr.onload = function () {
        btn.disabled = false;
        btn.textContent = "上传并记入清单";

        var data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }

        if (!data || data.ok === false) {
          toast((data && data.error) || "上传失败：" + xhr.status, "err");
          return;
        }

        state.releases = data.data;
        renderPackages(data.data.items || []);
        form.reset();
        showFile(null);
        hint.textContent = "已上传 " + data.item.fileName;
        hint.className = "hint is-ok";
        toast(data.warning || "上传成功，记得点「发布上线」", data.warning ? "err" : "ok");
        refreshStatus();
      };

      xhr.onerror = function () {
        btn.disabled = false;
        btn.textContent = "上传并记入清单";
        toast("网络中断，上传失败", "err");
      };

      xhr.send(fd);
    });
  }

  /* -------------------------------------------------------------- publish */

  function log(text, cls) {
    var pre = $("#publishLog");
    if (pre.textContent === "等待操作…") pre.textContent = "";
    var line = document.createElement("span");
    if (cls) line.className = cls;
    line.textContent = text + "\n";
    pre.appendChild(line);
    pre.scrollTop = pre.scrollHeight;
  }

  async function publish() {
    var btn = $("#btnPublish");
    btn.disabled = true;
    btn.textContent = "发布中…";
    $("#publishLog").textContent = "";
    log("开始发布…");

    try {
      var data = await api("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: $("#commitMsg").value }),
      });

      (data.steps || []).forEach(function (s) {
        log("[" + s.step + "] " + s.text);
      });

      if (data.nothingToDo) {
        log("没有需要发布的内容。", "ok");
        toast("工作区没有变更", "err");
      } else {
        log("✔ 推送完成，Actions 正在构建，1–2 分钟后上线。", "ok");
        toast("已推送，等待 Actions 部署", "ok");
      }

      await refreshStatus();
    } catch (err) {
      log("✘ " + err.message, "err");
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "发布上线";
    }
  }

  async function syncUpstream() {
    var btn = $("#btnSync");
    btn.disabled = true;
    btn.textContent = "同步中…";
    log("$ node scripts/sync-releases.mjs");

    try {
      var data = await api("/api/sync", { method: "POST" });
      log(data.output || "(无输出)", data.ok ? "ok" : "err");
      toast(data.ok ? "已刷新上游 Release" : "同步失败", data.ok ? "ok" : "err");
      await refreshStatus();
    } catch (err) {
      log("✘ " + err.message, "err");
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "刷新上游 Release";
    }
  }

  async function refreshStatus() {
    try {
      var data = await api("/api/status");
      state.status = data.status;
      renderStatus();
      renderGitFiles(data.status);
    } catch {
      /* 状态刷新失败不打扰用户 */
    }
  }

  /* ------------------------------------------------------------------ tabs */

  function bindTabs() {
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var key = tab.getAttribute("data-tab");
        document.querySelectorAll(".tab").forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-on", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".panel").forEach(function (p) {
          p.classList.toggle("is-on", p.id === "panel-" + key);
        });
        if (key === "publish") refreshStatus();
      });
    });
  }

  /* ------------------------------------------------------------------ boot */

  bindTabs();
  bindUpload();

  $("#btnSaveConfig").addEventListener("click", saveConfig);
  $("#btnSaveConfigBottom").addEventListener("click", saveConfig);
  $("#btnPublish").addEventListener("click", publish);
  $("#btnSync").addEventListener("click", syncUpstream);
  $("#btnRefresh").addEventListener("click", load);
  $("#btnClearLog").addEventListener("click", function () {
    $("#publishLog").textContent = "等待操作…";
  });

  window.addEventListener("beforeunload", function (e) {
    if ($("#btnSaveConfig").disabled) return;
    var hint = $("#configHint").textContent;
    if (/未保存/.test(hint)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  load();
})();
