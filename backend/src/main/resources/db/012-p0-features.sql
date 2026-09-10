-- ============================================================
-- P0 功能增量脚本：游戏库 / 积分签到 / 每日精选
-- 幂等执行：对已存在表/列跳过
-- ============================================================
USE yumu_community;

-- ---------- 游戏库 ----------
CREATE TABLE IF NOT EXISTS `game` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL COMMENT '游戏名称',
  `cover`       VARCHAR(255) DEFAULT NULL,
  `platform`    VARCHAR(50)  DEFAULT NULL COMMENT '平台：PC/手机/主机/多平台',
  `genre`       VARCHAR(50)  DEFAULT NULL COMMENT '类型：RPG/FPS/策略等',
  `description` VARCHAR(500) DEFAULT NULL,
  `developer`   VARCHAR(100) DEFAULT NULL,
  `publisher`   VARCHAR(100) DEFAULT NULL,
  `release_date` DATE        DEFAULT NULL,
  `post_count`  INT          NOT NULL DEFAULT 0,
  `sort`        INT          NOT NULL DEFAULT 0,
  `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '0=展示 1=隐藏',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_status_sort` (`status`, `sort` DESC, `id` DESC),
  KEY `idx_platform` (`platform`),
  KEY `idx_genre` (`genre`),
  FULLTEXT KEY `ft_name_desc` (`name`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='游戏库表';

-- ---------- post 表扩展 game_id ----------
SELECT COUNT(1) INTO @has_game_id FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'post' AND COLUMN_NAME = 'game_id';
SET @sql = IF(@has_game_id = 0,
  'ALTER TABLE `post` ADD COLUMN `game_id` BIGINT DEFAULT NULL COMMENT ''关联游戏ID（P0 游戏库）'' AFTER `board_id`, ADD KEY `idx_game` (`game_id`), ADD CONSTRAINT `fk_post_game` FOREIGN KEY (`game_id`) REFERENCES `game` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------- 签到表 ----------
CREATE TABLE IF NOT EXISTS `sign_in` (
  `id`               BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT   NOT NULL,
  `sign_date`        DATE     NOT NULL,
  `continuous_days`  INT      NOT NULL DEFAULT 1,
  `points`           INT      NOT NULL DEFAULT 0,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`          TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date` (`user_id`, `sign_date`),
  KEY `idx_user` (`user_id`),
  KEY `idx_deleted` (`deleted`),
  CONSTRAINT `fk_sign_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 积分日志 ----------
CREATE TABLE IF NOT EXISTS `points_log` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT       NOT NULL,
  `type`          TINYINT      NOT NULL COMMENT '1签到 2发帖 3回帖 4获赞 5精华 6消费',
  `delta`         INT          NOT NULL,
  `balance_after` INT          NOT NULL,
  `description`   VARCHAR(200) DEFAULT NULL,
  `related_id`    BIGINT       DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`       TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_user_type` (`user_id`, `type`),
  KEY `idx_created` (`created_at`),
  KEY `idx_deleted` (`deleted`),
  CONSTRAINT `fk_points_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 每日精选/周热榜 ----------
CREATE TABLE IF NOT EXISTS `daily_pick` (
  `id`          BIGINT   NOT NULL AUTO_INCREMENT,
  `post_id`     BIGINT   NOT NULL,
  `pick_type`   TINYINT  NOT NULL DEFAULT 1 COMMENT '1=每日精选 2=周热榜',
  `pick_date`   DATE     NOT NULL,
  `sort`        INT      NOT NULL DEFAULT 0,
  `created_by`  BIGINT   DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_type_date` (`post_id`, `pick_type`, `pick_date`),
  KEY `idx_type_date_sort` (`pick_type`, `pick_date`, `sort` DESC),
  KEY `idx_deleted` (`deleted`),
  CONSTRAINT `fk_dp_post` FOREIGN KEY (`post_id`) REFERENCES `post` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_dp_user` FOREIGN KEY (`created_by`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 补齐逻辑删除列（BaseEntity @TableLogic 依赖；旧库已建表时补列）----------
SELECT COUNT(1) INTO @has_del_sign FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sign_in' AND COLUMN_NAME = 'deleted';
SET @sql_sign = IF(@has_del_sign = 0, 'ALTER TABLE `sign_in` ADD COLUMN `deleted` TINYINT NOT NULL DEFAULT 0 AFTER `updated_at`, ADD KEY `idx_deleted` (`deleted`)', 'SELECT 1');
PREPARE stmt_sign FROM @sql_sign; EXECUTE stmt_sign; DEALLOCATE PREPARE stmt_sign;

SELECT COUNT(1) INTO @has_del_pl FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'points_log' AND COLUMN_NAME = 'deleted';
SET @sql_pl = IF(@has_del_pl = 0, 'ALTER TABLE `points_log` ADD COLUMN `deleted` TINYINT NOT NULL DEFAULT 0 AFTER `created_at`, ADD KEY `idx_deleted` (`deleted`)', 'SELECT 1');
PREPARE stmt_pl FROM @sql_pl; EXECUTE stmt_pl; DEALLOCATE PREPARE stmt_pl;

SELECT COUNT(1) INTO @has_del_dp FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_pick' AND COLUMN_NAME = 'deleted';
SET @sql_dp = IF(@has_del_dp = 0, 'ALTER TABLE `daily_pick` ADD COLUMN `deleted` TINYINT NOT NULL DEFAULT 0 AFTER `updated_at`, ADD KEY `idx_deleted` (`deleted`)', 'SELECT 1');
PREPARE stmt_dp FROM @sql_dp; EXECUTE stmt_dp; DEALLOCATE PREPARE stmt_dp;

-- points_log 补 updated_at（BaseEntity 自动填充依赖）
SELECT COUNT(1) INTO @has_ua_pl FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'points_log' AND COLUMN_NAME = 'updated_at';
SET @sql_ua = IF(@has_ua_pl = 0, 'ALTER TABLE `points_log` ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`', 'SELECT 1');
PREPARE stmt_ua FROM @sql_ua; EXECUTE stmt_ua; DEALLOCATE PREPARE stmt_ua;
