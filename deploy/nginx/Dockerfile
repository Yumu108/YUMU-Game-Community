# =============================================================================
# Nginx 边缘镜像（静态托管 + /api 反代）—— **只组装，不编译**（C 方案，2026-09-16）
# -----------------------------------------------------------------------------
# 原先这里有一个 node:20-alpine 阶段跑 `npm ci` + `npm run build`。它在服务器上
# 恰恰是最致命的一步：vite 的 rendering chunks 阶段既吃内存又长时间静默，
# 在 1.6Gi 可用内存的机器上会连带 mysql/backend 一起拖死（详见 backend/Dockerfile
# 顶部说明与 2026-09-16 的事故记录）。
#
# 现在前端在**本机**编译（npm run build 约 8 秒），产物推到服务器后本镜像只做 COPY。
#
# 约定：构建上下文（仓库根目录）里必须存在
#           frontend/dist/index.html
#       由本机 `bash deploy/tools/deploy-local.sh` 构建并推送。
#   ⚠️ 根目录 .dockerignore 里**不能**再用 `**/dist` 一刀切（会连 frontend/dist
#      一起排掉，镜像里就没有前端产物了），只能排 `frontend/dist_*/` 那些备份目录。
#
# 应急：若必须让服务器自己编译（内存吃紧时请勿）：
#       git show 98b6820:deploy/nginx/Dockerfile > deploy/nginx/Dockerfile && docker compose build nginx
# =============================================================================
FROM nginx:1.27-alpine
ENV TZ=Asia/Shanghai
COPY deploy/nginx/yumu.conf /etc/nginx/conf.d/default.conf
# D5（9-10）：安全响应头公共片段（server 与各 location 显式 include，规避 add_header 继承陷阱）
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
# 前端静态产物（本机 vite build 的 dist 原样搬进来）
COPY frontend/dist /usr/share/nginx/html
EXPOSE 80 443
