#!/usr/bin/env bash
# =============================================================================
# 上线前自检（Pre-flight Check）
# -----------------------------------------------------------------------------
# 目的：把「上线才发现的配置问题」提前到部署前暴露。
#   绝大多数生产事故不是代码问题，而是：密钥没注入 / 仍是占位弱口令 /
#   CORS 忘了改域名 / 上传目录不可写 / 磁盘满了 / Docker 没起来。
#
# 用法：
#   ./preflight-check.sh            # 静态检查（读 .env + 主机环境）
#   ./preflight-check.sh --live     # 额外检查「已部署实例」的健康与安全端点
#
# 退出码：0 = 全部通过（可能有 WARN）；1 = 存在 FAIL，**不要上线**。
# 幂等：纯只读检查，不修改任何文件。
# =============================================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BASE_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

LIVE=0
[ "${1:-}" = "--live" ] && LIVE=1

PASS=0; WARN=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  ⚠️  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ❌ %s\n' "$1"; }
title() { printf '\n[%s]\n' "$1"; }

echo "============================================================"
echo " YUMU 游戏社区 · 上线前自检"
echo " 时间：$(date '+%Y-%m-%d %H:%M:%S')   环境：$(uname -s)   项目：$ROOT_DIR"
echo "============================================================"

# ---------------------------------------------------------------------------
# 1. .env 与环境变量
# ---------------------------------------------------------------------------
title "1. 环境文件与必填变量"

if [ ! -f "$ENV_FILE" ]; then
  fail "$ENV_FILE 不存在 —— 先跑 deploy/tools/gen-secrets.sh --write"
else
  chmod 600 "$ENV_FILE" 2>/dev/null
  pass "找到 $ENV_FILE（已确保权限 600）"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# 变量是否有值（同时兼容 .env 与外部注入）
getv() { eval "printf '%s' \"\${$1:-}\""; }

REQUIRED="MYSQL_ROOT_PASSWORD DB_PASSWORD JWT_SECRET CORS_ALLOWED_ORIGINS UPLOAD_DIR"
MISSING=""
for k in $REQUIRED; do
  v="$(getv "$k")"
  if [ -z "$v" ]; then MISSING="$MISSING $k"; fi
done
if [ -n "$MISSING" ]; then
  fail "以下必填变量为空：$MISSING"
else
  pass "必填变量齐全（$(echo $REQUIRED | wc -w) 项）"
fi

PROFILE="$(getv SPRING_PROFILES_ACTIVE)"
case "$PROFILE" in
  prod|production) pass "SPRING_PROFILES_ACTIVE=$PROFILE（启动期安全自检已开启）" ;;
  "") warn "SPRING_PROFILES_ACTIVE 未设置 —— 容器默认按 prod 启动，但请显式声明避免歧义" ;;
  *) warn "SPRING_PROFILES_ACTIVE=$PROFILE（非 prod，弱值不会被拒绝，仅用于本地调试）" ;;
esac

# ---------------------------------------------------------------------------
# 2. 弱值 / 占位值检测（与后端 StartupSecurityValidator 保持一致）
# ---------------------------------------------------------------------------
title "2. 密钥强度"

is_weak() {
  local v="$1"
  case "$v" in
    123456|12345678|password|admin123456|root|changeme|change-me*|please-generate*|your-domain.com|placeholder|test) return 0 ;;
  esac
  printf '%s' "$v" | grep -qiE '^(123456|password|admin|qwerty|change-?me|please-generate|your-?domain|placeholder)' && return 0
  return 1
}

for k in MYSQL_ROOT_PASSWORD DB_PASSWORD JWT_SECRET; do
  v="$(getv "$k")"
  [ -z "$v" ] && continue
  if is_weak "$v"; then
    fail "$k 仍是弱口令/占位值（值以「${v:0:6}…」开头）—— 生产会拒绝启动，请改用 gen-secrets.sh 重新生成"
  else
    pass "$k 不是已知弱值"
  fi
done

JWT="$(getv JWT_SECRET)"
if [ -n "$JWT" ]; then
  L=${#JWT}
  if [ "$L" -ge 32 ]; then pass "JWT_SECRET 长度 ${L} ≥ 32（满足 HS256 要求）"
  else fail "JWT_SECRET 仅 ${L} 位，少于 32 位（签名强度不足 / Jsoup 无关，属 JWT HS256 硬要求）"; fi
fi

# ---------------------------------------------------------------------------
# 3. 对外配置
# ---------------------------------------------------------------------------
title "3. 域名与对外配置"

CORS="$(getv CORS_ALLOWED_ORIGINS)"
if [ -z "$CORS" ]; then
  : # 空值已在第 1 节「必填变量为空」里报过，这里不重复报（避免同一问题刷两条）
elif printf '%s' "$CORS" | grep -qi 'localhost\|127\.0\.0\.1\|your-domain'; then
  fail "CORS_ALLOWED_ORIGINS=$CORS 仍指向本地/占位域名 —— 上线后真实域名会被 CORS 拦截（表现为接口 403）"
else
  pass "CORS_ALLOWED_ORIGINS=$CORS"
fi

UP="$(getv UPLOAD_DIR)"
if [ -n "$UP" ]; then
  if [ -d "$UP" ]; then
    if [ -w "$UP" ]; then pass "上传目录 $UP 存在且可写"
    else fail "上传目录 $UP 不可写 —— 容器内运行用户 UID 为 1000，需 chown 1000:1000"; fi
  else
    warn "上传目录 $UP 尚不存在（首次 compose 启动会自动创建；若是宿主机 bind mount 请先 mkdir -p 并 chown 1000:1000）"
  fi
fi

ALERT="$(getv ALERT_WEBHOOK_URL)"
if [ -z "$ALERT" ]; then
  warn "ALERT_WEBHOOK_URL 未配置 —— 探活/备份失败只会写本地日志，出故障你不会收到通知"
else
  pass "告警 webhook 已配置（类型：$(getv ALERT_WEBHOOK_TYPE)）"
fi

LLM_KEY="$(getv LLM_API_KEY)"
LLM_MOCK="$(getv LLM_MOCK)"
if [ -z "$LLM_KEY" ] || [ "$LLM_MOCK" = "true" ]; then
  warn "智能助手当前为 mock 模式（LLM_MOCK=$LLM_MOCK，LLM_API_KEY $([ -z "$LLM_KEY" ] && echo 未配置 || echo 已配置)）—— 线上体验为演示回答"
else
  pass "智能助手已接真实大模型（模型：$(getv LLM_MODEL)）"
fi

# ---------------------------------------------------------------------------
# 4. 主机环境
# ---------------------------------------------------------------------------
title "4. 主机与运行时"

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "Docker 可用（$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '版本未知')）"
  else
    fail "Docker 已安装但 daemon 未运行（或当前用户无权限）—— 需 systemctl start docker / 加入 docker 组"
  fi
else
  fail "未检测到 docker —— 请先安装 Docker Engine + compose 插件"
fi

if docker compose version >/dev/null 2>&1; then
  pass "docker compose 插件可用"
elif command -v docker-compose >/dev/null 2>&1; then
  warn "仅有旧版 docker-compose（v1）—— 建议升级到 docker compose 插件"
else
  fail "未检测到 docker compose"
fi

if [ -f "$ROOT_DIR/docker-compose.yml" ]; then
  if docker compose -f "$ROOT_DIR/docker-compose.yml" config >/dev/null 2>&1; then
    pass "docker-compose.yml 语法与变量替换校验通过"
  else
    fail "docker compose config 校验失败 —— 通常是必填变量缺失（compose 里用 \${VAR:?} 声明）"
  fi
fi

# 端口占用（80/443 若被非本项目进程占用，Nginx 起不来）
if command -v ss >/dev/null 2>&1; then
  for p in 80 443; do
    if ss -ltn 2>/dev/null | grep -q ":$p "; then
      warn "端口 $p 已被占用 —— 若占用者不是本项目的 nginx 容器，需先释放"
    else
      pass "端口 $p 空闲"
    fi
  done
fi

# 磁盘余量
DISK_MIN="${ALERT_DISK_MIN_FREE:-10}"
AVAIL=$(df -Pk "$ROOT_DIR" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$AVAIL" ]; then
  USEDP=$(df -Pk "$ROOT_DIR" 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
  FREE=$((100 - USEDP))
  if [ "$FREE" -lt "$DISK_MIN" ]; then
    fail "磁盘剩余 ${FREE}% < 阈值 ${DISK_MIN}% —— 日志与上传会很快撑爆磁盘"
  else
    pass "磁盘剩余 ${FREE}%（$((AVAIL/1024/1024)) GB）"
  fi
fi

# ---------------------------------------------------------------------------
# 5. 已部署实例（--live）
# ---------------------------------------------------------------------------
if [ "$LIVE" -eq 1 ]; then
  title "5. 运行实例健康与安全端点"

  HEALTH_URL="${CHECK_URL:-http://127.0.0.1:8080/api/actuator/health}"
  # ⚠️ 不要用「curl ... || echo 000」——某些平台（Git Bash/MINGW）写 -o /dev/null 会返回
  #    非 0 退出码（23 Failed writing body），于是 "401" 和兜底 "000" 会拼成 "401000"。
  #    这里统一「先取输出，再看是否为空」。
  RESP=$(curl -s -m 5 -w $'\n%{http_code}' "$HEALTH_URL" 2>/dev/null)
  CODE=$(printf '%s' "$RESP" | tail -n1)
  BODY=$(printf '%s' "$RESP" | sed '$d')
  [ -z "$CODE" ] && CODE=000
  if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"status":"UP"'; then
    pass "健康检查 $HEALTH_URL → UP"
  else
    fail "健康检查失败（HTTP $CODE，响应：$(printf '%s' "$BODY" | head -c 120)）"
  fi

  # actuator 越权面：env/heapdump 必须不可匿名访问（防密钥泄露）
  for ep in env heapdump beans configprops; do
    C=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "${HEALTH_URL%/health}/$ep" 2>/dev/null)
    [ -z "$C" ] && C=000
    if [ "$C" = "200" ]; then
      fail "/actuator/$ep 可匿名访问（HTTP 200）—— 会泄露配置/密钥，必须在 SecurityConfig 封禁"
    else
      pass "/actuator/$ep 已保护（HTTP $C）"
    fi
  done

  # HTTPS 与证书
  DOMAIN=$(printf '%s' "$(getv CORS_ALLOWED_ORIGINS)" | sed -E 's#^https?://##; s#/.*$##' | cut -d, -f1)
  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "your-domain.com" ]; then
    if command -v openssl >/dev/null 2>&1; then
      NOTAFTER=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
      if [ -n "$NOTAFTER" ]; then
        pass "HTTPS 证书可获取（$DOMAIN，到期 $NOTAFTER）—— 记得确认 certbot 自动续期已挂 cron"
      else
        warn "无法从 $DOMAIN:443 取到证书 —— 若尚未签发证书属正常（见操作手册第 3 步）"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo
echo "============================================================"
printf ' 自检结果：通过 %d 项 / 警告 %d 项 / 失败 %d 项\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo " ⛔ 存在失败项，**不要上线**，逐条修复后重跑本脚本"
  echo "============================================================"
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo " ⚠️  无致命问题，但请评估上面的警告项（多为「上线后才发现的静默降级」）"
else
  echo " ✅ 全部通过，可以进入部署"
fi
echo "============================================================"
exit 0
