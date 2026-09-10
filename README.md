# YUMU 游戏社区（YUMU Game Community）

面向年轻人的热门游戏讨论社区，主打 **游戏攻略 / 游戏吐槽 / 讨论教学**。毕业设计项目，采用前后端分离架构。

- 仓库地址：https://github.com/Yumu108/YUMU-Game-Community
- 默认分支：`master`

## 技术栈

| 层     | 技术                                                       |
| ----- | -------------------------------------------------------- |
| 前端    | Vue 3 + Vite + Element Plus + Pinia + Vue Router + Axios |
| 后端    | Java 21 + Spring Boot 3.3.x + Spring Security + JWT      |
| 持久化   | MyBatis-Plus + MySQL 8                                |
| 缓存/消息 | Redis 7（Spring Data Redis）                               |
| 部署    | Nginx 反向代理 + Spring Boot + MySQL + Redis                 |

## 目录结构

```
/YUMUGameCommunity
├── backend/            # Spring Boot Maven 工程（端口 8080，context-path /api）
├── frontend/           # Vue 3 + Vite 工程（端口 5173）
├── deploy/             # 部署编排：docker-compose.yml（mysql/redis/backend/nginx 四服务）、Nginx 配置、备份与监控脚本
├── tests/              # Node .mjs 接口冒烟 / 回归测试（需后端 8080 运行）
├── docs/               # 近期开发总结合集、文档归档
├── 项目开发文档/        # 需求分析、技术选型等早期过程文档
├── 原型预览/           # 视觉原型
├── README.md           # ← 本文档
├── 项目进度总结.md      # 阶段进度主档（持续更新）
├── 项目功能与运行逻辑说明.md # 功能契约总文档
├── 项目开发日志.md      # 逐日开发流水（Day 1 起）
├── 玩家视角功能优化清单.md  # P0/P1/P2 产品需求清单
├── 上线前必做清单.md     # Go/No-Go 评估 + 安全/部署/合规状态跟踪
├── YUMU社区知识库.md     # 社区规则官方说明（上传扣子作助手知识库）
├── 智能助手接入说明.md   # 助手技术接入（扣子 Coze + SSE 代理）
└── yumu游戏社区助手-修订版.md # 助手 Prompt（整份粘贴到扣子 Bot）
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

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端访问：`http://localhost:5173`（已配置 `/api` 代理到后端 8080）

## 开发说明

- 前端请求统一走 `src/api/request.js` 封装的 Axios 实例，自动携带 JWT、统一错误处理（**注意**：拦截器已解包 `Result`，业务代码直接拿 `Result.data`，不要再判 `.code`）。
- 后端统一响应体、全局异常处理、JWT 拦截器将在「核心功能开发」阶段实现。
- 数据库表结构由 `backend/src/main/resources/db/schema.sql` 初始化（`data.sql` 写入角色种子），开发期手动执行该脚本建表。

## 核心功能（2026-08-21 快照）

- 社区基础：板块树（父板块聚合子板块）、帖子列表/详情/发布、楼中楼回帖、标签、搜索、用户主页、私信、通知、关注/粉丝。
- 互动：点赞/取消点赞、收藏、举报（管理员处理自动隐藏）；帖子作者可**删除/隐藏自己的帖子**（删除后帖数与获赞减少、隐藏后帖数减少获赞保留）。
- 成长体系：每日签到（连续天数递增奖励）、积分明细、活跃度等级（发帖/回帖/获赞/登录累加）、Badge 徽章（🛡️管理员/⭐版主/🔹子版主）。
- 内容发现：每日精选/本周热门（1.2 起系统自动选：人工加精优先 + 综合评分）、游戏库（条目+聚合帖+一键发帖挂 gameId）、板块/关键词订阅 + 个性化订阅流。
- 管理后台（ADMIN + MODERATOR 双角色）：用户管理（封禁/改密/删除/角色/版主板块分配）、板块管理、游戏管理、公告管理、帖子分层级审核（按身份分流 + 驳回理由 + 通知作者）、举报队列；**审核人可查看待审帖内容（按负责板块限权）**。
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

## 演示账号

- 管理员：`admin / admin123456`
- 种子演示用户（yumu 等）：密码统一 `123456`

## 文档导航

> 项目按七阶段推进（当前第六阶段「功能增强与体验优化」进行中）。各文档定位：
> `项目进度总结.md` 阶段进度｜`项目开发日志.md` 逐日流水｜`项目功能与运行逻辑说明.md` 功能契约｜`玩家视角功能优化清单.md` 产品需求（P0/P1/P2）｜`上线前必做清单.md` Go/No-Go 与安全/部署/合规清单｜`docs/近期开发总结.md` 近期阶段性汇总｜`YUMU社区知识库.md` + `yumu游戏社区助手-修订版.md` + `智能助手接入说明.md` 社区智能助手三件套。
