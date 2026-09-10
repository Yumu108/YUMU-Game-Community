-- ============================================================
-- 1.2 版主改为 (用户, 游戏, 板块) 多对多
-- 可重复执行（幂等，用 information_schema 判断）
-- ============================================================

SET @db = 'yumu_community';

-- 0) 删旧外键 fk_mb_board（若存），否则无法重建键结构
SET @has_fk = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND CONSTRAINT_NAME='fk_mb_board');
SET @drop_fk = IF(@has_fk>0, 'ALTER TABLE moderator_board DROP FOREIGN KEY fk_mb_board', 'SELECT 1');
PREPARE s0 FROM @drop_fk; EXECUTE s0; DEALLOCATE PREPARE s0;

-- 1) 加 game_id 列（若不存在）
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND COLUMN_NAME='game_id');
SET @sql_add = IF(@has_col=0,
  "ALTER TABLE moderator_board ADD COLUMN game_id BIGINT DEFAULT NULL COMMENT '负责游戏ID；NULL 表示不限游戏（兼容存量）' AFTER board_id",
  'SELECT 1');
PREPARE stmt_add FROM @sql_add; EXECUTE stmt_add; DEALLOCATE PREPARE stmt_add;

-- 2) 先加新唯一键 uk_user_game_board（user_id 最左，可支撑 fk_mb_user 的索引需求）
SET @has_new = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND INDEX_NAME='uk_user_game_board');
SET @sql_add_uq = IF(@has_new=0, 'ALTER TABLE moderator_board ADD UNIQUE KEY uk_user_game_board (user_id, game_id, board_id)', 'SELECT 1');
PREPARE stmt_add_uq FROM @sql_add_uq; EXECUTE stmt_add_uq; DEALLOCATE PREPARE stmt_add_uq;

-- 3) 再删旧唯一键 uk_user_board（fk_mb_user 现可用 uk_user_game_board）
SET @has_old = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND INDEX_NAME='uk_user_board');
SET @sql_drop_old = IF(@has_old>0, 'ALTER TABLE moderator_board DROP INDEX uk_user_board', 'SELECT 1');
PREPARE stmt_drop_old FROM @sql_drop_old; EXECUTE stmt_drop_old; DEALLOCATE PREPARE stmt_drop_old;

-- 4) 普通索引 idx_board_user -> idx_game_board_user（若旧键存在则先删）
SET @has_old2 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND INDEX_NAME='idx_board_user');
SET @sql_drop_old2 = IF(@has_old2>0, 'ALTER TABLE moderator_board DROP INDEX idx_board_user', 'SELECT 1');
PREPARE stmt_drop_old2 FROM @sql_drop_old2; EXECUTE stmt_drop_old2; DEALLOCATE PREPARE stmt_drop_old2;

SET @has_new2 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND INDEX_NAME='idx_game_board_user');
SET @sql_add_idx = IF(@has_new2=0, 'ALTER TABLE moderator_board ADD KEY idx_game_board_user (game_id, board_id, user_id)', 'SELECT 1');
PREPARE stmt_add_idx FROM @sql_add_idx; EXECUTE stmt_add_idx; DEALLOCATE PREPARE stmt_add_idx;

-- 5) 重建外键
SET @has_fkb = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND CONSTRAINT_NAME='fk_mb_board');
SET @add_fkb = IF(@has_fkb=0, 'ALTER TABLE moderator_board ADD CONSTRAINT fk_mb_board FOREIGN KEY (board_id) REFERENCES board(id) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE sfk FROM @add_fkb; EXECUTE sfk; DEALLOCATE PREPARE sfk;

SET @has_fkg = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=@db AND TABLE_NAME='moderator_board' AND CONSTRAINT_NAME='fk_mb_game');
SET @add_fkg = IF(@has_fkg=0, 'ALTER TABLE moderator_board ADD CONSTRAINT fk_mb_game FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE sfkg FROM @add_fkg; EXECUTE sfkg; DEALLOCATE PREPARE sfkg;

-- 6) 归并版主负责板块到固定 6 种（game_id 保持 NULL，唯一键含 NULL 不冲突）
UPDATE `moderator_board` SET `board_id` = 1 WHERE `board_id` IN (11,12,13);
UPDATE `moderator_board` SET `board_id` = 5 WHERE `board_id` IN (52);
UPDATE `moderator_board` SET `board_id` = 2 WHERE `board_id` IN (31,32);
UPDATE `moderator_board` SET `board_id` = 3 WHERE `board_id` IN (21,22);
UPDATE `moderator_board` SET `board_id` = 4 WHERE `board_id` IN (41,42);
UPDATE `moderator_board` SET `board_id` = 5 WHERE `board_id` IN (51);
UPDATE `moderator_board` SET `board_id` = 6 WHERE `board_id` NOT IN (1,2,3,4,5,6);
