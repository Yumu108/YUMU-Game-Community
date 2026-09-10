-- 010: 版主负责板块关联表（后台管理系统：管理员可给用户分配版主角色及负责板块）
DELIMITER $$

CREATE PROCEDURE IF NOT EXISTS yumu_010_moderator_board()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'moderator_board'
    ) THEN
        CREATE TABLE `moderator_board` (
            `id`          BIGINT   NOT NULL AUTO_INCREMENT,
            `user_id`     BIGINT   NOT NULL COMMENT '版主用户ID',
            `board_id`    BIGINT   NOT NULL COMMENT '负责板块ID',
            `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            `deleted`     TINYINT  NOT NULL DEFAULT 0,
            PRIMARY KEY (`id`),
            UNIQUE KEY `uk_user_board` (`user_id`, `board_id`),
            KEY `idx_board_user` (`board_id`, `user_id`),
            CONSTRAINT `fk_mb_user`  FOREIGN KEY (`user_id`)  REFERENCES `user`  (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_mb_board` FOREIGN KEY (`board_id`) REFERENCES `board` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版主负责板块关联表';
    END IF;
END$$

DELIMITER ;

CALL yumu_010_moderator_board();
DROP PROCEDURE IF EXISTS yumu_010_moderator_board;
