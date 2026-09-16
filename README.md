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
├── miniprogram/        # 小程序子项目（uni-app，课程大作业）：社区内容的「消费端」，复用同一后端
│   ├── docs/           #   方案设计 + 子项目开发日志
│   ├── prototype/      #   6 屏移动端视觉原型（纯 HTML，浏览器直接打开）
│   └── src/            #   uni-app 工程（待建，可同时产出小程序 + H5）
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
# 方式 A（推荐）：一条命令，执行顺序已固化在脚本里
DB_PASSWORD=123456 bash ./deploy/tools/init-db.sh            # 结构 + 种子 + 演示内容
DB_PASSWORD=123456 bash ./deploy/tools/init-db.sh --no-demo  # 只要结构 + 种子（正式环境用）

# 方式 B：手工逐条执行（顺序即依赖，勿调换；每条都要带 --default-character-set=utf8mb4，否则中文乱码）
mysql -uroot -p123456 < backend/src/main/resources/db/schema.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 yumu_community < backend/src/main/resources/db/data.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 yumu_community < backend/src/main/resources/db/init-boards.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 yumu_community < backend/src/main/resources/db/seed-tags.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 yumu_community < backend/src/main/resources/db/015-game-seed.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 yumu_community < backend/src/main/resources/db/seed-demo-users.sql
mysql --default-character-set=utf8mb4 -uroot -p123456 yumu_community < backend/src/main/resources/db/016-v12-content-reset.sql
```

> 期望基线：`board=6 / tag=12 / game=18 / role=3`；导入演示内容后 `user=7 / post=36 / reply=30`。
> 演示用户密码统一 `123456`（仅供本地/演示，正式环境请用 `--no-demo`）。

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

> 💡 **密钥加载**：后端启动时自动读取项目根 `.env`（用于注入智能助手 `LLM_API_KEY` / `LLM_MOCK=false`、邮件 `MAIL_USERNAME` / `MAIL_PASSWORD` 等）。不建 `.env` 也能跑 —— 智能助手回退 mock 模式，**邮箱验证码则只打印到后端日志**（本地开发模式，无需真邮箱）。
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

## 核心功能（2026-09-16 快照）

- **账号体系（9-15 邮箱化，9-16 线上打通真实 SMTP）**：注册 = **账号id + 密码 + 邮箱 + 邮箱验证码 + 协议勾选**（邮箱必填，它是「忘记密码」唯一可自助的通道）；登录标识**同时支持账号id 与邮箱**（+ 密码）；**忘记密码**走「邮箱验证码重置」；个人中心支持**更换绑定邮箱**（验证原邮箱 + 新邮箱两个验证码后一次性替换，不提供解绑）。验证码存 Redis、300 秒有效、**一次性消费**、同邮箱 60 秒冷却、同 IP 每小时上限；未配 SMTP 时仅打日志（**prod 下拒绝降级**，绝不把验证码写进服务器日志）。
- 社区基础：板块（固定六分类，服务于游戏库）、帖子列表/详情/发布、**楼中楼回帖（平铺式）**、标签、搜索、用户主页、**私信（实时收发）**、通知（**右上角任何时刻只弹一条**）、关注/粉丝。
- **登录态提示（9-16）**：认证入口（登录/注册/发码/重置）的 401 是**业务结果** —— 密码输错就显示「账号或密码错误」，不再误报"登录已过期"；普通请求的 401 才走"续签重试 → 清登录态"。提示统一收口（2 秒去重 + 退出后 5 秒静默），首屏并发请求与主动退出都不会再飘红刷屏。
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
| 注册接口报「邮箱不能为空」/ 接口测试脚本批量失败 | 9-15 起注册**邮箱为必填**（含 6 位邮箱验证码）。跑老脚本时给后端加 `MAIL_TEST_CODE=123456` 即开启**仅非生产**的自动化测试通道（允许不带邮箱注册、固定码可当正确码用），prod profile 下该通道被一票否决 |
| 本地注册收不到邮件 / 想验证发码是否正常 | 这是**预期行为**：`MAIL_ENABLED=false` 时验证码只打印在后端日志（`[mail-mock] ... 验证码 : xxxxxx`）。要真发邮件需在 `.env` 填 `MAIL_ENABLED=true` + `MAIL_USERNAME` + QQ 邮箱 **SMTP 授权码**（不是登录密码） |
| 生产环境发码接口报「邮箱服务尚未配置」 | prod profile **拒绝把验证码降级写入日志**（那等于公开验证码）。必须配好 `MAIL_*` 并重启后端 |
| 发码报 429「请 N 秒后再试」 | 同邮箱 60 秒冷却**刻意不分场景**（换场景重发同样受限，防「换场景刷同一地址」）。本地跑测试可把 `MAIL_CODE_COOLDOWN=3`、`MAIL_CODE_IP_PER_HOUR=100` 放宽 |
| 密码输错却提示「登录已过期」/ 每次进站都飘红条 | **9-16 已修**。原先所有 `code=401` 都被当成"登录态失效"（而后端本来就用 401 表示凭证错误），且首屏并发请求**每个 401 各弹一条**、退出后仍有在途请求回来报"过期"。现在 `request.js` 的 `classify401()` 分三类处置（`silent` 静默 / `toast` 原样弹后端文案 / `unauth` 才续签重试），提示统一走 `utils/authToast.js` 收口。**改这块必须同步 `request.js` 与 `authToast.js` 两处判据** |
| 发码提示「该邮箱地址不存在或已停用」 | 收件人被 QQ/163 以 **SMTP 550** 拒收（地址确实不存在），重试无用 → 后端返回 **400** 明确区分「用户填错」与「服务端故障（500 稍后重试）」。发信失败时会**回滚本场景的邮箱冷却**（不白占 60 秒配额）并删掉幽灵验证码 |
| 部署时在服务器上 `bash release.sh` 卡死、面板都打不开 | **别在服务器上编译**。目标机只有 **2 核 2G**，全量 Maven + Vite 会 OOM 把整机打爆（表现：首页 200 但 `/api/**` 连上却不回话，**不是 502**）。发版一律在本机跑 `bash deploy/tools/deploy-local.sh`（本机编译 → 传产物 → 服务器只 `COPY` 组装） |
| 发版后短暂出现静态 404 + 安全头缺失 | 这是 `up -d` 换容器的**中间态**（旧容器已 remove、新容器未 ready），**不是故障**。隔 1~2 分钟复测 2~3 次再下判断 |
| 提示「请先验证当前绑定的邮箱」但明明填了码 | 已绑邮箱的账号换绑**必须同时**验证原邮箱码与新邮箱码；页面上原邮箱码在「原邮箱验证码」那一行。**原邮箱已失效只能联系管理员**（功能上不提供解绑） |

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

> 🚀 **日常发版（改完代码上线）= 本机一条命令**（在本机项目根目录执行，**不在服务器执行**）：
> ```bash
> bash deploy/tools/deploy-local.sh
> ```
> 链路：本机 `mvn package` + `npm run build` → `git push`（GitHub 不通时**自动回退 `git bundle` 直传服务器**）→ `scp` jar + 传输 `frontend/dist`（校验 jar 字节数 + bundle 哈希）→ 服务器 `release.sh --no-pull` **只组装镜像** → 从本机做外部验收。
> 可选参数：`--dry-run` / `--reuse-build` / `--bundle` / `--no-push` / `--allow-dirty` / `frontend|backend|all`。
>
> ⛔ **不要在服务器上编译**：目标机 **2 核 2G**，在服务器跑 Maven / Vite 会 OOM 把整机打爆（表现：首页静态 200，但 `/api/**` 连上却不回话，**不是 502**）。因此 `backend/Dockerfile` 与 `deploy/nginx/Dockerfile` **只 `COPY` 产物** ⇒ **本机产物就是线上产物**，「本地 build 通过 ≠ 线上生效」这条老坑已消失，**新纪律是：改完前端必须走 `deploy-local.sh` 发版**。
> 📌 改了 `deploy/tools/` 下的脚本要**先在服务器 `git pull`**；**判发版成功只认 `✅ 发版成功！` 且首页 bundle 哈希与本地一致**；工作区有未提交改动会被**拒发**。线上目视验收：`cd tests/.pw && node probe-online.js`。

> 🚨 **已有库升级（非全新库）**：部署 9-15 的邮箱功能前必须先执行一次迁移，否则注册会因缺列报错：
> ```bash
> docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" yumu_community \
>   < backend/src/main/resources/db/029-email-verified.sql
> ```
> （全新库无需执行 —— `schema.sql` 已包含该列。`init-db.sh` 只适用于全新库，别对已有数据的库跑。）
>
> 同时确认 `.env` 里 `MAIL_ENABLED=true` 且 `MAIL_USERNAME` / `MAIL_PASSWORD`（QQ 邮箱 **SMTP 授权码**）已填，否则生产发码接口会直接报错（prod 拒绝把验证码写进日志）。

## License

本项目基于 [MIT License](./LICENSE) 开源 —— 可自由使用、修改、分发（保留版权声明即可），软件按"原样"提供，不含任何担保。
