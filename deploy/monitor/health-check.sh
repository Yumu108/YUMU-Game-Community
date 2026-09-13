#!/usr/bin/env bash
# =============================================================================
# B5：进程 / 端口探活 —— 由 crontab 每 5 分钟调用一次
# -----------------------------------------------------------------------------
# 检查项：
#   1) HTTP 健康端点   GET /api/actuator/health  → 期望包含 "UP"
#   2) 端口存活        TCP 8080 能否连上（区分"进程在但线程卡死"）
#   3) 磁盘余量        低于阈值（默认 10%）时告警一次，避免日志/上传把盘撑爆
#
# 告警策略：
#   · 连续 ALERT_FAIL_THRESHOLD 次（默认 3）失败才告警 → 避免重启/发布抖动误报
#   · 处于告警态期间不再重复刷屏；恢复后补发一条「已恢复」
#
# 用法：
#   ./health-check.sh              # 正常执行（crontab 调用）
#   ./health-check.sh --force-alert # 强制发一条测试告警（验证 webhook 是否配通）
# =============================================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$BASE_DIR/../.." && pwd)"
NOTIFY="$BASE_DIR/notify.sh"

# 注意：必须带端口，否则 curl 会打到 80 —— 曾经漏写 :8080 导致探活永远失败
CHECK_URL="${CHECK_URL:-http://127.0.0.1:8080/api/actuator/health}"
CHECK_HOST="${CHECK_HOST:-127.0.0.1}"
CHECK_PORT="${CHECK_PORT:-8080}"
FAIL_THRESHOLD="${ALERT_FAIL_THRESHOLD:-3}"
DISK_MIN_FREE_PERCENT="${ALERT_DISK_MIN_FREE:-10}"
DISK_PATH="${ALERT_DISK_PATH:-/}"
LOG_DIR="${ALERT_LOG_DIR:-$PROJECT_DIR/logs}"
STATE_DIR="${ALERT_STATE_DIR:-$PROJECT_DIR/.monitor-state}"

FAIL_FILE="$STATE_DIR/fail.count"
ALERTED_FILE="$STATE_DIR/alerted.flag"
DISK_FLAG_FILE="$STATE_DIR/disk.flag"
RUN_LOG="$STATE_DIR/health-check.log"

mkdir -p "$STATE_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$RUN_LOG"; }

read_int() {
    local v
    v="$(cat "$1" 2>/dev/null || true)"
    # 空文件或非数字一律按 0 处理，避免算术表达式报错中断脚本
    case "${v:-}" in
        '' | *[!0-9]*) echo 0 ;;
        *) echo "$v" ;;
    esac
}

# ---------------------------------------------------------------- 强制测试告警
if [ "${1:-}" = "--force-alert" ]; then
    log "手动触发测试告警"
    "$NOTIFY" "YUMU 监控自检（测试）" "这是一条由 health-check.sh --force-alert 发出的测试告警，收到即代表告警通道已配通。"
    exit 0
fi

# ---------------------------------------------------------------- 1) HTTP 探活
http_ok=0
http_detail="无响应"
# 不加 -f：4xx/5xx 也要拿到响应体内容用于排障；用退出码 + 响应体双重判断
resp="$(curl -s --max-time 5 "$CHECK_URL" 2>/dev/null)"
curl_code=$?
if [ "$curl_code" -eq 0 ] && printf '%s' "$resp" | grep -q '"UP"'; then
    http_ok=1
    http_detail="$resp"
else
    http_detail="curl 退出码 ${curl_code}${resp:+，响应：${resp}}"
fi

# ---------------------------------------------------------------- 2) 端口探活
# 说明：不用 /dev/tcp —— Git Bash(Windows) 下它不生效，会误判成"端口通"。
# 这里用 curl 的退出码判断：0 或 22(HTTP 4xx/5xx，说明连上了) 视为端口存活，
# 7(无法连接) / 28(超时) 视为端口不可用 → 可区分「进程没了」与「进程在但线程卡死」。
port_ok=0
port_code=0
# 不要用 -o /dev/null：Windows 版 curl 写 /dev/null 会报退出码 23(WRITE_ERROR)，会把"通"误判成"不通"
curl -s --max-time 3 "http://${CHECK_HOST}:${CHECK_PORT}/" >/dev/null 2>&1 || port_code=$?
if [ "$port_code" -eq 0 ]; then
    port_ok=1
fi

log "探活结果 http=${http_ok} port=${port_ok} url=${CHECK_URL} (${http_detail})"

# ---------------------------------------------------------------- 3) 告警判定
if [ "$http_ok" -eq 1 ] && [ "$port_ok" -eq 1 ]; then
    # 恢复：若此前处于告警态，补发一条恢复通知
    if [ -f "$ALERTED_FILE" ]; then
        "$NOTIFY" "YUMU 服务已恢复" "健康检查已重新通过：${CHECK_URL}（端口 ${CHECK_PORT} 正常）"
        log "服务已恢复，已发送恢复通知"
        rm -f "$ALERTED_FILE"
    fi
    echo 0 >"$FAIL_FILE"
else
    fail_count=$(read_int "$FAIL_FILE")
    fail_count=$((fail_count + 1))
    echo "$fail_count" >"$FAIL_FILE"

    reason="HTTP 健康检查失败：${http_detail}"
    [ "$port_ok" -eq 0 ] && reason="${reason}；端口 ${CHECK_HOST}:${CHECK_PORT} 不可连接"

    # 附带容器状态与最近错误日志（Linux 下用 timeout 兜底，避免 docker 卡住拖死探活）
    containers="$(timeout 10 docker compose -f "$PROJECT_DIR/docker-compose.yml" ps --format 'table {{.Service}} {{.Status}}' 2>/dev/null | head -8)"
    [ -n "$containers" ] && reason="${reason}\n\n容器状态：\n${containers}"

    # 容器里日志在 /app/logs（挂到宿主机 ./logs），本地直接跑 jar 时在 backend/logs
    err_log="$LOG_DIR/yumu-community-error.log"
    [ -f "$err_log" ] || err_log="$PROJECT_DIR/backend/logs/yumu-community-error.log"
    if [ -f "$err_log" ]; then
        reason="${reason}\n\n最近错误日志：\n$(tail -n 15 "$err_log" 2>/dev/null)"
    fi

    if [ "$fail_count" -ge "$FAIL_THRESHOLD" ] && [ ! -f "$ALERTED_FILE" ]; then
        "$NOTIFY" "YUMU 服务异常（连续 ${fail_count} 次探活失败）" "$(printf '%b' "$reason")"
        touch "$ALERTED_FILE"
        log "已触发告警（连续失败 ${fail_count} 次）"
    else
        log "探活失败（第 ${fail_count} 次，阈值 ${FAIL_THRESHOLD}）"
    fi
fi

# ---------------------------------------------------------------- 4) 磁盘余量
disk_free="$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print 100-$5}')"
if [ -n "${disk_free:-}" ] && [ "$disk_free" -lt "$DISK_MIN_FREE_PERCENT" ] 2>/dev/null; then
    if [ ! -f "$DISK_FLAG_FILE" ]; then
        "$NOTIFY" "YUMU 磁盘空间不足" "磁盘 ${DISK_PATH} 剩余可用 ${disk_free}%（阈值 ${DISK_MIN_FREE_PERCENT}%）。\n请清理 ${LOG_DIR} 下旧日志或扩容。"
        touch "$DISK_FLAG_FILE"
        log "磁盘告警已发送（剩余 ${disk_free}%）"
    fi
else
    rm -f "$DISK_FLAG_FILE"
fi

exit 0
