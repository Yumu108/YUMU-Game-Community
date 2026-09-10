-- 2026-08-21 通知表增加 source_id，用于回复通知存储 replyId，前端可精准跳转
SET @dbname = 'yumu_community';
SET @tablename = 'notification';
SET @columnname = 'source_id';
SET @preparedStatement = (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = @dbname AND table_name = @tablename AND column_name = @columnname) = 0,
    'ALTER TABLE notification ADD COLUMN source_id BIGINT DEFAULT NULL COMMENT "关联来源ID（如回复ID）" AFTER target_id;',
    'SELECT 1;'
));
PREPARE addColumn FROM @preparedStatement;
EXECUTE addColumn;
DEALLOCATE PREPARE addColumn;
