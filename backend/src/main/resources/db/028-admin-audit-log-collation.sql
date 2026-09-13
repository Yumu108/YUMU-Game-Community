-- ============================================================================
-- 028：统一 admin_audit_log 的 collation 为 utf8mb4_0900_ai_ci
-- ----------------------------------------------------------------------------
-- 背景：018-collation-utf8mb4-0900.sql 是全库 collation 归一化，但它执行时
--       admin_audit_log 表还不存在（该表由 027 才创建），因此漏在归一化之外，
--       至今仍是建表时的 utf8mb4_unicode_ci，与其它表以及连接 collation 不一致。
-- 影响：跨 collation 的字符串比较/关联可能报
--       ERROR 1267 Illegal mix of collations，并影响中文 LIKE 匹配。
-- 安全性：仅改 collation，不动数据；重复执行无副作用。
-- ============================================================================

SET @db := DATABASE();
SET @needs := (SELECT COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = @db
                 AND TABLE_NAME = 'admin_audit_log'
                 AND TABLE_COLLATION <> 'utf8mb4_0900_ai_ci');

SET @sql := IF(@needs > 0,
  'ALTER TABLE `admin_audit_log` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 验证：应显示 utf8mb4_0900_ai_ci
SELECT TABLE_NAME, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'admin_audit_log';
