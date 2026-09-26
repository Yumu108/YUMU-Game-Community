# YUMU 攻略库 · 小程序

> 面向**多平台游戏攻略与资讯**的聚合与分类展示端（课程实训大作业）。
> 与社区本体共用同一套后端，**后端零改动**。

## 这是什么

社区本体是「论坛」，社交链路（发帖 / 回复 / 私信 / 关注 / 审核）是它的骨架。
小程序**不做社区的第二入口**，而是把它当成一个**内容库**来用：

> **「这些游戏在 PC / 主机 / 手游 上该怎么玩」—— 只收干货，不做闲聊。**

2026-09-17 把定位从「社区内容消费端」明确调整为**内容聚合与分类展示端**，具体口径：

- **内容范围**：只聚合 **攻略心得（155 篇）+ 资讯速递（99 篇）= 254 篇干货**。
  吐槽 / 玩家天地 / 二次创作 / 其他 四个板块（合计 447 篇）**不进小程序** ——
  那些是讨论与闲聊，不是攻略教学。这是**产品口径**，不是技术限制。
- **主交互 = 平台筛选**：顶部一排显眼的平台按钮（全部 / 多平台 / PC / 主机 / 手游），
  每个按钮带**该平台的真实篇数**（全部 254 / 多平台 135 / PC 72 / 手游 40 / 主机 7），
  点一下只看这个平台的文章。这就是可以对外宣称的「多平台游戏知识的聚合与分类展示」。
- **弱化互动**：详情页**没有回复区**，只保留 **点赞 / 收藏 / 分享**；
  点赞与收藏都是**本机记录**（后端点赞接口要登录态，不做假按钮也不虚增数据）。
  原本属于回复区的位置改由**「相关攻略」**接住 —— 读完一篇有下一条，而不是只剩「返回」。
- **登录 + 举报**（2026-09-17 接入）：「我的」页可登录/注册，**账号与主站完全通用**
  （同一套 user 表、同一组 `/auth` 接口）；详情页 meta 行有「举报」入口（预置理由单选），
  提交到 `POST /reports`，由主站**管理后台 → 举报处理**闭环。
  浏览、筛选、点赞、收藏仍无需登录 —— 登录只服务于举报这类需要身份的动作。
  🚨 账号规则沿用主站四层铁律：注册态实时过滤 `[A-Za-z0-9_]`（剔除时 toast 回显），
  **登录态不过滤**（要能输邮箱），提示语与主站 `Login.vue` 逐字一致。
- **忘记密码 + 注册协议勾选**（2026-09-17 补齐，对齐主站设计）：
  · 登录页「忘记密码？」→ **独立视图**（无登录/注册 Tab）：绑定邮箱 + scene=`reset` 验证码 +
    新密码两连 → `POST /auth/reset-password`；成功**不自动登录**，回登录态。
    ⚠️ 后端防枚举（未注册邮箱也返回成功）⇒ 发码提示是
    「若该邮箱已注册，验证码将在 1 分钟内送达」，**不能**写「已发送到你的邮箱」。
  · 协议勾选**只在注册 Tab**（登录/忘记密码视图不出现），未勾选注册被拦截；
    切走注册 Tab 时重置勾选（主站 C3 同款）；《用户协议》《隐私政策》链接打开
    **主站** `/agreement`、`/privacy`（URL 从 `api/config.js#LEGAL_LINKS` 取，别手写）。

## 技术形态

| 项 | 选型 | 理由 |
|---|---|---|
| 框架 | **uni-app + Vue3（`<script setup>`）** | 与社区前端同为 Vue3 栈，`api/` 封装思路可直接迁移 |
| 构建 | Vite | 与社区前端一致 |
| 状态 | 模块级 `reactive` 单例 | 不引 Pinia，小程序场景够用且更轻 |
| 数据源 | 现有后端 `http://8.133.255.202/api` | 公开 GET 接口齐全，浏览内容**无需登录** |
| 分类能力 | **端内聚合索引**（`utils/guideIndex.js`） | `/posts` 没有 platform 参数，平台归类只能在端内做（见下方硬约束 10） |
| 附加产出 | **H5 版**（同一套代码编译） | 可挂到现有服务器，手机浏览器开 IP 即可演示，绕开「小程序需 HTTPS 备案域名」限制 |

## 交付方式（已定：**不走上架**）

上架（正式发布）需依次通过 **HTTPS 域名 → 域名 ICP 备案 → 小程序 ICP 备案 → 类目审核** 四道关卡，
本项目只有 IP、未做任何备案，**第 1 关就过不去**（微信服务器域名不接受 IP）。
因此交付方式定为：

- ✅ **主交付：H5 版** —— 挂到 `8.133.255.202`，手机浏览器打开即可，完全不受小程序规则约束
- ✅ **答辩演示：开发者工具 + 真机预览** —— 手机端需在右上角菜单**打开调试**才会跳过合法域名校验
- ✅ **可选：小程序「体验版」（免备案）** —— 上传代码后在后台设为体验版、把老师同学加成「体验成员」，
  即可在微信里以**小程序的形态**打开。⚠️ 但**每个体验成员首次打开都要手动开一次调试**
  （右上角 `···` → 开发调试 → 打开调试 → 重启），否则 `http://8.133.255.202` 会被域名校验拦掉。
  详见 [`docs/微信内打开方案.md`](docs/微信内打开方案.md)
- ❌ 不做正式上架（正式发布必须先完成小程序 ICP 备案，且服务器域名必须 HTTPS 且不能是 IP，本项目第 1 关就过不去）

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
│   ├── 开发日志.md            小程序侧流水（与社区主日志分开记）
│   └── 优化评估.md            多视角体检报告（实测数字 + 三档优先级）
├── prototype/index.html      6 屏移动端原型（纯 HTML，浏览器直接打开）
├── tools/
│   └── gen-tabbar-icons.py   生成 tabBar 图标（改主题色时重跑，见下）
├── src/                      uni-app 源码
│   ├── main.js  App.vue  pages.json  manifest.json
│   ├── api/                  config.js（端点 + 平台档位单一来源）/ request.js / community.js
│   ├── utils/                guideIndex.js（端内聚合索引）/ guideQuery.js（纯筛选排序）
│   │                         format.js / content.js / stepParser.js / store.js / usePagedList.js
│   ├── components/           PlatformFilter / GameTile / PostCard / StepCard / EmptyState / ErrorState / Skeleton
│   ├── static/tabbar/        tabBar 图标（由 tools/ 脚本生成，勿手改）
│   └── pages/                index（攻略库）/ games / game·detail / post·detail / news / my / search
├── tests/                    单测 + 浏览器回归 + 产物验证服务器 + 诊断探针
└── README.md                 ← 本文档
```

> 📌 2026-09-17 删除了通用列表页 `pages/list/list`：首页改成端内聚合的攻略库之后，
> 它已经没有任何调用方（各页都有自己的落点），留着就是死代码。

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

⚠️ **`build:h5` 可能被本项目的删除守卫拦下**（`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`）——
uni 会一次性清掉 `dist/build/h5/assets` 里 70+ 个文件，超过守卫的批量阈值（50），于是 `Build failed`。
这不是构建错误，源码也没问题。绕法是**先把旧产物挪开**，让 uni 无需删除：

```bash
mv dist dist_bak_$(date +%H%M%S) && npm run build:h5
```

`dist_bak*/` 已在 `miniprogram/.gitignore` 里，不会脏工作区；`.dockerignore` 又整体排除了
`miniprogram`，所以也不进构建上下文。攒够了记得删，别长期堆着。

微信开发者工具里需勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**，
这样才能直连 `http://8.133.255.202/api`（后端无需改动）。

### 回归验证（改完必跑）

```bash
cd miniprogram

# ⓪ 静态审计：抓「用了某个符号却没 import」（uni-app 构建不做类型检查，纯静默故障）
python tools/audit-imports.py           # 扫 src/；--self-test 只验工具本身
#   ↑ 2026-09-17 真踩过：PostCard.vue 用了 platformLabel 但漏 import，
#     构建成功、页面照渲染，**只是平台角标一个都不出来**（回归 A9 = 0 才抓到）。
#     工具自带 5 例正/反例自检，防止「检查工具本身失灵」。

# ① 单测：拆解器 25 + 正文解析 15 + 端内查询 32（直接 import 被测源码）
node --experimental-default-type=module tests/stepParser.test.mjs
node --experimental-default-type=module tests/content.test.mjs
node --experimental-default-type=module tests/guideQuery.test.mjs

# ② 浏览器回归 82 项（打在**真实构建产物**上）
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
- 🚨 **别用裸 `localStorage` 去读端内索引**：uni-app H5 的 `uni.setStorageSync(key, obj)`
  会套一层 `{type,data}` 信封，`JSON.parse(localStorage.getItem(key)).items` 永远是 `undefined`
  ⇒ 断言恒读到 0，看起来像「索引没建/内容池是空的」，实际是**脚本自身的坑**
  （2026-09-17 的 D5 就这样假失败了一次）。取数一律走 `uni.getStorageSync`，
  或者干脆**别读存储、直接打接口算真值** —— 后者更硬，D5 现在就是这么判的。
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
8. 🚨 **`GET /posts/{id}/replies` 的 `data` 是「裸数组」，不是分页体。**
   实测 `Result.data` 直接是 `list`（且 `current`/`size` 会被服务端忽略，一次给全部）。
   详情页原来按分页体读 `r.records` / `r.total` ⇒ 两个字段恒 `undefined`
   ⇒ **回复区永远显示「还没有回复」、标题永远「回复 0」**，27 条回复的讨论串一条都看不到，
   而且它伪装成正常的空态，线上挂了很久才被发现。
   归一化统一收在 `api/community.js#fetchReplies`（返回 `{records,total}`，同时兼容分页体），
   **不要在页面里直接读 `data.records`**。
   📌 2026-09-17 定位调整后**详情页已不再展示回复**（弱化互动），但这条接口事实必须留在代码里 ——
   将来真要做只读讨论视图时，**必须走 `fetchReplies`**，否则会原样再踩一遍。
   📌 同类接口 `GET /posts/{id}/tags` 也返回裸数组（该处已有 `Array.isArray` 防御）。
9. 🚨 **平台筛选只能在端内做 —— `/posts` 没有 `platform` 参数。**
   实测：`/posts` 只接受 `boardId / gameId / sort / current / size`，传 `platform` 会被**静默忽略**
   （四种取值都返回同一个 total）；`post` 表也没有 platform 列，**platform 只存在于 `game` 表**。
   所以「按平台筛文章」只能用 `gameId → game.platform` 这条映射在端内推导。
   实现见 `utils/guideIndex.js`，要点与代价：
   · **一次同步**：拉干货池全量（攻略 155 + 资讯 99，3 个请求）+ 全部游戏（80 款，1 个请求）
     建立映射，裁剪字段后写本地存储（约 130KB），TTL 10 分钟、下拉刷新可强刷；
   · 之后平台筛选 / 排序 / 分页全在内存里 ⇒ **切标签零请求**，
     而且能在按钮上显示**精确篇数**（服务端排序接口给不了这个）；
   · 代价如实记：首次同步要走一次全量（gzip 后约 100KB），新帖要等下次同步才出现；
     内容涨到几千帖时应改成后端加参数（join `game` 表即可，**不必改表结构**）。
   ⚠️ **展示名与取值不是一回事**：库里存 `手机`，界面写 `手游`。按钮的 `value` 必须是 `手机`，
   只有 label 是 `手游`（改错会导致该档永远筛出 0 篇）。`tests/guideQuery.test.mjs` D4 专门盯这条。
   📌 与**游戏库**的差别：`/games?platform=&genre=` 是后端原生支持的 ⇒ 那边走真·服务端分页。
   两处筛选的条数都取自同一份游戏元数据缓存，口径一致。
10. 🚨 **拆解器不许静默丢内容**（`utils/stepParser.js`）。
   2026-09-17 内容富化后，真实长文把三处**静默丢失**全打了出来，都不会报错、不会空屏，
   只是让用户看到一篇「看起来完整、其实少了内容」的文章：
   · `MAX_ITEMS = 12` 硬截断 —— 线上那篇原文 16 条，第 13~16 条整段消失；
   · 「首个序号之前的前言直接丢弃」—— 丢的是交代背景的**导语**；
   · `【第一梯队：不做会直接卡关】` 这类**分组标题行**被丢弃 —— 文章的组织结构整个没了。
   现在：导语 → `intro`；分组标题 → 条目的 `section`（页面渲染成小节）；
   上限放宽到 60，**真截断时会返回 `truncated`/`omitted` 并由页面显式提示**。
   · 顺带一条：**长条目必须拆成「标题 + 描述」**，不能整行当标题 ——
     标题有 30 字展示上限，会被 `tidy` 截掉，实测那篇因此只保住 55% 的正文（现在 97%）。
11. **H5 是主交付渠道，所以「宽屏」必须处理；小字必须过 AA 对比度。**
   · uni-app 默认**不给内容宽度上限**：实测 1440px 桌面下帖子卡被拉到 1412px、
     标题行可用宽 1243px（一行上百个汉字，没法读）。`App.vue` 里用
     `/* #ifdef H5 */ @media (min-width:768px)` 把 `.mp-page` 收成 760px 居中；
   · 弱化文字原为 `#6f6a80`，对卡片底色 `#1a1725` 只有 **3.39:1**（低于 WCAG AA 的 4.5:1，
     11px 的元信息整行读不清）。现为 `#8b8599`（4.96:1），次级文字提到 `#a49eb6`（6.82:1），
     保持「主 > 次 > 弱」层级不倒挂。
   · 回归里 `G6a/G6b` 用 1440px 视口量卡片宽度与横向溢出；`tests/probe-review.cjs` 打印各选择器实测对比度。

### 三条工程约定（评审最容易问的地方）

- **「请求失败」≠「结果为 0」。** 所有列表页失败的归宿是 `ErrorState`（含重试按钮），
  只有「请求成功且为空」才允许走 `EmptyState`。原来四个页面都把异常 `catch` 成空数组，
  后端一卡就显示「没有找到匹配的游戏 / 换个关键词试试」—— 把系统故障说成内容本来就没有。
  分页/失败/重试已收口到 `utils/usePagedList.js`，别再各页自己写一份。
  端内聚合索引多了一档**「同步失败但拿旧内容兜底」**：这时页面顶部会出现
  「内容同步失败，当前显示的是上次同步结果，点此重试」，不会让用户以为这就是最新的。
- **不做假动作。** 本端不登录，所以底部操作条只保留真的能做的动作：
  **点赞 / 收藏 / 分享**，且点赞与收藏都**只写本机**（`utils/store.js`），
  页面上的 `likeCount` 仍是服务端真实数字、**不做 +1 伪装**；`我的` 页写「访客模式」而不是「未登录」，
  并明确标注「记录保存在本机」。
  ⚠️ 写满上限（200 条）时**不再静默丢弃最旧一条**（原来那样会让用户以为收藏成功了），
  而是如实提示「本机收藏已满，请先到『我的』清理」。
- 🚨 **凡是被「兜底 / 空态」掩盖的故障，必须有直接断言。**
  本项目连续踩了三次同一类坑，每次都是**回归全绿但用户看到的东西是坏的**：
  | 故障 | 被什么掩盖 | 现在的直接断言 |
  |---|---|---|
  | 图片全挂（`/m/api/files/*`） | `@error` 把破图画成正常色块 | `G4a/G4b` 查**网络响应**，不看 DOM |
  | 请求失败 | `catch` 清空数组 → 空态 | `H1~H6` 断网后断言出现「重试」而非空态话术 |
  | 平台归类写错（按钮数字与列表对不上） | 筛选后只剩少量卡片，看着「也正常」 | `A6/A7/A11/A13` **先独立打接口把每个平台的真实篇数算出来**，再对按钮数字与卡片角标 |
  | 调了不存在的 GET（`/posts/{id}/tags` 只有 PUT） | `catch` 静默吞掉，但 toast 已弹出「请求方法不支持：GET」 | `B0a` 监听网络请求**断言该请求不再发出**；`B0b` 标签渲染数 = 详情接口自带 `tags` 数 |
  判据要落在**事实**上（网络响应、接口返回的条数），而不是「页面上有没有这个元素」——
  因为这类故障的特征恰恰是「页面看起来很正常」。
  📌 历史教训：上一版这里还写着「`B13~B20` 拿接口条数对 DOM 条数」——那是**回复区**的断言。
  定位调整后回复区已按产品口径移除，该组断言随之变成「回复元素必须为 0」（`B16~B18`）。
12. 🚨 **微信 AppID 不进 Git**（2026-09-18 GitHub 密钥扫描告警后清史重写）。
   仓库里 `src/manifest.json` 的 `mp-weixin.appid` **永远是 `""`**；真实 AppID 只存本机
   `.env.local`（已被 `.gitignore` 覆盖）。要用微信开发者工具 / 出 mp-weixin 包时：
   `npm run appid:inject` 注入 → 用完 `npm run appid:restore` 还原（**提交/发版前必须还原**，
   否则工作区脏会被拒发）。别再手写 `"appid": "wx…"` 进任何被跟踪的文件。


## 视觉基调

延续社区主题：深色底 + YUMU 紫 `#7C5CFF` + 电竞青 `#19E3C2`。

## 相关文档

- 完整方案：[`docs/方案设计.md`](docs/方案设计.md)
- 主项目 README：[`../README.md`](../README.md)
