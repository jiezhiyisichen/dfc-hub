/* ==========================================================================
   DFC HUB — content binding
   把 data/config.json 里的文案套到页面元素上。
   HTML 里保留了一份兜底文案：即使 config.js 没生成或加载失败，页面照样能看。

   支持的属性：
     data-cfg="hero.title"         → 写入 textContent
     data-cfg-href="links.video"   → 写入 href
     data-cfg-steps="downloadsPage.installSteps" → 重建步骤列表
   ========================================================================== */
(function () {
  "use strict";

  var C = window.__DFC_CONFIG__;
  if (!C) return;

  function get(path) {
    if (!path) return null;
    return path.split(".").reduce(function (obj, key) {
      if (obj == null) return null;
      return obj[key] == null ? null : obj[key];
    }, C);
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** 纯文本里允许 [c]代码[/c] 这种极简标记，转成 <code> */
  function rich(str) {
    return esc(str).replace(/\[c\]([\s\S]*?)\[\/c\]/g, "<code>$1</code>");
  }

  function fill() {
    document.querySelectorAll("[data-cfg]").forEach(function (el) {
      var value = get(el.getAttribute("data-cfg"));
      if (typeof value === "string" && value.trim()) {
        el.textContent = value;
      }
    });

    document.querySelectorAll("[data-cfg-href]").forEach(function (el) {
      var value = get(el.getAttribute("data-cfg-href"));
      if (typeof value === "string" && value.trim()) {
        el.setAttribute("href", value);
      }
    });

    var stepsRoot = document.querySelector("[data-cfg-steps]");
    if (stepsRoot) {
      var steps = get(stepsRoot.getAttribute("data-cfg-steps"));
      if (Array.isArray(steps) && steps.length) {
        stepsRoot.innerHTML = steps
          .map(function (step) {
            var title = (step && step.title) || "";
            var text = (step && step.text) || "";
            return '<div class="step"><h3>' + esc(title) + "</h3><p>" + rich(text) + "</p></div>";
          })
          .join("");
      }
    }

    /* 文档标题与摘要 */
    if (C.site && C.site.title) document.title = C.site.title;
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && C.site && C.site.description) {
      metaDesc.setAttribute("content", C.site.description);
    }

    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fill);
  } else {
    fill();
  }
})();
