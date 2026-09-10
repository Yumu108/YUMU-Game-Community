-- ============================================================================
-- P0 内容发现：订阅（板块 / 关键词）表
-- sub_type: 1=板块订阅(target_id=板块id)  2=关键词订阅(keyword=关键词)
-- 同一用户对同一订阅唯一（uk_user_sub）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS `subscription` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT       NOT NULL,
  `sub_type`    TINYINT      NOT NULL COMMENT '1=板块订阅 2=关键词订阅',
  `target_id`   BIGINT       DEFAULT NULL COMMENT '板块订阅时的板块id',
  `keyword`     VARCHAR(50)  DEFAULT NULL COMMENT '关键词订阅时的关键词',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_sub` (`user_id`, `sub_type`, `target_id`, `keyword`),
  KEY `idx_user` (`user_id`),
  KEY `idx_deleted` (`deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订阅表：板块/关键词';
