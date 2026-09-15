# B2：后端镜像 —— 多阶段构建（Maven 编译 → JRE 运行）
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
# 国内加速（9-13）：dependency:go-offline 直连 Maven Central 在国内 ECS 上常需 5~15 分钟，
# 默认改用阿里云公共镜像（settings.xml 只镜像 central，不影响其他仓库）。
# 可用 --build-arg MAVEN_MIRROR=... 覆盖。
ARG MAVEN_MIRROR=https://maven.aliyun.com/repository/public
RUN mkdir -p /root/.m2 && printf '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"><mirrors><mirror><id>cn-mirror</id><mirrorOf>central</mirrorOf><url>%s</url></mirror></mirrors></settings>' "$MAVEN_MIRROR" > /root/.m2/settings.xml
# 9-15：JVM 内存护栏，专治「构建到 mvn 这步就不动了」。
#   · 不设时 Maven 按**宿主机总内存**估算堆。服务器上 mysql/redis/backend/nginx 四个容器
#     同时在跑，Maven 再抢一大块，内存不够就狂刷 swap —— 表现就是构建长时间零进展
#     （看着像卡死，其实在硬撑），更严重时直接被内核 OOM Killer 杀掉。
#   · 固定上限让 Maven 与容器和平共处。机器内存大想放宽：--build-arg MAVEN_OPTS=...
ARG MAVEN_OPTS="-Xmx768m -XX:MaxMetaspaceSize=320m -Dfile.encoding=UTF-8"
ENV MAVEN_OPTS=$MAVEN_OPTS

# 先拷 pom 下依赖，利用 Docker 层缓存加速后续构建
RUN mvn -B dependency:go-offline -DskipTests
COPY src ./src
# 9-15：原来用 -q，而 Maven 的 quiet 模式**只打 ERROR** —— 整个编译过程在终端上
#   就是一片空白，网页终端里看上去完全等同于「卡死」。改 -B（batch mode）逐行打
#   日志，能看到 Compiling / Building jar 的真实进度，是真在跑还是真死了立刻可辨。
#   -Dmaven.test.skip=true 比 -DskipTests 更彻底：连测试源码都不编译（本项目有单测类），
#   实打实省掉一次 javac，小机器上提升明显。
RUN mvn -B package -Dmaven.test.skip=true

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
