/* ==========================================================================
   DFC HUB — shared site behaviour
   Vanilla JS, no dependencies. Loaded with defer on every page.
   ========================================================================== */
(function () {
  "use strict";

  var DATA = (typeof window !== "undefined" && window.__DFC_DATA__) || null;

  /* ---------------------------------------------------------------- utils */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function firstOfKind(release, kind) {
    var assets = (release && release.assets) || [];
    for (var i = 0; i < assets.length; i++) {
      if (assets[i].kind === kind) return assets[i];
    }
    return null;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return "";
    var units = ["B", "KB", "MB", "GB"];
    var i = 0;
    var n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n = n / 1024;
      i++;
    }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
  }

  function formatDate(iso, withTime) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var pad = function (v) {
      return String(v).padStart(2, "0");
    };
    var s =
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    if (withTime) s += " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    return s;
  }

  function applyData() {
    if (!DATA) return;
    var latest = (DATA.latest && DATA.latest.release) || null;

    $$("[data-latest-version]").forEach(function (el) {
      el.textContent = latest ? latest.tag : "—";
    });

    $$("[data-latest-date]").forEach(function (el) {
      el.textContent = latest ? formatDate(latest.publishedAt) + " 发布" : "暂无正式版";
    });

    $$("[data-latest-name]").forEach(function (el) {
      el.textContent = (latest && latest.name) || "节枝特效工具";
    });

    $$("[data-release-count]").forEach(function (el) {
      el.textContent = String((DATA.releases || []).length);
    });

    $$("[data-sync-time]").forEach(function (el) {
      el.textContent = DATA.generatedAt ? formatDate(DATA.generatedAt, true) : "—";
    });

    $$("[data-sync-line]").forEach(function (el) {
      el.textContent =
        "DATA SYNC · " + (DATA.generatedAt ? formatDate(DATA.generatedAt, true) : "—");
    });

    /* home: tool download card */
    var toolAsset = latest ? firstOfKind(latest, "tool") : null;
    $$("[data-tool-download]").forEach(function (el) {
      if (toolAsset) {
        el.setAttribute("href", toolAsset.url);
        el.setAttribute("rel", "noopener noreferrer");
        el.removeAttribute("aria-disabled");
      } else if (latest) {
        el.setAttribute("href", latest.url);
      }
    });

    $$("[data-tool-file]").forEach(function (el) {
      if (toolAsset) {
        el.textContent = toolAsset.name + (toolAsset.size ? " · " + formatBytes(toolAsset.size) : "");
      }
    });

    $$("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* --------------------------------------------------------------- header */
  function initHeader() {
    var header = $("#siteHeader");
    var toggle = $("#navToggle");
    var nav = $("#primaryNav");

    if (header) {
      var onScroll = function () {
        header.classList.toggle("is-stuck", window.scrollY > 8);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    if (toggle && nav) {
      var setOpen = function (open) {
        document.body.classList.toggle("nav-open", open);
        document.body.classList.toggle("is-locked", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
      };

      toggle.addEventListener("click", function () {
        setOpen(!document.body.classList.contains("nav-open"));
      });

      nav.addEventListener("click", function (e) {
        if (e.target.closest("a")) setOpen(false);
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
          setOpen(false);
        }
      });

      window.addEventListener("resize", function () {
        if (window.innerWidth > 860) setOpen(false);
      });

      document.addEventListener("click", function (e) {
        if (
          document.body.classList.contains("nav-open") &&
          !e.target.closest("#primaryNav") &&
          !e.target.closest("#navToggle")
        ) {
          setOpen(false);
        }
      });
    }
  }

  /* --------------------------------------------------------------- reveal */
  function initReveal() {
    var items = $$(".reveal");
    if (!items.length) return;

    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach(function (el) {
        el.classList.add("is-in");
      });
      return;
    }

    document.documentElement.classList.add("anim-ready");

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    items.forEach(function (el) {
      io.observe(el);
    });

    /* 安全网：任何已进入视口却因浏览器调度没触发回调的元素，1.5s 后强制显示 */
    window.setTimeout(function () {
      items.forEach(function (el) {
        if (el.classList.contains("is-in")) return;
        var rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          el.classList.add("is-in");
        }
      });
    }, 1500);
  }

  /* ------------------------------------------------------------- scrollspy */
  function initScrollSpy() {
    var links = $$('#primaryNav a[href^="#"]');
    if (!links.length) return;

    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var section = document.getElementById(id);
      if (section) map[id] = a;
    });

    var ids = Object.keys(map);
    if (!ids.length) return;

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (a) {
            a.classList.remove("is-active");
          });
          map[entry.target.id].classList.add("is-active");
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );

    ids.forEach(function (id) {
      io.observe(document.getElementById(id));
    });
  }

  /* --------------------------------------------------------------- video */
  function initVideoFacade() {
    var facade = $("#videoFacade");
    var frame = $("#videoFrame");
    if (!facade || !frame) return;

    facade.addEventListener("click", function () {
      var iframe = document.createElement("iframe");
      iframe.src =
        "https://player.bilibili.com/player.html?bvid=BV1VRYe6gEga&page=1&high_quality=1&danmaku=1&autoplay=1";
      iframe.title = "DFC 地图 × 节枝特效工具 · 实机演示";
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("scrolling", "no");
      iframe.setAttribute("allowfullscreen", "true");
      iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      frame.innerHTML = "";
      frame.appendChild(iframe);
    });
  }

  /* ------------------------------------------------------------- lightbox */
  function initLightbox() {
    var box = $("#lightbox");
    if (!box) return;

    var img = $("#lbImg");
    var cap = $("#lbCap");
    var shots = $$(".shot[data-full]");
    if (!shots.length) return;

    var current = 0;
    var lastFocus = null;

    function items() {
      return shots.filter(function (f) {
        return f.offsetParent !== null;
      });
    }

    function show(index) {
      var list = items();
      if (!list.length) return;
      current = (index + list.length) % list.length;
      var fig = list[current];
      var src = fig.getAttribute("data-full");
      var caption = fig.getAttribute("data-caption") || "";
      img.src = src;
      img.alt = caption;
      cap.textContent = caption + "  ·  " + (current + 1) + " / " + list.length;
      box.classList.add("is-open");
      document.body.classList.add("is-locked");
    }

    function close() {
      box.classList.remove("is-open");
      document.body.classList.remove("is-locked");
      img.removeAttribute("src");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    shots.forEach(function (fig, i) {
      fig.setAttribute("tabindex", "0");
      fig.addEventListener("click", function () {
        lastFocus = fig;
        show(i);
      });
      fig.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          lastFocus = fig;
          show(i);
        }
      });
    });

    $("#lbClose").addEventListener("click", close);
    $("#lbPrev").addEventListener("click", function (e) {
      e.stopPropagation();
      show(current - 1);
    });
    $("#lbNext").addEventListener("click", function (e) {
      e.stopPropagation();
      show(current + 1);
    });

    box.addEventListener("click", function (e) {
      if (e.target === box) close();
    });

    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(current - 1);
      if (e.key === "ArrowRight") show(current + 1);
    });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    applyData();
    initHeader();
    initReveal();
    initScrollSpy();
    initVideoFacade();
    initLightbox();

    if (!DATA) {
      $$("[data-latest-version]").forEach(function (el) {
        if (!el.textContent.trim()) el.textContent = "—";
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* expose a couple of helpers for the downloads page */
  window.DFC = { formatBytes: formatBytes, formatDate: formatDate };
})();
