# YUMU 游戏助手 · 小程序

> YUMU 游戏社区的**内容消费端**（课程实训大作业）。
> 与社区本体共用同一套后端，**后端零改动**。

## 这是什么

社区本体是「论坛」，社交链路（私信 / 关注 / 通知 / 发帖 / 审核）是它的骨架。
小程序**不做社区的第二入口**，而是切出一块更轻、更工具化的场景：

> **「我在玩什么 → 怎么过 → 最近更新了什么」**

因此砍掉全部社交互动与 UGC 发布，只保留**内容消费**：游览游戏库、看攻略（结构化拆解卡）、看资讯。

## 技术形态

| 项 | 选型 | 理由 |
|---|---|---|
| 框架 | **uni-app + Vue3（`<script setup>`）** | 与社区前端同为 Vue3 栈，`api/` 封装思路可直接迁移 |
| 构建 | Vite | 与社区前端一致 |
| 状态 | 模块级 `reactive` 单例 | 不引 Pinia，小程序场景够用且更轻 |
| 数据源 | 现有后端 `http://8.133.255.202/api` | 公开 GET 接口齐全，浏览内容**无需登录** |
| 附加产出 | **H5 版**（同一套代码编译） | 可挂到现有服务器，手机浏览器开 IP 即可演示，绕开「小程序需 HTTPS 备案域名」限制 |

## 交付方式（已定：**不走上架**）

上架（正式发布）需依次通过 **HTTPS 域名 → 域名 ICP 备案 → 小程序 ICP 备案 → 类目审核** 四道关卡，
本项目只有 IP、未做任何备案，**第 1 关就过不去**（微信服务器域名不接受 IP）。
因此交付方式定为：

- ✅ **主交付：H5 版** —— 挂到 `8.133.255.202`，手机浏览器打开即可，完全不受小程序规则约束
- ✅ **答辩演示：开发者工具 + 真机预览** —— 手机端需在右上角菜单**打开调试**才会跳过合法域名校验
- ❌ 不做体验版（仍需 HTTPS 已备案域名）、不做正式上架

> 简历 / 答辩口径：**「完成小程序端开发，并通过 H5 版本部署上线」**，不要写成「小程序已上架」。
> 详细论证见 [`docs/方案设计.md`](docs/方案设计.md) §七。

## 目录结构

```
miniprogram/                  ← 独立子项目，与 backend/ frontend/ 平级
├── package.json              uni-app CLI 工程（工程根在这里，源码在 src/）
├── vite.config.js            H5 开发期把 /api 代理到线上后端
├── index.html
├── docs/
│   ├── 方案设计.md            定位 / 范围 / 页面结构 / 接口映射 / 开发计划
│   └── 开发日志.md            小程序侧流水（与社区主日志分开记）
├── prototype/index.html      6 屏移动端原型（纯 HTML，浏览器直接打开）
├── tools/
│   └── gen-tabbar-icons.py   生成 tabBar 图标（改主题色时重跑，见下）
├── src/                      uni-app 源码
│   ├── main.js  App.vue  pages.json  manifest.json
│   ├── api/                  config.js（端点单一来源）/ request.js / community.js
│   ├── utils/                format.js / content.js / stepParser.js / store.js / usePagedList.js
│   ├── components/           GameTile / PostCard / StepCard / EmptyState / ErrorState / Skeleton
│   ├── static/tabbar/        tabBar 图标（由 tools/ 脚本生成，勿手改）
│   └── pages/                index / games / game·detail / post·detail / news / my / search / list
├── tests/                    单测 + 浏览器回归 + 产物验证服务器 + 诊断探针
└── README.md                 ← 本文档
```

## 快速开始

### 看原型（无需环境）

浏览器直接打开 `prototype/index.html`。原型内数据取自线上真实内容。

### 跑源码

```bash
cd miniprogram
npm install

# 微信小程序：产物 dist/dev/mp-weixin（或 build 版 dist/build/mp-weixin），用开发者工具导入
npm run dev:mp-weixin

# H5：开发预览（/api 经 vite 代理到线上后端）
npm run dev:h5

# 出正式产物
npm run build:h5            # → dist/build/h5，部署时挂到服务器 /m/ 下
npm run build:mp-weixin     # → dist/build/mp-weixin
```

微信开发者工具里需勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**，
这样才能直连 `http://8.133.255.202/api`（后端无需改动）。

### 回归验证（改完必跑）

```bash
cd miniprogram

# ① 单测：拆解器 20 项 + 正文解析 15 项（直接 import 被测源码）
node --experimental-default-type=module tests/stepParser.test.mjs
node --experimental-default-type=module tests/content.test.mjs

# ② 浏览器回归 45 项（打在**真实构建产物**上）
npm run build:h5
node tests/serve-h5.mjs &                       # 起在 http://localhost:5199/m/
NODE_PATH="<repo>/tests/.pw/node_modules" node tests/verify-miniprogram.cjs

# ③ 也可以直接打**线上**（同一套断言，只换基址）—— 发版后最硬的验收
MP_BASE=http://8.133.255.202/m NODE_PATH="<repo>/tests/.pw/node_modules" node tests/verify-miniprogram.cjs

# ④ 本地全链路（本地后端 + 本地产物），不依赖外网
API_TARGET=http://127.0.0.1:8080 node tests/serve-h5.mjs &
NODE_PATH="<repo>/tests/.pw/node_modules" node tests/verify-miniprogram.cjs
```

- `tests/serve-h5.mjs` 把 `dist/build/h5` 挂在 `/m/` 并把 `/api` 代理到后端（默认线上，可用 `API_TARGET` 改）——
  **必需**，否则产物里的相对路径 `/api` 找不到后端，页面会全是空数据。
- 它还**复刻了生产 nginx 的五项安全响应头（含 CSP）**。这不是可选项：本地若不带 CSP，
  「内联脚本被拦」这类问题会本地全绿、一上线才炸（2026-09-17 真踩过，见下方第 6 条约束）。
  ⚠️ 改了 `deploy/nginx/security-headers.conf` 时，这两份要同步。
- `NODE_PATH` 复用社区项目已装的 `playwright-core`，不重复安装。
- **脚本不许硬编码帖子 id**：本地库与线上库的 id 段没有交集（本地 `5001~200588`、线上 `3xxx`），
  写死会让整段断言假失败，而症状看起来像「页面坏了」。回归里已改为从接口动态取。
- 诊断探针（遇到问题先跑，**别直接改业务代码**）：
  - `tests/probe-scroll.cjs` —— 打印 H5 真实滚动容器与触底条件（「上拉加载不生效」时用）
  - `tests/probe-image.cjs` —— 打印 `<image>` 的 DOM 形态与 `/api/files/*` 的真实响应（「图片不显示」时用）

### tabBar 图标

图标不是手塞的二进制，而是脚本画的：改主题色 / 换图形改 `tools/gen-tabbar-icons.py` 后重跑即可。

```bash
python tools/gen-tabbar-icons.py     # → src/static/tabbar/*.png（81×81，未选中/选中各一套）
```

⚠️ `pages.json` 里 tabBar 一旦配了 `iconPath`，**每一项都必须配**，不能只配一半。

## 硬约束（踩过坑，别再踩）

1. **分页参数是 `current` 和 `size`，不是 `page`。**
   实测 `page=2` 会被**静默忽略、恒返回第 1 页**，不报错。上拉加载写错会无限重复同一页。
2. **HTTP 状态码恒为 200**，成败看响应体的 `code` 字段（`Result{code,message,data}`）。
   分页体为 `PageResult{total,pages,current,size,records}`。
3. **个人主体不可用 `web-view`**，无法内嵌 B 站等外部播放器；
   项目里也没有任何视频相关代码。视频已**降级为详情页的可选模块**，不占主线。
4. **本小程序不上架**（2023-09 起须先完成小程序 ICP 备案，且服务器域名必须 HTTPS 且已备案）。
   开发期用开发者工具勾选「不校验合法域名」直连 IP；交付靠 H5 版。
5. **卡片必须对「没有封面」有兜底，并且要有「图挂了」的退路。**
   ⚠️ 前提已变（2026-09-17 种子富化后）：**47 款游戏全部有 `cover`**、帖子约七成有封面、
   头像约七成有图 —— 旧注释「线上 cover 全是 null」**已不成立**，别照抄。
   现在的规则是：有图显示图 → 加载失败 `@error` 退回首字色块（`utils/format.js#gameTile()`）→
   不留空框、不留破图。帖子卡片的封面优先级为 `post.cover` → `post.gameCover`。
   📌 顺带：`curl -I`（HEAD）探 `/api/files/*` 会返回 **401**，别误判成「图片要鉴权」——
   放行规则只写了 `GET`，`<image>` 走 GET，不需要 token。
   📌 用 `curl -w '%{size_download}'` 量 `/api/files/*` 会**恒为 0**（假象），判内容看
   `content-type` 或落盘 `wc -c`。
6. **`index.html` 里不能有任何内联 `<script>`**（生产 nginx 的 CSP 是 `script-src 'self'`）。
   🚨 uni-app 官方 H5 模板默认那段「iPhone 刘海屏适配」就是内联脚本，**而它负责
   `document.write` 出 `<meta viewport>`** —— 被 CSP 拦掉后页面上**一个 viewport meta 都没有**，
   真机按 980px 桌面宽度渲染、移动端布局全乱。本项目已改成静态 viewport meta。
   📌 这类问题的教训：**「页面不白屏、只有一条控制台报错」的故障最容易被放过**，
   所以回归里有 G3 直接断言 viewport meta（见 `tests/verify-miniprogram.cjs`）。
7. 🚨 **H5 端图片地址必须是绝对地址（`ASSET_BASE = location.origin`）。**
   uni-app H5 的 `<image>` 组件会按 `manifest.h5.router.base`（本项目 `/m/`）解析**根相对路径**：
   `/api/files/x.jpg` 被发成 `/m/api/files/x.jpg` ⇒ 本地 404、线上被 SPA 的 `try_files` 回退兜成
   `text/html` ⇒ 解码失败 ⇒ **全部图片变成色块/空白**。
   ⚠️ 对照事实：同一文档里普通 `<img src="/api/files/x.jpg">` 是**正常**的（只有 `<image>` 加前缀），
   所以排查时别往 nginx / 后端方向找。`API_BASE` 则**不需要**改（`uni.request` 的 `/api/...` 由浏览器
   按文档 URL 解析，`/` 开头即根相对）。
   回归里有 G4a/G4b 直接盯住这点：**断言不允许出现 `/m/api/files/*`，且图片响应必须全 200 + `image/*`**。

### 两条工程约定（评审最容易问的地方）

- **「请求失败」≠「结果为 0」。** 所有列表页失败的归宿是 `ErrorState`（含重试按钮），
  只有「请求成功且为空」才允许走 `EmptyState`。原来四个页面都把异常 `catch` 成空数组，
  后端一卡就显示「没有找到匹配的游戏 / 换个关键词试试」—— 把系统故障说成内容本来就没有。
  分页/失败/重试已收口到 `utils/usePagedList.js`，别再各页自己写一份。
- **不做假动作。** 本端不登录，所以底部操作条只保留真的能做的「收藏 / 分享」，
  点赞数改为作者行只读展示；`我的` 页写「访客模式」而不是「未登录」。
  （原点赞按钮点了弹「点赞需登录，第二期开放」—— 等于当面告诉评审这功能没做完。）


## 视觉基调

延续社区主题：深色底 + YUMU 紫 `#7C5CFF` + 电竞青 `#19E3C2`。

## 相关文档

- 完整方案：[`docs/方案设计.md`](docs/方案设计.md)
- 主项目 README：[`../README.md`](../README.md)
