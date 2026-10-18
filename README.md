# DFC Hub

Minecraft **1.12.2 · HBM 诅咒版 · DFC** 地图与节枝特效工具的发布 / 下载站。
纯静态（HTML + CSS + 原生 JS），托管在 Cloudflare Pages，版本号由 GitHub Actions 定时从上游 Release 同步。

- 线上地址：<https://dfc-hub.pages.dev>
- 上游工具仓库：<https://github.com/jiezhiyisichen/DFC-Map-Creation-Tool>
- 宣传视频：<https://www.bilibili.com/video/BV1VRYe6gEga/>

---

## 目录结构

```
dfc-hub/
├── index.html                  首页：Hero / 项目简介 / B站视频 / 截图墙 / 快速下载
├── downloads.html              下载中心：版本看板 / 搜索 / 通道筛选 / 资产列表 / 安装说明
├── 404.html                    错误页（复用同一套样式）
├── assets/
│   ├── css/style.css           全部样式（设计变量 / 组件 / 响应式 / 动效）
│   ├── js/
│   │   ├── site.js             公共交互：导航、滚动揭示、灯箱、视频门面、版本号回填
│   │   └── downloads.js        下载页：搜索、筛选、卡片渲染、URL 状态同步
│   ├── data/
│   │   ├── releases.json       ← 自动生成：上游 Release 归一化数据
│   │   └── releases.js         ← 自动生成：window.__DFC_DATA__（file:// 预览兼容）
│   └── img/                    游戏内截图 + favicon
├── scripts/
│   ├── sync-releases.mjs       拉取 GitHub Release → 生成数据
│   ├── build.mjs               组装 dist/
│   └── dev-server.mjs          零依赖本地预览服务器
├── .github/workflows/deploy.yml  定时同步 + Cloudflare Pages 部署
├── _headers / _redirects       Cloudflare Pages 缓存与安全响应头、短链跳转
└── package.json                npm run sync / build / dev
```

> `assets/data/*` 是构建产物，**不要手改** —— 下一次定时任务会覆盖它。

---

## 本地开发

需要 Node.js ≥ 20（脚本用到了内置 `fetch`）。

```bash
npm run sync     # 拉一次上游 Release，生成 assets/data/*
npm run dev      # http://127.0.0.1:5173
```

`npm run build` 会生成 `dist/`，与线上部署内容一致。
数据文件用 `<script>` 引入而不是 `fetch`，所以直接双击 `index.html` 也能正常显示（无需起服务）。

> 未配置 `GITHUB_TOKEN` 时，GitHub API 的匿名额度是 60 次/小时/IP，一般够用；
> 报 403 时设置环境变量 `GITHUB_TOKEN=ghp_xxx` 再跑一次。

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
| Variable（可选） | `UPSTREAM_MAP_REPO` | `owner/repo`，地图单独放仓库时才需要 |

### 3. 触发

推送 main 分支、或在 Actions 页面手动 **Run workflow**。
凭据没配时工作流仍会完成构建并上传 `dist` 产物，只是跳过部署步骤并给出 warning，不会红叉。

---

## 自动化做了什么

`.github/workflows/deploy.yml` 每次执行：

1. `scripts/sync-releases.mjs` 调 GitHub API 拉取上游全部 Release（分页，最多 500 条）；
2. 归一化后写入 `assets/data/releases.json` 与 `assets/data/releases.js`；
3. 数据有变化就 `git commit` 回仓库（提交信息带 `[skip ci]`，避免触发死循环）；
4. `scripts/build.mjs` 生成 `dist/`；
5. `wrangler pages deploy dist` 发布到 Cloudflare Pages。

定时：每 6 小时一次（`cron: 17 */6 * * *`，UTC）。

### 版本通道判定

| Tag 形态 | 归类 | 站点标识 |
| --- | --- | --- |
| `v3.6`、`3.6`、`v1.0-release` | 正式版 | 绿 · RELEASE |
| `v3.7-beta`、`v3.7-beta.2` | 测试版 | 琥珀 · BETA |
| `v3.7-preview`、`-alpha`、`-rc`、勾了 Pre-release | 预览版 | 紫 · PREVIEW |

### 资产分拣

| 文件后缀 | 归类 | 下载按钮 |
| --- | --- | --- |
| `.jar` | 工具 | 下载 .jar |
| `.zip` / `.7z` / `.rar` | 地图整合包 | 下载整合包 |

同一个 Release 里同时挂 jar 和 zip 时，两个文件会并列展示、各自独立下载。
**地图整合包不需要改代码**：把 `.zip` 传到任意一个 Release 的附件里，下一次同步就会自动出现在下载中心和首页卡片。

下载链接直接使用 API 返回的 `browser_download_url`，不做转存、不加中转参数，所以不会因为站点迁移而失效。

---

## 数据结构

`assets/data/releases.json` 关键字段：

```jsonc
{
  "generatedAt": "2026-10-18T09:20:00.000Z",
  "source": { "tool": "owner/repo", "map": "owner/repo", "api": "https://api.github.com" },
  "counts": { "all": 3, "release": 3, "beta": 0, "preview": 0 },
  "latest": {
    "release": { /* 最新正式版 */ },
    "beta": null,
    "preview": null,
    "map": null,          // 没有任何 zip 资产时为 null，页面显示「未发布」
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
      "assets": [
        { "name": "...jar", "kind": "tool", "size": 255931, "downloads": 4, "url": ".../download/v3.6/....jar" }
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
