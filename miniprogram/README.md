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
├── src/                      uni-app 源码
│   ├── main.js  App.vue  pages.json  manifest.json
│   ├── api/                  config.js（端点单一来源）/ request.js / community.js
│   ├── utils/                format.js / content.js / stepParser.js / storage.js
│   ├── components/           GameTile / PostCard / StepCard / EmptyState / Skeleton
│   └── pages/                index / games / game·detail / post·detail / news / my / search / list
├── tests/                    单测 + 浏览器回归 + 产物验证服务器
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

# ① 解析器单测 20 项（直接 import 被测源码）
node --experimental-default-type=module tests/stepParser.test.mjs

# ② 浏览器回归 27 项（打在**真实构建产物**上）
npm run build:h5
node tests/serve-h5.mjs &                       # 起在 http://localhost:5199/m/
NODE_PATH="<repo>/tests/.pw/node_modules" node tests/verify-miniprogram.cjs
```

- `tests/serve-h5.mjs` 把 `dist/build/h5` 挂在 `/m/` 并把 `/api` 代理到线上 —— **必需**，
  否则产物里的相对路径 `/api` 找不到后端，页面会全是空数据。
- `NODE_PATH` 复用社区项目已装的 `playwright-core`，不重复安装。
- 诊断工具：`tests/probe-scroll.cjs`（打印 H5 真实滚动容器与触发条件）。
  遇到「上拉加载不生效」先跑它，**别直接改业务代码**。

## 四条硬约束（踩过坑，别再踩）

1. **分页参数是 `current` 和 `size`，不是 `page`。**
   实测 `page=2` 会被**静默忽略、恒返回第 1 页**，不报错。上拉加载写错会无限重复同一页。
2. **HTTP 状态码恒为 200**，成败看响应体的 `code` 字段（`Result{code,message,data}`）。
   分页体为 `PageResult{total,pages,current,size,records}`。
3. **个人主体不可用 `web-view`**，无法内嵌 B 站等外部播放器；
   项目里也没有任何视频相关代码。视频已**降级为详情页的可选模块**，不占主线。
4. **本小程序不上架**（2023-09 起须先完成小程序 ICP 备案，且服务器域名必须 HTTPS 且已备案）。
   开发期用开发者工具勾选「不校验合法域名」直连 IP；交付靠 H5 版。
5. **线上全部 18 款游戏的 `cover` 都是 `null`**，帖子封面也全为空（只有用户头像有图）。
   ⇒ 游戏卡必须**默认渲染「首字渐变色块」**（`utils/format.js` 的 `gameTile()`），有图才显示图；
   反过来写会让所有游戏卡片变成空白。
   📌 顺带：`curl -I`（HEAD）探 `/api/files/*` 会返回 **401**，别误判成「图片要鉴权」——
   放行规则只写了 `GET`，`<image>` 走 GET，不需要 token。


## 视觉基调

延续社区主题：深色底 + YUMU 紫 `#7C5CFF` + 电竞青 `#19E3C2`。

## 相关文档

- 完整方案：[`docs/方案设计.md`](docs/方案设计.md)
- 主项目 README：[`../README.md`](../README.md)
