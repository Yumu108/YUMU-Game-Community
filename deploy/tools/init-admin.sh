#!/usr/bin/env bash
# ============================================================
# D2（9-10）：管理员账号初始化 / 口令重置（Linux 服务器使用）
# ------------------------------------------------------------
# 一句话解决两件事：
#   ① 新环境部署时**可复现地**创建管理员（此前只能手工建库，换机器就丢）；
#   ② 把管理员口令从仓库里的弱口令换成随机强口令。
#
# 用法：
#   ./init-admin.sh                    # 自动生成随机强口令并设置（推荐）
#   ./init-admin.sh '你的强口令'        # 用指定口令设置
#   ./init-admin.sh --docker           # 容器模式：无需宿主机 JDK/mysql 客户端
#   ./init-admin.sh --docker '强口令'
#   ADMIN_USERNAME=ops ./init-admin.sh # 换管理员登录名（默认 admin）
#
# 两种模式：
#   · 默认（宿主模式）：用宿主机 java + 后端 jar 生成 BCrypt + 宿主机 mysql 客户端执行 SQL。
#   · --docker（容器模式）：从**运行中的 backend 容器**取 java 生成哈希，
#     用 mysql 容器执行 SQL —— 全新服务器上通常没装 JDK 与 mysql 客户端，用这个更省事。
#     （容器模式要求 `docker compose up -d` 已把 backend/mysql 跑起来）
#
# 依赖：
#   宿主模式：java + mysql 客户端 + 已构建的 jar。
#   容器模式：docker（backend 与 mysql 容器均在运行）。
# 连接信息优先从项目根 .env 读取（与 docker-compose 共用同一份），环境变量可覆盖。
# ============================================================
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BASE_DIR/../.." && pwd)"
SQL_FILE="$BASE_DIR/init-admin.sql"

# ---- 参数：--docker 开关 + 可选的口令位置参数 ----
MODE="host"
PASSWORD_ARG=""
for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "[init-admin] 未知参数：$arg（支持 --docker / --help）" >&2; exit 2 ;;
    *) [ -z "$PASSWORD_ARG" ] && PASSWORD_ARG="$arg" ;;
  esac
done

# ---- 读取 .env（若存在）----
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

JAVA_BIN="${JAVA_BIN:-java}"
JAR="${YUMU_JAR:-$ROOT_DIR/backend/target/yumu-community-1.0.0.jar}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-yumu_community}"
DB_USER="${DB_USERNAME:-root}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

BACKEND_CONTAINER="${YUMU_BACKEND_CONTAINER:-yumu-backend}"
MYSQL_CONTAINER="${YUMU_MYSQL_CONTAINER:-yumu-mysql}"

# ---- 前置检查（早失败、错误信息可行动）----
[ -f "$SQL_FILE" ] || { echo "[init-admin] 找不到 $SQL_FILE" >&2; exit 1; }
if [ -z "${DB_PASSWORD:-}" ]; then
  echo "[init-admin] DB_PASSWORD 未设置：请在 $ENV_FILE 中配置，或先导出该环境变量" >&2
  exit 1
fi

if [ "$MODE" = "docker" ]; then
  command -v docker >/dev/null 2>&1 || { echo "[init-admin] 未找到 docker" >&2; exit 1; }
  running="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  printf '%s\n' "$running" | grep -q "^${BACKEND_CONTAINER}$" \
    || { echo "[init-admin] backend 容器 $BACKEND_CONTAINER 未运行 —— 先执行 docker compose up -d" >&2; exit 1; }
  printf '%s\n' "$running" | grep -q "^${MYSQL_CONTAINER}$" \
    || { echo "[init-admin] mysql 容器 $MYSQL_CONTAINER 未运行 —— 先执行 docker compose up -d mysql" >&2; exit 1; }
else
  [ -f "$JAR" ]      || { echo "[init-admin] 找不到后端 jar：$JAR" >&2
                          echo "             请先构建：cd backend && mvn -o package -DskipTests" >&2
                          echo "             或用容器模式（无需 JDK/mysql 客户端）：$0 --docker" >&2
                          echo "             或指定已有路径：YUMU_JAR=/path/to/yumu-community-1.0.0.jar $0" >&2; exit 1; }
  command -v "$JAVA_BIN"  >/dev/null 2>&1 || { echo "[init-admin] 找不到 java（可用 JAVA_BIN 指定绝对路径，或改用 $0 --docker）" >&2; exit 1; }
  command -v "$MYSQL_BIN" >/dev/null 2>&1 || { echo "[init-admin] 找不到 mysql 客户端（可用 MYSQL_BIN 指定绝对路径，或改用 $0 --docker）" >&2; exit 1; }
fi

# ---- 口令：显式传入，或自动生成 ----
PASSWORD="${PASSWORD_ARG:-}"
GENERATED=0
if [ -z "$PASSWORD" ]; then
  if command -v openssl >/dev/null 2>&1; then
    # 64 字节 base64 → 过滤掉易混字符（0/O/1/l/I）→ 取前 20 位
    PASSWORD="$(openssl rand -base64 64 | tr -dc 'A-HJ-NP-Za-km-z2-9!@#$%^&*' | head -c 20)" || true
  fi
  if [ -z "$PASSWORD" ]; then
    echo "[init-admin] 自动生成口令失败（缺少 openssl），请显式传入：$0 '你的强口令'" >&2
    exit 1
  fi
  GENERATED=1
fi

# ---- 生成 BCrypt 哈希（由后端 jar 内置工具完成，无需额外依赖）----
if [ "$MODE" = "docker" ]; then
  HASH="$(docker exec "$BACKEND_CONTAINER" java -jar /app/app.jar --gen-password-hash="$PASSWORD" | tail -n 1 | tr -d '\r')"
else
  # Windows(Git Bash/MSYS) 下 java.exe 不认 `/e/...` 形式的路径，交给 cygpath 转换；
  # Linux 服务器上没有 cygpath，原样使用即可。
  if command -v cygpath >/dev/null 2>&1; then
    JAR_FOR_JAVA="$(cygpath -w "$JAR")"
  else
    JAR_FOR_JAVA="$JAR"
  fi
  HASH="$("$JAVA_BIN" -jar "$JAR_FOR_JAVA" --gen-password-hash="$PASSWORD" | tail -n 1 | tr -d '\r')"
fi
case "$HASH" in
  \$2a\$*|\$2b\$*|\$2y\$*) : ;;
  *) echo "[init-admin] BCrypt 哈希生成异常，原始输出：$HASH" >&2; exit 1 ;;
esac

if [ "$MODE" = "docker" ]; then
  echo "[init-admin] 目标：${DB_USER}@容器 ${MYSQL_CONTAINER}/${DB_NAME} ｜ 管理员账号：${ADMIN_USERNAME}"
else
  echo "[init-admin] 目标：${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME} ｜ 管理员账号：${ADMIN_USERNAME}"
fi

# ---- 执行初始化 SQL（SET 变量 + 脚本内容一并喂给 mysql）----
{
  printf "SET @admin_password_hash='%s';\n" "$HASH"
  printf "SET @admin_username='%s';\n" "$ADMIN_USERNAME"
  cat "$SQL_FILE"
} | if [ "$MODE" = "docker" ]; then
      docker exec -i "$MYSQL_CONTAINER" mysql \
        --user="$DB_USER" --password="$DB_PASSWORD" \
        --default-character-set=utf8mb4 --table "$DB_NAME"
    else
      "$MYSQL_BIN" \
        --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="$DB_PASSWORD" \
        --default-character-set=utf8mb4 --table "$DB_NAME"
    fi

if [ "$GENERATED" -eq 1 ]; then
  echo ""
  echo "==================== 请立即保存（只显示这一次） ===================="
  echo " 管理员登录名 : $ADMIN_USERNAME"
  echo " 明文口令     : $PASSWORD"
  echo "=================================================================="
fi
echo "[init-admin] 完成：请用新口令登录，并尽快在个人设置中确认。"
