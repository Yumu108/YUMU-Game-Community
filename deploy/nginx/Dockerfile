# B2：前端构建 + B1：Nginx 边缘服务（静态托管 + /api 反代）一体化镜像
# 构建上下文必须是仓库根目录：docker build -f deploy/nginx/Dockerfile .
FROM node:20-alpine AS frontend
# 国内服务器加速（9-13）：默认走 npmmirror 镜像源 —— 直连 registry.npmjs.org 在
# 国内 2 核 ECS 上 npm ci 常需 6~15 分钟。可用 --build-arg NPM_REGISTRY=... 覆盖。
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
ENV TZ=Asia/Shanghai
COPY deploy/nginx/yumu.conf /etc/nginx/conf.d/default.conf
# D5（9-10）：安全响应头公共片段（server 与各 location 显式 include，规避 add_header 继承陷阱）
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=frontend /fe/dist /usr/share/nginx/html
EXPOSE 80 443
