#!/usr/bin/env bash
# =============================================================================
# 全新数据库初始化（首次部署 / 换机重建时使用）
# -----------------------------------------------------------------------------
# 解决什么问题：
#   docker-compose 里的 mysql 容器只会「建一个空库 yumu_community」，
#   它不会建表、不会灌种子 —— 后端也没有 Flyway/Liquibase 自动迁移。
#   所以全新环境必须**手工按顺序**导入 SQL，顺序错了会缺表或外键失败。
#   本脚本把这个顺序固化下来，避免每次部署靠记忆。
#
# 用法：
#   ./init-db.sh                 # 交互确认后导入「结构 + 种子 + 演示内容」
#   ./init-db.sh --yes           # 跳过交互确认（适合脚本化）
#   ./init-db.sh --no-demo       # 只导结构+种子，不灌演示帖子（正式社区用）
#   ./init-db.sh --list          # 只打印执行顺序，不执行
#
# ⚠️⚠️ 极重要：`schema.sql` 第一行就是 `DROP DATABASE IF EXISTS yumu_community`
#   —— 它会把整个库**清空重建**。因此：
#     · 本脚本只适用于**全新数据库**；
#     · 线上已有数据的库升级，请走「增量迁移」（只执行新增的 0xx-*.sql），
#       或直接用 deploy/backup/db-restore.sh 恢复备份 —— 千万不要跑本脚本。
#
# 依赖：docker（容器模式，首选）或本机 mysql 客户端（降级）。
# 连接信息从项目根 .env 读取（与 docker-compose 共用同一份），环境变量可覆盖。
# =============================================================================
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BASE_DIR/../.." && pwd)"
DB_DIR="$ROOT_DIR/backend/src/main/resources/db"

# ---- 读取 .env ----
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

CONTAINER="${YUMU_MYSQL_CONTAINER:-yumu-mysql}"
DB_NAME="${DB_NAME:-yumu_community}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USERNAME:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"

# ---- 参数 ----
ASSUME_YES=0
NO_DEMO=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)  ASSUME_YES=1 ;;
    --no-demo) NO_DEMO=1 ;;
    --list)    LIST_ONLY=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（支持 --yes / --no-demo / --list / --help）" >&2; exit 2 ;;
  esac
done

# ---- 执行顺序（顺序即依赖，勿随意调整）----
#   schema.sql          建库建表（DROP DATABASE + CREATE + 全部 CREATE TABLE）
#   data.sql            role 表三种角色（USER/MODERATOR/ADMIN）—— 用户系统依赖
#   init-boards.sql     固定六板块（攻略心得/游戏吐槽/组队大厅/资讯速递/二次创作/其他）
#   seed-tags.sql       12 个标签 + 按 id 取模回灌 post_tag
#   015-game-seed.sql   26 款游戏库（幂等 ON DUPLICATE KEY UPDATE）
#   016-v12-content-reset.sql  演示内容：清空内容表后灌入覆盖「热门游戏 × 六板块」的帖子
SCHEMA_FILES=(
  "schema.sql"
  "data.sql"
  "init-boards.sql"
  "seed-tags.sql"
  "015-game-seed.sql"
)
DEMO_FILES=(
  "016-v12-content-reset.sql"
)

if [ "${LIST_ONLY:-0}" = "1" ]; then
  echo "执行顺序："
  i=0
  for f in "${SCHEMA_FILES[@]}"; do i=$((i+1)); printf '  %2d. %s\n' "$i" "$f"; done
  if [ "$NO_DEMO" -eq 0 ]; then
    for f in "${DEMO_FILES[@]}"; do i=$((i+1)); printf '  %2d. %s   ← 演示内容（--no-demo 可跳过）\n' "$i" "$f"; done
  fi
  exit 0
fi

# ---- 前置检查 ----
[ -d "$DB_DIR" ] || { echo "❌ 找不到 SQL 目录：$DB_DIR" >&2; exit 1; }
for f in "${SCHEMA_FILES[@]}" "${DEMO_FILES[@]}"; do
  [ -f "$DB_DIR/$f" ] || { echo "❌ 缺少 SQL 文件：$DB_DIR/$f" >&2; exit 1; }
done
if [ -z "$DB_PASSWORD" ]; then
  echo "❌ DB_PASSWORD 未设置：请在 $ENV_FILE 中配置，或先 export DB_PASSWORD=..." >&2
  exit 1
fi

USE_DOCKER=0
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; then
  USE_DOCKER=1
elif ! command -v mysql >/dev/null 2>&1; then
  echo "❌ 容器 $CONTAINER 未运行，且本机没有 mysql 客户端 —— 请先 docker compose up -d mysql" >&2
  exit 1
fi

if [ "$USE_DOCKER" -eq 1 ]; then
  TARGET_DESC="${DB_USER}@容器 ${CONTAINER} / ${DB_NAME}"
else
  TARGET_DESC="${DB_USER}@${DB_HOST}:${DB_PORT} / ${DB_NAME}"
fi
if [ "$NO_DEMO" -eq 1 ]; then MODE_DESC="仅结构与种子（无演示帖）"; else MODE_DESC="结构与种子 + 演示内容"; fi

echo "============================================================"
echo " YUMU 全新数据库初始化"
echo " 目标：$TARGET_DESC"
echo " 模式：$MODE_DESC"
echo "============================================================"
echo "⚠️  schema.sql 会先 DROP DATABASE —— 目标库现有数据将被**全部清空**！"
if [ "$ASSUME_YES" -ne 1 ]; then
  printf "确认继续？输入 yes 回车："
  read -r answer
  [ "$answer" = "yes" ] || { echo "已取消。"; exit 1; }
fi
echo

# 统一执行入口：$1=文件名  $2=是否指定库名(1=是)
run_sql() {
  local file="$1" use_db="$2" path="$DB_DIR/$file"
  printf '  → %-32s' "$file"
  if [ "$USE_DOCKER" -eq 1 ]; then
    if [ "$use_db" -eq 1 ]; then
      docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" \
        --default-character-set=utf8mb4 "$DB_NAME" < "$path"
    else
      # schema.sql 自带 CREATE DATABASE / USE，无需传库名
      docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" \
        --default-character-set=utf8mb4 < "$path"
    fi
  else
    if [ "$use_db" -eq 1 ]; then
      mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" \
        --default-character-set=utf8mb4 "$DB_NAME" < "$path"
    else
      mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" \
        --default-character-set=utf8mb4 < "$path"
    fi
  fi
  echo "✓"
}

TOTAL=${#SCHEMA_FILES[@]}
if [ "$NO_DEMO" -eq 0 ]; then TOTAL=$((TOTAL + ${#DEMO_FILES[@]})); fi

i=0
for f in "${SCHEMA_FILES[@]}"; do
  i=$((i+1))
  printf '[%d/%d] ' "$i" "$TOTAL"
  # schema.sql 不传库名（它自己建库）；其余都要显式指定库名
  if [ "$f" = "schema.sql" ]; then run_sql "$f" 0; else run_sql "$f" 1; fi
done

if [ "$NO_DEMO" -eq 0 ]; then
  for f in "${DEMO_FILES[@]}"; do
    i=$((i+1))
    printf '[%d/%d] ' "$i" "$TOTAL"
    run_sql "$f" 1
  done
fi

# ---- 校验 ----
echo
echo "---- 校验（各表行数）----"
Q="SELECT 'board' t, COUNT(*) n FROM ${DB_NAME}.board
   UNION ALL SELECT 'tag',      COUNT(*) FROM ${DB_NAME}.tag
   UNION ALL SELECT 'game',     COUNT(*) FROM ${DB_NAME}.game
   UNION ALL SELECT 'role',     COUNT(*) FROM ${DB_NAME}.role
   UNION ALL SELECT 'post',     COUNT(*) FROM ${DB_NAME}.post
   UNION ALL SELECT 'reply',    COUNT(*) FROM ${DB_NAME}.reply
   UNION ALL SELECT 'user',     COUNT(*) FROM ${DB_NAME}.user;"
if [ "$USE_DOCKER" -eq 1 ]; then
  docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" --default-character-set=utf8mb4 --table -e "$Q"
else
  mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" --default-character-set=utf8mb4 --table -e "$Q"
fi

echo
echo "✅ 数据库初始化完成。"
echo "   基线期望值：board=6、tag=12、game=26、role=3；post/reply/user 视是否导入演示内容而定。"
echo "   下一步："
echo "     1) ./deploy/tools/init-admin.sh          # 创建管理员（打印一次随机口令）"
echo "     2) ./deploy/tools/preflight-check.sh     # 上线前自检"
echo "     3) docker compose up -d --build"
