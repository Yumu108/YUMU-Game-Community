#!/usr/bin/env bash
# B3：MySQL 定期备份脚本（Linux 服务器 crontab 使用）
# 用法: ./db-backup.sh [保留天数]   默认保留 14 天
# 依赖: 本机装有 docker（用 docker exec 调容器内 mysqldump），或本机有 mysqldump（自动降级）
# B5：备份失败（含产出空文件）会通过 deploy/monitor/notify.sh 推送告警 ——
#     备份静默失败 = 等于没备份，这是整套监控里价值最高的一条告警。
# 修复(9-09)：shebang 原先写在第 4 行不生效，脚本会被 /bin/sh 执行，`set -o pipefail` 直接报错退出。
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="$BASE_DIR/../monitor/notify.sh"
TARGET="（未生成）"

on_error() {
    local code=$?
    [ "$code" -eq 0 ] && return 0
    echo "[backup] 备份失败，退出码 $code，尝试发送告警" >&2
    if [ -x "$NOTIFY" ]; then
        "$NOTIFY" "YUMU 数据库备份失败" "退出码：${code}\n备份目标：${TARGET}\n请检查 mysql 容器是否存活、磁盘是否充足、账号密码是否正确。"
    fi
    exit "$code"
}
trap on_error ERR

BACKUP_DIR="$BASE_DIR/backups"
KEEP_DAYS="${1:-14}"
CONTAINER="${YUMU_MYSQL_CONTAINER:-yumu-mysql}"
DB_NAME="${DB_NAME:-yumu_community}"
DB_USER="${DB_USERNAME:-root}"
DB_PASSWORD="${DB_PASSWORD:?[db-backup] 缺少 DB_PASSWORD 环境变量（写在 .env 或 crontab 顶部）}"
STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] start -> $TARGET"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  # 容器内 mysqldump（首选）
  docker exec "$CONTAINER" mysqldump -u"$DB_USER" -p"$DB_PASSWORD" \
    --single-transaction --routines --triggers --set-gtid-purged=OFF \
    --default-character-set=utf8mb4 "$DB_NAME" | gzip > "$TARGET"
elif command -v mysqldump >/dev/null 2>&1; then
  # 本机 mysqldump 直连（降级）
  mysqldump -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" \
    --single-transaction --routines --triggers --default-character-set=utf8mb4 "$DB_NAME" | gzip > "$TARGET"
else
  echo "[backup] ERROR: 找不到 docker 容器 $CONTAINER，本机也没有 mysqldump" >&2
  exit 1
fi

SIZE=$(du -h "$TARGET" | cut -f1)
echo "[backup] done: $TARGET ($SIZE)"

# B5：空 dump / 只有几字节的 dump 也是失败（mysqldump 报错但管道仍产出空文件时最容易漏）
SIZE_BYTES=$(wc -c <"$TARGET")
if [ "$SIZE_BYTES" -lt 1024 ]; then
    echo "[backup] ERROR: 备份文件仅 ${SIZE_BYTES} 字节，判定为失败" >&2
    if [ -x "$NOTIFY" ]; then
        "$NOTIFY" "YUMU 数据库备份异常（文件过小）" "备份文件仅 ${SIZE_BYTES} 字节：${TARGET}\n多半是 mysqldump 失败或账号权限不足，请立即检查。"
    fi
    exit 1
fi

# 清理过期备份
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | \
  sed 's/^/[backup] expired: /'

echo "[backup] all done. keep=$KEEP_DAYS days"
