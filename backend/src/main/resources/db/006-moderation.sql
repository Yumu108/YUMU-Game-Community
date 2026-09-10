-- 审核域增量脚本（在已存在的 yumu_community 库上执行，不重建库）
-- 与 schema.sql 末尾的 report 表保持一致；可重复执行（IF NOT EXISTS）。

CREATE TABLE IF NOT EXISTS `report` (
  `id`           BIGINT      NOT NULL AUTO_INCREMENT,
  `reporter_id`  BIGINT      NOT NULL COMMENT '举报人',
  `target_type`  TINYINT     NOT NULL COMMENT '1帖子 2回复 3用户',
  `target_id`    BIGINT      NOT NULL COMMENT '被举报对象 id',
  `reason`       VARCHAR(200) NOT NULL COMMENT '举报理由',
  `status`       TINYINT     NOT NULL DEFAULT 0 COMMENT '0待处理 1已处理(违规) 2已驳回',
  `handle_note`  VARCHAR(200) DEFAULT NULL COMMENT '处理备注',
  `handler_id`   BIGINT      DEFAULT NULL COMMENT '处理人(管理员)',
  `created_at`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`      TINYINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_status` (`status`),
  KEY `idx_reporter` (`reporter_id`),
  CONSTRAINT `fk_report_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='举报表';
