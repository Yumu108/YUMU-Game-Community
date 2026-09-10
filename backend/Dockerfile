# B2：后端镜像 —— 多阶段构建（Maven 编译 → JRE 运行）
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
# 先拷 pom 下依赖，利用 Docker 层缓存加速后续构建
RUN mvn -q dependency:go-offline -DskipTests
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
# B5：healthcheck 需要 curl；若基础镜像已自带则跳过 apt（避免构建时依赖外网）
RUN command -v curl || (apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*)

# D6（9-10）：非 root 运行 + 固定 UID/GID。
#   · UID/GID 固定为 1000 —— 与多数 Linux 发行版首个普通用户一致，便于宿主机
#     bind mount（./logs）的属主对齐；不固定的话容器内用户与宿主机目录属主对不上，
#     应用连日志都写不进去、启动即失败。
#   · 上传目录（命名卷）与日志目录必须归该用户所有，否则运行时 EACCES。
RUN groupadd -g 1000 yumu \
 && useradd -u 1000 -g 1000 -M -s /usr/sbin/nologin yumu \
 && mkdir -p /data/uploads /app/logs \
 && chown -R 1000:1000 /data /app

USER 1000:1000

WORKDIR /app
COPY --from=build /src/target/yumu-community-1.0.0.jar app.jar

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
