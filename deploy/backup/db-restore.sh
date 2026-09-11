# B3：恢复脚本 —— 把某个备份 gz 恢复到 MySQL
# 用法: ./db-restore.sh backups/yumu_community_20260909_140000.sql.gz
# ⚠️ 恢复会覆盖目标库现有数据，执行前请二次确认目标库名！
#!/usr/bin/env bash
set -euo pipefail

FILE="${1:?用法: $0 <备份文件.sql.gz>}"
CONTAINER="${YUMU_MYSQL_CONTAINER:-yumu-mysql}"
DB_NAME="${DB_NAME:-yumu_community}"
DB_USER="${DB_USERNAME:-root}"
DB_PASSWORD="${DB_PASSWORD:?[db-restore] 缺少 DB_PASSWORD 环境变量（写在 .env 或 crontab 顶部）}"

[ -f "$FILE" ] || { echo "备份文件不存在: $FILE" >&2; exit 1; }

echo "⚠️  即将把 $FILE 恢复到数据库 [$DB_NAME]，3 秒后开始（Ctrl+C 取消）..."
sleep 3

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" \
    --default-character-set=utf8mb4 -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4;"
  gunzip -c "$FILE" | docker exec -i "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" \
    --default-character-set=utf8mb4 "$DB_NAME"
else
  mysql -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" \
    --default-character-set=utf8mb4 -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4;"
  gunzip -c "$FILE" | mysql -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" \
    --default-character-set=utf8mb4 "$DB_NAME"
fi

COUNT=$(docker exec "$CONTAINER" mysql -u"$DB_USER" -p"$DB_PASSWORD" -N \
  -e "SELECT COUNT(*) FROM \`$DB_NAME\`.post;" 2>/dev/null || echo "n/a")
echo "[restore] done. 校验: post 表行数 = $COUNT"
