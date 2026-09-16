# =============================================================================
# 后端镜像 —— **只组装，不编译**（C 方案，2026-09-16）
# -----------------------------------------------------------------------------
# 为什么改成纯 COPY（原先是 maven:3.9-eclipse-temurin-21 多阶段编译）：
#
#   线上服务器是 2 核 / **可用内存只有 1.6Gi**，而常驻进程（mysql 368M + java 245M
#   + 宝塔面板 105M + dockerd/containerd/阿里云盾 ≈ 110M）已经吃掉约 820M。
#   在这台机器上再跑一次 Maven（-Xmx768m + Metaspace 320m）必然把内存打爆 → 狂刷
#   swap → 整机假死。2026-09-16 实测：/api 连续 90 秒不响应、连 nginx 都抢不到 CPU、
#   最后整个站点无应答，多次发版全部卡死在这一步（前端 vite 同理）。
#
#   ⇒ 编译挪到本机（实测 mvn package 全量 17s、npm run build 8s，比服务器快一个数量级），
#     服务器只承担「把产物装进镜像 + 跑起来」。
#
# 约定：构建上下文（./backend）里必须存在
#           target/yumu-community-1.0.0.jar
#       由本机 `bash deploy/tools/deploy-local.sh` 构建并推送。
#   ⚠️ 因此 backend/.dockerignore 里**不能**把 target/ 整目录排掉（原先排了），
#      只能 `target/*` + 反选 jar —— 否则 jar 进不了上下文，构建报
#      "target/yumu-community-1.0.0.jar: not found"。
#
# 应急：若必须让服务器自己编译（内存吃紧时请勿），用 git 取回旧版 Dockerfile：
#       git show 98b6820:backend/Dockerfile > backend/Dockerfile && docker compose build backend
# =============================================================================
FROM eclipse-temurin:21-jre

# B5：healthcheck 需要 curl；若基础镜像已自带则跳过 apt（避免构建时依赖外网）
RUN command -v curl || (apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*)

# D6（9-10）：非 root 运行 + 固定 UID/GID。
#   · UID/GID 固定为 1000 —— 与多数 Linux 发行版首个普通用户一致，便于宿主机
#     bind mount（./logs）的属主对齐；不固定的话容器内用户与宿主机目录属主对不上，
#     应用连日志都写不进去、启动即失败。
#   · 上传目录（命名卷）与日志目录必须归该用户所有，否则运行时 EACCES。
#   · 兼容性（9-13）：eclipse-temurin:21-jre 升级到 Ubuntu 24.04 底座后自带
#     UID/GID 1000 的 ubuntu 默认用户，直接 groupadd -g 1000 会报
#     "GID '1000' already exists"（exit 4）。故先清掉 1000 的既有用户/组再创建，
#     新旧底座（无默认用户）也兼容（条件判断跳过）。
RUN if getent passwd 1000 >/dev/null 2>&1; then userdel -r "$(getent passwd 1000 | cut -d: -f1)" 2>/dev/null || true; fi \
 && if getent group 1000 >/dev/null 2>&1; then groupdel "$(getent group 1000 | cut -d: -f1)" 2>/dev/null || true; fi \
 && groupadd -g 1000 yumu \
 && useradd -u 1000 -g 1000 -M -s /usr/sbin/nologin yumu \
 && mkdir -p /data/uploads /app/logs \
 && chown -R 1000:1000 /data /app

USER 1000:1000

WORKDIR /app
# 唯一一行「真正跟代码有关」的指令：把本机构建好的可执行 jar 装进来。
COPY target/yumu-community-1.0.0.jar app.jar

# D6：JVM 内存护栏。容器被 compose 的 mem_limit 限制时，堆按容器上限的 75% 估算；
# 不设的话 JVM 会按**宿主机总内存**估算堆，容器很容易被 OOM Killer 杀掉。
# 需要更大堆时通过 compose 的 environment 覆盖 JAVA_OPTS 即可。
# ⚠️ 注意：注释不能写在续行的 ENV 指令中间（会被拼进变量值），故单独放在上面。
ENV TZ=Asia/Shanghai \
    UPLOAD_DIR=/data/uploads \
    LOG_DIR=/app/logs \
    DB_HOST=mysql \
    DB_PORT=3306 \
    DB_NAME=yumu_community \
    REDIS_HOST=redis \
    REDIS_PORT=6379 \
    JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"

EXPOSE 8080

# 用 sh -c 以便展开 JAVA_OPTS；exec 让 java 接管 PID 1，SIGTERM 才能触发 Spring 优雅停机
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
