# DFC Hub

Minecraft **1.12.2 · HBM 诅咒版 · DFC** 地图与节枝特效工具的发布 / 下载站。
纯静态（HTML + CSS + 原生 JS），托管在 Cloudflare Pages，版本号由 GitHub Actions 定时从上游 Release 同步。
**上游同时托管在 GitHub 与 Gitee**，站点把两边按 tag 合并，下载页可选线路。

- 线上地址：<https://dfc-hub.pages.dev>
- 上游工具仓库（GitHub）：<https://github.com/jiezhiyisichen/DFC-Map-Creation-Tool>
- 上游工具仓库（Gitee 镜像）：<https://gitee.com/yi-sichen-jiezhi/DFC-Map-Creation-Tool>
- 宣传视频：<https://www.bilibili.com/video/BV1VRYe6gEga/>

---

## 目录结构

```
dfc-hub/
├── index.html                  首页：标题 / 下载中心与使用教程两个入口 / 四张截图
├── wiki.html                   百科：安装、指令手册、倒计时、DFC 显示器、物品、FAQ、视频
├── downloads.html              下载中心：版本看板 / 搜索 / 通道筛选 / 资产列表 / 安装说明
├── 404.html                    错误页（复用同一套样式）
├── data/                       ★ 站点内容（由本地后台读写）
│   ├── config.json             全部可编辑文案
│   ├── config.js               ← 自动生成：window.__DFC_CONFIG__
│   ├── releases.json           本地手动发布的下载包清单
│   └── releases.js             ← 自动生成：window.__DFC_LOCAL__
├── public/
│   └── downloads/              ★ 后台上传的 .jar / .zip，部署后映射到 /downloads/*
├── admin-server.js             ★ 本地管理后台服务（Express）
├── admin/
│   ├── index.html              后台界面
│   ├── admin.css
│   └── admin.js
├── assets/
│   ├── css/style.css           全部样式（设计变量 / 组件 / 响应式 / 动效）
│   ├── js/
│   │   ├── content.js          把 config 绑定到 data-cfg 元素
│   │   ├── site.js             公共交互：导航、滚动揭示、视频门面、版本号回填
│   │   └── downloads.js        下载页：搜索、筛选、卡片渲染、URL 状态同步
│   ├── data/
│   │   ├── releases.json       ← 自动生成：上游 Release 归一化数据
│   │   └── releases.js         ← 自动生成：window.__DFC_DATA__（file:// 预览兼容）
│   └── img/                    游戏内截图 + favicon
├── scripts/
│   ├── sync-releases.mjs       拉取 GitHub + Gitee 发行版 → 合并生成数据
│   ├── smoke-downloads.mjs     下载页脚本的 DOM 冒烟测试（npm run smoke）
│   ├── build.mjs               组装 dist/（含 data/ 与 public/）
│   └── dev-server.mjs          零依赖本地预览服务器
├── .github/workflows/deploy.yml  定时同步 + Cloudflare Pages 部署
├── _headers                    Cloudflare Pages 缓存与安全响应头
└── package.json                npm run admin / dev / sync / build
```

> `assets/data/*` 是构建产物，**不要手改** —— 下一次定时任务会覆盖它。
> `data/*.json` 是站点内容，可以手改，但推荐用后台改（保存时会同步生成 `.js`）。

---

## 首页与百科

- **首页**只保留标题、两个按钮（下载中心 / 使用教程）和四张截图，点击截图开灯箱。不放视频与长文案。
- **百科（`wiki.html`）** 承载使用教程：安装、指令手册、倒计时 6 样式、DFC 显示器、物品与方块、常见问题、视频演示。
  内容依据模组仓库的 `README.md` 与 `docs/*.md` 整理，对应 v3.9；**改版后请同步更新这一页**。
- 百科样式单独放在 `assets/css/wiki.css`，只负责正文排版，头部与页脚仍用 `style.css`。

### 访客自己刷新版本清单

`downloads.html` 版本看板第三格有「手动刷新数据」按钮：
带时间戳 `fetch('assets/data/releases.json?t=…', {cache:'no-store'})` 拉最新清单，就地重渲染并更新顶部版本号，
不用等下一次自动同步，也不用刷整页。实现见 `assets/js/site.js` 的 `initDataRefresh()`，
下载页通过 `window.__DFC_RERENDER__` 暴露重渲染入口。

---

## 本地开发

需要 Node.js ≥ 20（脚本用到了内置 `fetch`）。

```bash
npm run sync     # 拉一次上游 Release（GitHub + Gitee），生成 assets/data/*
npm run smoke    # 不启浏览器，把 downloads.js 真正跑一遍（改完线路逻辑必跑）
npm run dev      # http://127.0.0.1:5173
```

`npm run build` 会生成 `dist/`，与线上部署内容一致。
数据文件用 `<script>` 引入而不是 `fetch`，所以直接双击 `index.html` 也能正常显示（无需起服务）。

> 未配置 `GITHUB_TOKEN` 时，GitHub API 的匿名额度是 60 次/小时/IP，一般够用；
> 报 403 时设置环境变量 `GITHUB_TOKEN=ghp_xxx` 再跑一次。
>
> Gitee 默认匿名读取（额度更低但每小时一次的任务完全够用）。可用环境变量：
> `UPSTREAM_GITEE_REPO`（镜像仓库）、`GITEE_TOKEN`（私人令牌，提高额度）、
> `GITEE_MIRROR=off`（完全跳过 Gitee，只出 GitHub 线路）。

---

## 本地管理后台

改文案、传下载包、一键发布，都不用再改代码。

### 安装与启动

```bash
npm install          # 安装 express 与 multer（只有后台需要）
npm run admin        # 启动后台
```

打开 <http://127.0.0.1:4310/admin/>，站点预览在 <http://127.0.0.1:4310/>。
端口被占用时换一个：`PORT=4311 npm run admin`。

> 只监听 `127.0.0.1`，外部设备访问不到；写操作会校验请求来源，防止其他网页跨站调用。

### 三个页签

| 页签 | 做什么 | 写到哪 |
| --- | --- | --- |
| 文案 | 按分组编辑站点标题、首屏、视频、下载页、页脚、链接 | `data/config.json` → `data/config.js` |
| 下载包 | 上传 `.jar` / `.zip`，填版本号、通道、说明；可编辑 / 删除条目 | 文件进 `public/downloads/`，条目进 `data/releases.json` |
| 发布上线 | 执行 `git add .` → `git commit -m ...` → `git push origin main`，日志实时显示 | Git 仓库 |

### 下载包怎么变成下载链接

上传后条目形如：

```jsonc
{
  "tag": "v3.8-hotfix",
  "name": "节枝特效工具 热修包",
  "kind": "tool",
  "fileName": "jiezhi-hotfix.jar",
  "url": "downloads/jiezhi-hotfix.jar"
}
```

`npm run build` 会把 `public/downloads/` 铺到 `dist/downloads/`，所以线上地址是
`https://dfc-hub.pages.dev/downloads/jiezhi-hotfix.jar`。
下载中心会把本地条目和上游 Release 混排，本地条目带 `LOCAL` 标记、不显示 GitHub 链接。

> 地图整合包**不放本地、也不放 Release**，统一放在 123 云盘：
> `data/config.json` 里的 `links.mapPan`。后台「文案 → 链接」里可以直接改这个地址。

### 注意：单文件 25MB

Cloudflare Pages 单个文件上限是 **25MB**，超过会导致部署失败。
后台在上传时会提示，但不会强行拦截。大体积的地图整合包不适合走这里，放 123 云盘更合适。

### 关于 `git push`

后台只是帮你在项目目录里执行 git 命令，凭据沿用本机已配置的 Git 账号。
本机若因证书吊销检查导致 push 失败，后台会自动关闭本次 SSL 校验重试一次；
遇到 `non-fast-forward` 会先 `pull --rebase` 再推。

---

## 部署到 Cloudflare Pages

### 1. 建项目

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，
选择本仓库，构建配置留空（构建在 Actions 里完成，Pages 只接收产物）。

项目名必须是 **`dfc-hub`**，默认域名才会是 `dfc-hub.pages.dev`。
如果用了别的名字，去仓库 **Settings → Variables → Actions** 里加一个
`CLOUDFLARE_PROJECT_NAME` 变量填新名字。

### 2. 建 API Token

Cloudflare Dashboard → 右上头像 → **My Profile** → **API Tokens** → **Create Token** →
自定义模板，权限给 **Account · Cloudflare Pages · Edit**，账户范围选你的账户。
把生成的 Token 和 **Account ID**（Pages 概览页右侧可见）填到仓库：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 上一步的 Token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 账户 ID |
| Variable（可选） | `CLOUDFLARE_PROJECT_NAME` | `dfc-hub` |

### 3. 触发

推送 main 分支、或在 Actions 页面手动 **Run workflow**。
凭据没配时工作流仍会完成构建并上传 `dist` 产物，只是跳过部署步骤并给出 warning，不会红叉。

---

## 自动化做了什么

`.github/workflows/deploy.yml` 每次执行：

1. `scripts/sync-releases.mjs` 调 GitHub API 拉取上游全部 Release（分页，最多 500 条），
   再调 Gitee OpenAPI 拉同一仓库的发行版，**按 tag 合并**（见下节「双源镜像」）；
2. 归一化后写入 `assets/data/releases.json` 与 `assets/data/releases.js`；
3. 数据有变化就 `git commit` 回仓库（提交信息带 `[skip ci]`，避免触发死循环）；
4. `scripts/build.mjs` 生成 `dist/`；
5. `wrangler pages deploy dist` 发布到 Cloudflare Pages。

定时：每小时一次（`cron: 7 * * * *`，UTC）。

### 版本通道判定

| Tag 形态 | 归类 | 站点标识 |
| --- | --- | --- |
| `v3.6`、`3.6`、`v1.0-release` | 正式版 | 绿 · RELEASE |
| `v3.7-beta`、`v3.7-beta.2` | 测试版 | 琥珀 · BETA |
| `v3.7-preview`、`-alpha`、`-rc`、勾了 Pre-release | 预览版 | 紫 · PREVIEW |

Tag 没写通道后缀时，会再看 Release 标题结尾：`… + 测试版` / `… beta` 判为测试版，
`… 预览版` / `… preview` 判为预览版，其余为正式版。

### 紧急修复版（叠加标签，不占通道）

紧急修复是**独立属性**，可以和任意通道叠加，所以存在「紧急修复 + 测试版」和「紧急修复 + 正式版」两种组合，
页面上红色标签在前、通道标签在后，形如 `紧急修复` `测试版`。

同步脚本 `detectHotfix()` 的识别规则（任一命中即算）：

| 位置 | 命中示例 |
| --- | --- |
| Tag | `v3.9.1-hotfix`、`v3.9.1-hotfix-beta`、`v3.9.1-beta-hotfix`、`v3.9.1-fix` |
| Release 标题 | 含 `紧急修复` 或 `hotfix` |
| Release 说明前 200 字 | 含 `紧急修复版` 或 `hotfix` |

说明正文只认「紧急修复版」这类明确措辞，普通的「修复了某个崩溃」不会被误判成紧急修复。
数据里对应字段是 `hotfix: true/false`，同时 `counts.hotfix`、`latest.hotfix` 也会一起产出。

同步完成后终端会打印识别结果，方便确认新标签有没有被认出来：

```
[sync] 识别到 1 个紧急修复版：v3.9.1-hotfix-beta = 紧急修复+测试版
```

下载页筛选栏里「紧急修复」和通道筛选是叠加关系，对应 URL 参数 `?nature=hotfix&channel=beta`。

### 重大更新（只配正式版）

重大更新也是叠加属性，但**只在正式版上生效**：`v3.10-major` 会打蓝标；
`v3.10-major-beta` 因为是测试版，不会打标。转正时直接发正式版并在 Tag 或标题里写明即可。

`detectMajor()` 的识别规则（任一命中即算，且 channel 必须是 `release`）：

| 位置 | 命中示例 |
| --- | --- |
| Tag | `v3.10-major`、`v3.10-major-release` |
| Release 标题 | `v3.10 重大更新`、含 `major` |
| Release 说明前 200 字 | 含 `重大更新` / `重大版本` |

数据字段为 `major: true/false`，另有 `counts.major`、`latest.major`。
页面上蓝色 `重大更新` 标签排在红色 `紧急修复` 之后、通道标签之前，所以正式版看到的是
`重大更新` `正式版`，如果同时是紧急修复则是 `紧急修复` `重大更新` `正式版`。

筛选对应的 URL 是 `?nature=major`（旧链接 `?hotfix=1` 仍然兼容）。

### 资产分拣

| 文件后缀 | 归类 | 下载按钮 |
| --- | --- | --- |
| `.jar` | 工具 | 下载 .jar |
| 其它（含 `.zip`） | 忽略 | — |

**地图整合包不走 Release**：只认 `links.mapPan`（123 云盘），同步脚本不再扫描任何仓库的 zip。
工具下载链接直接使用 API 返回的 `browser_download_url`，不做转存、不加中转参数，所以不会因为站点迁移而失效。

---

## 双源镜像（GitHub + Gitee）

上游工具同一份 jar 同时发在 GitHub Release 和 Gitee 发行版里。站点的处理原则是
**GitHub 为主源、Gitee 只当备用地址**，两边按 tag 对齐：

| 情形 | 结果 |
| --- | --- |
| 两边都有同一版本、同名 jar | 卡片上出现「下载 .jar」+「GitHub 备用 / Gitee 备用」两个按钮 |
| 只有 GitHub 有 | 只走 GitHub，不显示备用按钮（不制造"另一条线也能下"的错觉） |
| 只有 Gitee 有 | 该版本仍会列出来，下载地址用 Gitee，发布页只给 Gitee |
| Gitee 整个挂掉 | 记一条 warning，页面照常只出 GitHub 线路 |
| GitHub 整个挂掉 | 自动降级：用 Gitee 的数据撑起整站，并在日志里明确写「已改用 Gitee 作为主数据源」 |

下载页筛选栏里多了一组**线路**按钮（`自动 / Gitee / GitHub`）：

- **自动**（默认）：有 Gitee 镜像就走 Gitee —— 国内直连明显更快，打不开 GitHub 也不影响下载；
- 选择会存进 `localStorage`（键 `dfc-hub:mirror`），并同步到 URL（`?mirror=gitee`）方便分享。

> 数据不会互相污染：Gitee 那边体积常常是 `null`、说明格式也不同，
> 所以合并时**只给主源条目挂 URL，不改任何已有字段**。
> Gitee 自动生成的源码 `vX.Y.zip` / `.tar.gz` 一律忽略，只认 `/releases/download/...` 的 jar。

改了这套逻辑之后，务必跑一次 `npm run smoke` —— 它会用 DOM 垫片把 `downloads.js`
真正执行一遍，断言三种线路下的地址形态、以及旧数据（没有 `mirrors` 字段）不会崩。

---

## 数据结构

`assets/data/releases.json` 关键字段：

```jsonc
{
  "generatedAt": "2026-10-18T09:20:00.000Z",
  "source": {
    "tool": "owner/repo",
    "api": "https://api.github.com",
    "gitee": { "repo": "owner/repo", "ok": true, "mergedAssets": 3, "extraReleases": 0, "primary": false }
  },
  "counts": { "all": 4, "release": 4, "beta": 0, "preview": 0 },
  "latest": {
    "release": { /* 最新正式版 */ },
    "beta": null,
    "preview": null,
    "tool": { /* 最新带 jar 的版本 */ }
  },
  "releases": [
    {
      "tag": "v3.6",
      "version": "3.6",
      "channel": "release",
      "name": "v3.6 · 自定义屏面板版面重做",
      "publishedAt": "2026-10-18T04:13:56Z",
      "url": "https://github.com/.../releases/tag/v3.6",
      "url": "https://github.com/.../releases/tag/v3.6",
      "mirrors": {
        "gitee": { "url": "https://gitee.com/.../releases/tag/v3.6", "tag": "v3.6" }
      },
      "assets": [
        {
          "name": "...jar",
          "kind": "tool",
          "size": 255931,
          "downloads": 4,
          "url": "https://github.com/.../download/v3.6/....jar",
          "mirrors": [
            { "host": "gitee", "url": "https://gitee.com/.../download/v3.6/....jar" }
          ]
        }
      ],
      "notes": "原始 Markdown",
      "notesText": "去标签纯文本，用于搜索",
      "notesHtml": "构建期转好的安全 HTML"
    }
  ]
}
```

Release 说明在构建期由 `sync-releases.mjs` 里的 Markdown-lite 渲染器转成 HTML：
先整体 HTML 转义再替换语法，因此上游说明里的任何标签都不会被当作 HTML 执行。

---

## 设计说明

- 深色底 + 蓝紫渐变点缀，网格与扫描线叠层营造核科技控制台观感；
- Hero 右侧是一块纯 CSS 绘制的「DFC 核心监视器」，与游戏内截图同构；
- 断点：`1024 / 860 / 720 / 420`，移动端单列、导航抽屉、筛选器换行；
- 无外部字体、无 CSS 框架、无 JS 依赖，首屏只有本地资源（B 站播放器点击后才加载）；
- 尊重 `prefers-reduced-motion`，动效可全部关闭。

---

## 署名

地图与工具作者：**树上的节枝**（B 站 <https://space.bilibili.com/3494363348863838>）。
转载 / 二创请保留署名，禁止商业使用。本站代码仅用于该项目的发布页面。
