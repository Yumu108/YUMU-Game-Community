#!/usr/bin/env bash
# =============================================================================
# 生产密钥生成器（上线前必跑一次）
# -----------------------------------------------------------------------------
# 解决什么问题：.env.example 里的 DB_PASSWORD / JWT_SECRET 是「占位值」，
#   直接拿去上线等于公开密码 —— D4 的启动自检会拒绝这类弱值，但**你得先有强值**。
#   本脚本一次生成全部需要的强随机密钥，并给出可直接粘贴的 .env 片段。
#
# 用法：
#   ./gen-secrets.sh                  # 只打印（默认，最安全，不落盘）
#   ./gen-secrets.sh --write          # 生成到项目根 .env（已存在则拒绝，需 --force）
#   ./gen-secrets.sh --write --force  # 覆盖已有 .env（会先备份为 .env.bak.<时间戳>）
#
# 安全约定：
#   · 生成的 .env 已被 .gitignore 忽略，绝不会进仓库；
#   · 脚本自身不写入任何密钥到源代码目录以外的位置；
#   · 输出打印时会给出「半掩码」提示，避免终端回滚缓冲区/录屏泄露完整密钥。
# =============================================================================
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BASE_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

WRITE=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（支持 --write / --force / --help）" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 随机源：优先 openssl，其次 /dev/urandom，最后 sha256 兜底
# 只保留 [A-Za-z0-9]：避免 + / = " ' # 空格 等字符把 .env 解析搞坏
# ---------------------------------------------------------------------------
gen_secret() {
  local bytes="${1:-48}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -dc 'A-Za-z0-9'
  elif [ -r /dev/urandom ]; then
    head -c "$bytes" /dev/urandom | base64 | tr -dc 'A-Za-z0-9'
  else
    # 兜底：拿高精度时间 + 进程号做哈希（强度较弱，仅保证脚本不中断）
    printf '%s%s%s' "$(date +%s%N)" "$$" "$RANDOM" | sha256sum | tr -dc 'A-Za-z0-9'
  fi
}

JWT_SECRET="$(gen_secret 48)"
MYSQL_ROOT_PASSWORD="$(gen_secret 24)"
DB_PASSWORD="$(gen_secret 24)"
ADMIN_INIT_PASSWORD="$(gen_secret 16)"

# 长度自检：JWT_SECRET 少于 32 字节会让 HS256 签名不安全（Keys.hmacShaKeyFor 会抛错）
[ "${#JWT_SECRET}" -ge 32 ] || { echo "❌ JWT_SECRET 生成长度不足（${#JWT_SECRET}），请检查随机源" >&2; exit 1; }

mask() { local s="$1"; printf '%s…%s(%d位)' "${s:0:4}" "${s: -4}" "${#s}"; }

echo "============================================================"
echo " 已生成生产密钥（仅本次运行有效）"
echo "============================================================"
echo " JWT_SECRET          = $(mask "$JWT_SECRET")"
echo " MYSQL_ROOT_PASSWORD = $(mask "$MYSQL_ROOT_PASSWORD")"
echo " DB_PASSWORD         = $(mask "$DB_PASSWORD")"
echo " 管理员初始口令        = $(mask "$ADMIN_INIT_PASSWORD")"
echo

if [ "$WRITE" -eq 0 ]; then
  echo "---- 可粘贴到 .env 的片段（注意：此处为完整明文，勿录屏/勿粘到聊天工具）----"
  cat <<EOF
SPRING_PROFILES_ACTIVE=prod
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
DB_USERNAME=root
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION_MS=7200000
CORS_ALLOWED_ORIGINS=https://your-domain.com
UPLOAD_DIR=/data/uploads
ADMIN_INIT_PASSWORD=${ADMIN_INIT_PASSWORD}
EOF
  echo
  echo "提示：确认无误后可直接执行 ——"
  echo "  $0 --write            # 写入 $ENV_FILE"
  echo "  ./deploy/tools/init-admin.sh '${ADMIN_INIT_PASSWORD}'   # 用上面的口令初始化管理员"
  exit 0
fi

# ---------------------------------------------------------------------------
# --write 模式
# ---------------------------------------------------------------------------
if [ -f "$ENV_FILE" ] && [ "$FORCE" -eq 0 ]; then
  echo "❌ $ENV_FILE 已存在。为避免覆盖线上正在使用的密钥，本脚本默认拒绝写入。" >&2
  echo "   如确认要覆盖：$0 --write --force（会先备份为 .env.bak.<时间戳>）" >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  BAK="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$BAK"
  echo "已备份原文件 → $BAK"
fi

cat > "$ENV_FILE" <<EOF
# 由 deploy/tools/gen-secrets.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ⚠️ 本文件含生产密钥，已被 .gitignore 忽略，切勿提交、切勿外发。
SPRING_PROFILES_ACTIVE=prod

# ---- MySQL ----
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
DB_USERNAME=root
DB_PASSWORD=${DB_PASSWORD}

# ---- 后端 ----
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION_MS=7200000
CORS_ALLOWED_ORIGINS=https://your-domain.com
UPLOAD_DIR=/data/uploads

# ---- 管理员（用完可清空；重置口令请跑 deploy/tools/init-admin.sh）----
ADMIN_INIT_PASSWORD=${ADMIN_INIT_PASSWORD}

# ---- 智能助手（按需填写；留空则走本地 mock）----
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-flash
LLM_MOCK=true
LLM_THINKING=false

# ---- 监控告警（B5；留空则降级为本地日志）----
ALERT_WEBHOOK_TYPE=wechat
ALERT_WEBHOOK_URL=
ALERT_FAIL_THRESHOLD=3
ALERT_DISK_MIN_FREE=10
EOF
chmod 600 "$ENV_FILE"

echo "✅ 已写入 $ENV_FILE（权限 600）"
echo "   备份位置（如有）：${BAK:-无（文件原不存在）}"
echo
echo "下一步："
echo "  1) 编辑该文件，把 CORS_ALLOWED_ORIGINS 改成你的真实域名、填 LLM_API_KEY / ALERT_WEBHOOK_URL"
echo "  2) ./deploy/tools/init-admin.sh '${ADMIN_INIT_PASSWORD}'   # 初始化管理员（口令即上面那串）"
echo "  3) ./deploy/tools/preflight-check.sh                       # 上线前自检"
echo "  4) docker compose up -d --build"
