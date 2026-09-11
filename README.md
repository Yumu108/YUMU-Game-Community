# YUMU 游戏社区（YUMU Game Community）

面向年轻人的热门游戏讨论社区，主打 **游戏攻略 / 游戏吐槽 / 讨论教学**。毕业设计项目，采用前后端分离架构。

- 仓库地址：https://github.com/Yumu108/YUMU-Game-Community
- 默认分支：`master`

## 技术栈

| 层     | 技术                                                       |
| ----- | -------------------------------------------------------- |
| 前端    | Vue 3 + Vite + Element Plus + Pinia + Vue Router + Axios（路由懒加载 + Element 按需引入） |
| 后端    | Java 21 + Spring Boot 4.0.x + Spring Security + JWT      |
| 持久化   | MyBatis-Plus + MySQL 8                                |
| 缓存/消息 | Redis 7（Spring Data Redis，优雅降级）+ WebSocket 实时通知        |
| 安全    | JWT（2h 短期 + 退出黑名单 + 滑动续期）· Jsoup 富文本净化 · Redis 滑动窗口限频 · 敏感词/站外联系方式风控 · 上传 magic bytes 校验 |
| AI 助手 | DeepSeek（OpenAI 兼容 `/chat/completions`，可换 SiliconFlow / 本地 Ollama）· 社区知识库拼入 system prompt · SSE 流式 · 多轮记忆自持 · 无 key 自动 mock |
| 测试    | Node 22 `.mjs` 接口回归（tests/）+ playwright-core UI 回归（tests/.pw/） |
| 部署    | Nginx 反向代理 + Spring Boot + MySQL + Redis（docker-compose 四服务） |

## 目录结构

```
/YUMUGameCommunity
├── backend/            # Spring Boot Maven 工程（端口 8080，context-path /api）
├── frontend/           # Vue 3 + Vite 工程（端口 5173）
├── deploy/             # 部署编排：Nginx 配置、备份与监控脚本、密钥生成/数据库初始化/管理员初始化/上线自检工具
├── tests/              # Node .mjs 接口冒烟 / 回归测试（需后端 8080 运行）
│   └── .pw/            # Playwright UI 回归（playwright-core + 系统 Chrome，需 5173 + 8080 同时运行）
├── .github/workflows/  # CI：编译 + 单元测试 + 前端生产构建
├── docker-compose.yml  # mysql/redis/backend/nginx 四服务一键编排（nginx 镜像内含前端构建）
├── .env.example        # 生产环境变量模板（密钥外置；复制为 .env 后填入，.env 不入库）
└── README.md           # ← 本文档
```

## 获取代码

```bash
git clone https://github.com/Yumu108/YUMU-Game-Community.git
cd YUMU-Game-Community
```

## 环境要求

- **JDK 21**（Spring Boot 3 需要 Java 17+；本机默认 PATH 为 JDK8，路径 `C:\Program Files\Java\jdk-21`，构建/启动后端前请切到 JDK21）
- **Maven 3.9+**（本机 `D:\maven\apache-maven-3.9.9`；Windows 下用 `mvn.cmd`，并确保 `JAVA_HOME` 指向 JDK21）
- **Node 18+ / npm**
- **MySQL 8**（本机已装，root 密码 `123456`，库 `yumu_community`）
- **Redis 7**（本机未装，用 `docker compose up -d redis` 或整组编排起 Redis；后端对其优雅降级，不启动也能跑）

## 快速开始

> **核心原则：后端、前端各占一个终端窗口，谁都别关**（运行中的窗口被进程占用，新命令请另开窗口/标签页）。
> 首次启动需先建库灌种子（见步骤 1），之后日常只需步骤 2~4。

### 1. 初始化数据库（本机 MySQL，只做一次）

> 库里有数据/换机器后无需重复；先确认 MySQL 服务在跑（`net start mysql`，Windows 服务名可能带 MySQL 字样）。

```bash
# 建库建表（脚本自带 CREATE DATABASE yumu_community）
mysql -uroot -p123456 -h127.0.0.1 -P3306 < backend/src/main/resources/db/schema.sql
# 后续脚本需显式指定库名 yumu_community；务必带 --default-character-set=utf8mb4，否则中文乱码
mysql --default-character-set=utf8mb4 -uroot -p123456 -h127.0.0.1 -P3306 yumu_community < backend/src/main/resources/db/data.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 -h127.0.0.1 -P3306 yumu_community < backend/src/main/resources/db/init-boards.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 -h127.0.0.1 -P3306 yumu_community < backend/src/main/resources/db/seed-posts.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 -h127.0.0.1 -P3306 yumu_community < backend/src/main/resources/db/seed-tags.sql
```

> 账号：root / 123456；库名 `yumu_community`。`application.yml` 中的密码已同步为 `123456`。

### 2. 启动 Redis（可选，优雅降级）

> 后端已接入 Redis 缓存（`CacheService` 抽象 + `RedisCacheServiceImpl` + `LocalCacheServiceImpl` 兜底）：**Redis 不启动也能跑**（自动回退进程内缓存），起了 Redis 后 30s 自动切回。本地日常只起 Redis：
>
> ```bash
> docker compose up -d redis
> ```
>
> 查询当前缓存模式：`GET http://localhost:8080/api/system/cache-mode`

### 3. 启动后端

```bash
set JAVA_HOME=C:\Program Files\Java\jdk-21
mvn.cmd -f backend spring-boot:run "-Dspring-boot.run.arguments=--server.port=8080"
```

> ⚠️ 在 WorkBuddy 的 Bash 中**必须**加 `-Dspring-boot.run.arguments="--server.port=8080"`，否则应用会默认绑到 WorkBuddy 自身占用的 58727 端口而启动失败。PowerShell 中 `set` 不生效，请改用 `$env:JAVA_HOME="C:\Program Files\Java\jdk-21"`。

后端启动后访问：`http://localhost:8080/api`

> 💡 **密钥加载**：后端启动时自动读取项目根 `.env`（用于注入智能助手 `LLM_API_KEY` / `LLM_MOCK=false` 等）。不建 `.env` 也能跑 —— 智能助手会回退 mock 模式（用真实库数据生成演示回答）。
> 🚨 改前端源码后**必须 `npm run build`**：5173 提供的是构建产物（`/assets/index-*.js`），只改源码不构建是看不到效果的。

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端访问：`http://localhost:5173`（已配置 `/api` 代理到后端 8080）

## 开发说明

- 前端请求统一走 `src/api/request.js` 封装的 Axios 实例，自动携带 JWT、统一错误处理（**注意**：拦截器已解包 `Result`，业务代码直接拿 `Result.data`，不要再判 `.code`）。
- **token 会自动续期**：access token 有效期 2 小时；剩余不足 30 分钟或收到 401 时，前端自动调 `POST /auth/refresh` 换新 token 并重放请求。改这块代码前先看 `frontend/src/api/request.js`（尤其 `res.data.token` 这个字段路径，写错会导致"静默登出"）。
- **移动端**：断点约定 —— 详情页 900/760/420、顶栏 760/480；窄屏左栏改由顶栏汉堡唤出抽屉，抽屉内复用同一个 `SideNav`。⚠️ 移动端媒体查询**必须写在组件的 scoped `<style>` 块里**，写到非 scoped 块会被覆盖。
- 后端统一响应体、全局异常处理、JWT 拦截器见 `com.yumu.community.security` 包源码。
- 数据库表结构由 `backend/src/main/resources/db/schema.sql` 初始化（`data.sql` 写入角色种子），开发期手动执行该脚本建表。
- 安全相关（净化 / 限频 / 风控 / 上传校验）集中在 `com.yumu.community.security` 包与 `utils/ImageOptimizer`。

## 核心功能（2026-09-10 快照）

- 社区基础：板块（固定六分类，服务于游戏库）、帖子列表/详情/发布、**楼中楼回帖（平铺式）**、标签、搜索、用户主页、私信、通知、关注/粉丝。
- 互动：点赞/取消点赞、收藏、举报（管理员处理自动隐藏）；帖子作者可**删除/隐藏自己的帖子**；**@提及**（正文蓝色可点 + 触发通知 + 通知合并/待审不发/编辑补发）。
- 成长体系：每日签到（连续天数递增奖励）、积分明细、活跃度等级（发帖/回帖/获赞/登录累加）、Badge 徽章（🛡️管理员/⭐版主/🔹子版主）。
- 内容发现：每日精选/本周热门（系统自动选：人工加精优先 + 综合评分）、游戏库（条目 + 聚合帖 + 一键发帖挂 gameId）、**游戏专区主页 Game Hub**、板块/关键词订阅 + 个性化订阅流。
- 管理后台（ADMIN + MODERATOR 双角色）：用户管理（封禁/改密/删除/角色/版主板块分配）、游戏管理、公告管理、**帖子分层级审核**（按身份分流 + 驳回理由 + 通知作者）、举报队列 + 「我的举报」状态页；审核人可预览待审/隐藏帖（按负责板块限权）。
- **社区智能助手**：右下角面板，SSE 流式；后端**直连 DeepSeek**（OpenAI 兼容，可换 SiliconFlow / 本地 Ollama），每轮注入社区实时快照 + 自持知识库（`backend/src/main/resources/ai/`），多轮记忆走 `CacheService`；未配 key 时自动 mock 演示。真实 Key 放项目根 `.env`（已 gitignore）。
- **安全与合规**：Jsoup 服务端富文本净化、接口滑动窗口限频、敏感词 + 站外联系方式风控、注册协议与隐私政策页、上传五重校验（含 magic bytes）。
- **图片优化**：上传自动压缩（长边 1920）+ 生成缩略图（480），列表页走缩略图省流量；GIF/WEBP 直通不重编码。
- **移动端**：详情页 + 顶栏响应式断点，窄屏汉堡唤出**导航抽屉**（复用同一个 `SideNav` + 全宽搜索入口）。
- 个人主页：角色徽章 + 负责板块展示、获赞总数、积分、帖子列表。

## 常见问题

| 现象 | 原因 / 解决 |
|------|------|
| 后端启动报 `Port 58727 was already in use`，或应用没监听 8080 | 忘了加 `--server.port=8080`（WorkBuddy Bash 会默认绑到它自占的 58727），或没切 JDK21 |
| 后端报 JDK 版本错误或编译失败 | `JAVA_HOME` 还是 JDK8。先 `set JAVA_HOME=C:\Program Files\Java\jdk-21`（PowerShell 用 `$env:JAVA_HOME=...`） |
| 前端打开后接口 404 / 连不上后端 | 后端没起好或没在 8080；确认后端日志出现 `Started` 且 `http://localhost:8080/api` 可访问 |
| MySQL 连不上 / Access denied | `net start mysql` 启动服务；确认密码 `123456` |
| 页面中文乱码 / 方块字 | 灌库时没带 `--default-character-set=utf8mb4`；重跑带该参数的脚本 |
| 重启后端报 jar `Unable to rename` | 8080 被旧 java 进程占用锁住 jar；先停掉旧进程再 `mvn package` |
| 探测 `127.0.0.1:5173` 连不上 / 返回 502 | Vite 默认监听 `[::1]`（IPv6），且本机代理会把 `127.0.0.1` 打成 502。**一律用 `localhost` 探测** |
| 页面缺图标 / 控制台报 `Failed to resolve component` | `main.js` 里 Element 图标是**显式注册的 13 个**（为 tree-shake 精简过）。新增图标用完必须去 `main.js` 补注册；**注意属性式用法 `:prefix-icon="Xxx"` 用正则扫标签扫不出来**，改完要真跑一遍 UI 看控制台 |
| 改 Element 样式不生效（被官方样式盖掉） | 已按需引入，**入口 CSS 先于懒加载 chunk 的 `el-xxx.css` 加载**。覆盖 Element 的规则要自提特异性（如 `html .el-skeleton`），或加 `!important` |
| `ElMessage` / `ElMessageBox` 怎么用 | 已由 `unplugin-auto-import` 按需注入，**直接用即可、不要手写 import**（手写会绕过样式注入，出现"有提示框但没样式"） |
| `npm run dev` 起不来，报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | Vite 依赖预构建删 `node_modules/.vite/deps_temp_*` 被宿主安全删除守卫拦截。启动前 `unset CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR CODEBUDDY_TOOL_CALL_ID CODEBUDDY_SAFE_DELETE_BULK_GUARD`（用子 shell，勿用 `env -u`），或改用 `npm run preview` |
| `npm run preview` 下 POST 接口报 `Invalid CORS request` | 后端 CORS 白名单只放行 `http://localhost:5173`，preview 默认 4173 会被拦。**preview 用 `--port 5173`** |
| 用户改昵称后旧 token 立刻 401 | `JwtAuthenticationFilter` 必须用 token 的 **`uid` claim + `loadUserById`** 解析身份，不能用 `subject`(登录账号) |
| 非公开帖（待审/隐藏）点赞/回帖报 403 | 设计如此：非公开帖完全只读，**作者本人在审核期也不放行**；管理员/授权版主可走 `previewOnly` 预览 |

## 演示账号

> ⚠️ **D2（9-10）起，仓库内不再记录任何可直接登录的管理员口令**。管理员账号由脚本创建/重置：

```bash
# 生成随机强口令并创建（或重置）管理员 —— 会打印明文口令，请立即保存
./deploy/tools/init-admin.sh

# 或指定口令
./deploy/tools/init-admin.sh '你的强口令'

# 服务器上（容器部署、没装 JDK 与 mysql 客户端）用容器模式
./deploy/tools/init-admin.sh --docker
```

- **管理员**：`admin`，口令由上面的脚本设置（不写入仓库）
- **本地开发库**：当前口令记录在本机 `.env` 的 `ADMIN_INIT_PASSWORD`（该文件已 gitignore）
- 种子演示用户（yumu 等）：密码统一 `123456`

## 回归测试

```bash
# 单元测试（后端）—— 不需要任何外部服务，CI 也在跑
cd backend && mvn -o package          # 28/28（HtmlSanitizer / ImageMagicByteValidator / AuditActions / JwtUtil）

# 接口层（需后端 8080 在跑；中文负载请用 node fetch，别用 curl）
cd tests && node api-e2e-test.mjs
cd tests && node audit-log-verify.mjs            # 审计日志（28 项）

# UI 层（需 dev server 5173 + 后端 8080 同时运行）
cd tests/.pw && node verify-drawer.js            # 移动端导航抽屉（33 项）
cd tests/.pw && node verify-desktop.js           # 桌面端无回归（9 项）
cd tests/.pw && node verify-mobile-renew.js layout   # 390px 详情页适配（10 项）
cd tests/.pw && node verify-audit-tab.js          # 管理后台审计日志 Tab（14 项）
```

## 部署上线

> 生产部署全部走 `deploy/` 下的脚本 + 根目录 `docker-compose.yml`（四容器：mysql 8 / redis 7 / backend / nginx，前端构建已做进 nginx 镜像）。核心命令：

```bash
cd /opt/yumu && set -a && . ./.env && set +a   # 载入生产环境变量

./deploy/tools/gen-secrets.sh --write          # 1) 生成生产密钥（写入 .env）
./deploy/tools/init-db.sh                      # 2) 初始化全新数据库（⚠️ 仅全新库）
./deploy/tools/init-admin.sh --docker          # 3) 创建管理员（容器模式免装 JDK）
CHECK_URL=http://127.0.0.1/api/actuator/health ./deploy/tools/preflight-check.sh --live   # 4) 上线前自检
docker compose up -d --build                   # 5) 启动
```

> 部署配套说明见 `deploy/nginx/README.md` 与 `deploy/monitor/README.md`（HTTPS 配置、探活告警细节）。
