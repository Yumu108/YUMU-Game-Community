#!/usr/bin/env bash
# =============================================================================
# B5：统一告警出口 —— 所有告警（探活失败 / 备份失败 / 磁盘不足）都走这里
# -----------------------------------------------------------------------------
# 用法：
#   ./notify.sh "标题" "正文内容"
#
# 环境变量（写在 .env 或 crontab 顶部）：
#   ALERT_WEBHOOK_URL   webhook 地址（必填；不填则只打印到 stderr，不阻断调用方）
#   ALERT_WEBHOOK_TYPE  wechat（企业微信机器人，默认）| dingtalk（钉钉）| serverchan（Server酱）
#
# 设计原则：
#   · 告警本身绝不阻断主流程（备份失败要告警，但不能因为告警失败就当备份成功）
#   · 未配置 webhook 时静默降级为本地日志，方便上线前先跑起来
# =============================================================================
set -uo pipefail

TITLE="${1:-YUMU 告警}"
CONTENT="${2:-（无正文）}"
TYPE="${ALERT_WEBHOOK_TYPE:-wechat}"
URL="${ALERT_WEBHOOK_URL:-}"
HOST_TAG="$(hostname 2>/dev/null || echo unknown-host)"
NOW="$(date '+%Y-%m-%d %H:%M:%S')"

FULL="【${TITLE}】
时间：${NOW}
主机：${HOST_TAG}
${CONTENT}"

# JSON 安全转义：反斜杠、双引号、换行
json_escape() {
    printf '%s' "$1" \
        | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
        | awk '{ printf "%s\\n", $0 }' \
        | sed 's/\\n$//'
}

if [ -z "$URL" ]; then
    echo "[notify $(date '+%F %T')] 未配置 ALERT_WEBHOOK_URL，仅本地记录 → ${TITLE}" >&2
    echo "$FULL" >&2
    exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "[notify $(date '+%F %T')] 系统缺少 curl，无法推送 → ${TITLE}" >&2
    exit 0
fi

SAFE="$(json_escape "$FULL")"

case "$TYPE" in
    wechat | wecom | qywx)
        # 企业微信群机器人
        curl -sS --max-time 10 -X POST "$URL" \
            -H 'Content-Type: application/json' \
            -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${SAFE}\"}}" \
            >/dev/null 2>&1
        ;;
    dingtalk | ding)
        # 钉钉群机器人（安全设置若选「自定义关键词」，关键词填：YUMU 或 告警）
        curl -sS --max-time 10 -X POST "$URL" \
            -H 'Content-Type: application/json' \
            -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${SAFE}\"}}" \
            >/dev/null 2>&1
        ;;
    serverchan | sct)
        # Server酱：URL 形如 https://sctapi.ftqq.com/<SENDKEY>.send
        curl -sS --max-time 10 -X POST "$URL" \
            -F "title=${TITLE}" \
            -F "desp=${CONTENT}" \
            >/dev/null 2>&1
        ;;
    *)
        echo "[notify] 未知的 ALERT_WEBHOOK_TYPE=${TYPE}（可选 wechat / dingtalk / serverchan）" >&2
        exit 1
        ;;
esac

echo "[notify $(date '+%F %T')] 已推送告警：${TITLE}"
