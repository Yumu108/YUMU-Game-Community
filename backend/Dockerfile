# B2：后端镜像 —— 多阶段构建（Maven 编译 → JRE 运行）
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
# 先拷 pom 下依赖，利用 Docker 层缓存加速后续构建
RUN mvn -q dependency:go-offline -DskipTests
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
# 上传目录（B4/A4：生产挂载卷持久化）+ 日志目录（B5：挂载到宿主机 ./logs）
RUN mkdir -p /data/uploads /app/logs
# B5：healthcheck 需要 curl；若基础镜像已自带则跳过 apt（避免构建时依赖外网）
RUN command -v curl || (apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*)
COPY --from=build /src/target/yumu-community-1.0.0.jar app.jar
ENV TZ=Asia/Shanghai \
    UPLOAD_DIR=/data/uploads \
    LOG_DIR=/app/logs \
    DB_HOST=mysql \
    DB_PORT=3306 \
    DB_NAME=yumu_community \
    REDIS_HOST=redis \
    REDIS_PORT=6379
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
