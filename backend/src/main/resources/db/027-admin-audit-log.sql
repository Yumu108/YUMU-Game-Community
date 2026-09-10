-- 027: 管理员/版主操作审计日志（合规向）
-- 背景：封禁用户 / 删除帖子 / 审核通过驳回 / 置顶加精 / 处理举报 等管理动作此前**完全没有留痕**，
--       一旦出现争议（误封、误删、违规操作）无法回答"谁在什么时间对哪个对象做了什么"。
-- 设计要点：
--   1) 只追加、不改写（业务代码只 insert）；表结构保留 deleted 列是为对齐 BaseEntity 约定，实际不会被删。
--   2) operator_name 冗余存**操作当时的昵称快照** —— 用户改名后仍能还原历史记录是谁做的。
--   3) operator_id **不加外键**：用户被物理删除时审计记录必须保留（加了 FK 会被级联清掉，审计就失效了）。
--   4) 索引面向真实查询：按时间倒序列表、按操作人、按动作码筛选。
CREATE TABLE IF NOT EXISTS `admin_audit_log` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `operator_id`   BIGINT       DEFAULT NULL COMMENT '操作人 user.id（故意不加外键，保证用户删除后审计仍在）',
  `operator_name` VARCHAR(50)  DEFAULT NULL COMMENT '操作人昵称快照（冗余，防改名后不可追溯）',
  `action`        VARCHAR(40)  NOT NULL COMMENT '动作码，如 POST_HIDE / USER_BAN / REPORT_HANDLE',
  `target_type`   VARCHAR(20)  DEFAULT NULL COMMENT '对象类型：POST/REPLY/USER/REPORT/ANNOUNCEMENT/GAME',
  `target_id`     BIGINT       DEFAULT NULL COMMENT '对象 ID',
  `detail`        VARCHAR(500) DEFAULT NULL COMMENT '人类可读描述（含关键参数，如驳回理由）',
  `ip`            VARCHAR(45)  DEFAULT NULL COMMENT '操作来源 IP（IPv6 最长 45 字符）',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`       TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at` DESC, `id` DESC),
  KEY `idx_operator` (`operator_id`, `created_at` DESC),
  KEY `idx_action` (`action`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员/版主操作审计日志';
