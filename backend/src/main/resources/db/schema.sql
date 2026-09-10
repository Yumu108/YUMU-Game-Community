-- ============================================================
-- YUMU 游戏社区 数据库建表脚本 (MySQL 8, utf8mb4 / InnoDB)
-- 说明：原型期先建表，follow / tag 暂不接业务功能；
--       私信不单独建 conversation 表，直接用 message 表做对话；
--       附件不单列，使用 cover / content 内嵌 URL。
-- ============================================================

SET NAMES utf8mb4;

DROP DATABASE IF EXISTS yumu_community;
CREATE DATABASE yumu_community
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE yumu_community;

-- ---------- 用户域 ----------
CREATE TABLE `user` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `username`     VARCHAR(50)  NOT NULL,
  `nickname`     VARCHAR(50)  NOT NULL,
  `password`     VARCHAR(100) NOT NULL,
  `email`        VARCHAR(100) DEFAULT NULL,
  `phone`        VARCHAR(20)  DEFAULT NULL,
  `avatar`       VARCHAR(255) DEFAULT NULL,
  `gender`       TINYINT      NOT NULL DEFAULT 0,
  `bio`          VARCHAR(200) DEFAULT NULL,
  `hobbies`      VARCHAR(200) DEFAULT NULL COMMENT '个人爱好标签，逗号分隔（已废弃，改用 favorite_game_ids）',
  `favorite_board_ids` VARCHAR(500) DEFAULT NULL COMMENT '常看板块ID，逗号分隔',
  `favorite_game_ids`  VARCHAR(500) DEFAULT NULL COMMENT '喜欢的游戏ID，逗号分隔（从游戏库多选；1.2 起替代 hobbies）',
  `status`       TINYINT      NOT NULL DEFAULT 0,
  `points`       INT          NOT NULL DEFAULT 0,
  `activity_score` INT          NOT NULL DEFAULT 0 COMMENT '活跃度累计分：发帖×10+回帖×5+获赞×2+登录天数×3',
  `activity_level` TINYINT      NOT NULL DEFAULT 1 COMMENT '活跃度等级 1-5',
  `last_login_at` DATETIME    DEFAULT NULL,
  `last_username_change_at` DATETIME DEFAULT NULL COMMENT '上次修改账号(登录名)时间，用于每年一次限制',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`      TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

CREATE TABLE `role` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(20) NOT NULL,
  `code`        VARCHAR(20) NOT NULL,
  `description` VARCHAR(100) DEFAULT NULL,
  `created_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

CREATE TABLE `user_role` (
  `id`      BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `role_id` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_role` (`user_id`, `role_id`),
  KEY `idx_role` (`role_id`),
  CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `role` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-角色关联表';

CREATE TABLE `follow` (
  `id`          BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT   NOT NULL,
  `follow_type` TINYINT  NOT NULL COMMENT '1=用户 2=板块',
  `follow_id`   BIGINT   NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_target` (`user_id`, `follow_type`, `follow_id`),
  KEY `idx_target` (`follow_type`, `follow_id`),
  CONSTRAINT `fk_follow_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='关注表';

-- ---------- 内容域 ----------
CREATE TABLE `board` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50) NOT NULL,
  `description` VARCHAR(200) DEFAULT NULL,
  `icon`        VARCHAR(255) DEFAULT NULL,
  `parent_id`   BIGINT      DEFAULT NULL,
  `sort`        INT         NOT NULL DEFAULT 0,
  `post_count`  INT         NOT NULL DEFAULT 0,
  `status`      TINYINT     NOT NULL DEFAULT 0,
  `created_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`parent_id`),
  CONSTRAINT `fk_board_parent` FOREIGN KEY (`parent_id`) REFERENCES `board` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='板块表(固定六种分类)';

CREATE TABLE `tag` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(30) NOT NULL,
  `use_count`  INT         NOT NULL DEFAULT 0,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`    TINYINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标签表';

CREATE TABLE `post` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT       NOT NULL,
  `board_id`    BIGINT       NOT NULL,
  `game_id`     BIGINT       DEFAULT NULL COMMENT '关联游戏ID（P0 游戏库）',
  `title`       VARCHAR(100) NOT NULL,
  `content`     LONGTEXT     NOT NULL,
  `summary`     VARCHAR(200) DEFAULT NULL,
  `cover`       LONGTEXT     DEFAULT NULL,
  `type`        TINYINT      NOT NULL DEFAULT 0 COMMENT '0普通 1攻略 2资讯 3提问 4闲置',
  `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '0正常(可见) 1隐藏/驳回 2待审核',
  `is_top`      TINYINT      NOT NULL DEFAULT 0,
  `is_essence`  TINYINT      NOT NULL DEFAULT 0,
  `view_count`  INT          NOT NULL DEFAULT 0,
  `reply_count` INT          NOT NULL DEFAULT 0,
  `like_count`  INT          NOT NULL DEFAULT 0,
  `reject_reason` VARCHAR(500) DEFAULT NULL COMMENT '驳回理由（status=1 隐藏时填写）',
  `reviewer_id` BIGINT       DEFAULT NULL COMMENT '审核人 user_id（用于审计）',
  `resubmit_at` DATETIME     DEFAULT NULL COMMENT '被驳回后重新提交审核的时间（待重审标记，通过后清空）',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_board` (`board_id`),
  KEY `idx_game` (`game_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_created` (`created_at`),
  FULLTEXT KEY `ft_title_content` (`title`, `content`),
  CONSTRAINT `fk_post_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_post_board` FOREIGN KEY (`board_id`) REFERENCES `board` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_post_game` FOREIGN KEY (`game_id`) REFERENCES `game` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子表';

CREATE TABLE `reply` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `post_id`     BIGINT       NOT NULL,
  `user_id`     BIGINT       NOT NULL,
  `content`     TEXT         NOT NULL,
  `reply_to_id` BIGINT       DEFAULT NULL COMMENT '楼中楼：回复的某条回复 id',
  `floor`       INT          DEFAULT NULL COMMENT '楼层号',
  `status`      TINYINT      NOT NULL DEFAULT 0,
  `like_count`  INT          NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_post` (`post_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_reply_post` FOREIGN KEY (`post_id`) REFERENCES `post` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_reply_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='回帖表';

CREATE TABLE `post_tag` (
  `id`      BIGINT NOT NULL AUTO_INCREMENT,
  `post_id` BIGINT NOT NULL,
  `tag_id`  BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_tag` (`post_id`, `tag_id`),
  KEY `idx_tag` (`tag_id`),
  CONSTRAINT `fk_pt_post` FOREIGN KEY (`post_id`) REFERENCES `post` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pt_tag` FOREIGN KEY (`tag_id`) REFERENCES `tag` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子-标签关联表';

-- ---------- 互动域 ----------
CREATE TABLE `favorite` (
  `id`         BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT   NOT NULL,
  `post_id`    BIGINT   NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`    TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_post` (`user_id`, `post_id`),
  KEY `idx_post` (`post_id`),
  CONSTRAINT `fk_fav_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_fav_post` FOREIGN KEY (`post_id`) REFERENCES `post` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收藏表';

CREATE TABLE `likes` (
  `id`          BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT   NOT NULL,
  `target_type` TINYINT  NOT NULL COMMENT '1帖子 2回复',
  `target_id`   BIGINT   NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_target` (`user_id`, `target_type`, `target_id`),
  KEY `idx_target` (`target_type`, `target_id`),
  CONSTRAINT `fk_like_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='点赞表';

-- ---------- 消息域 ----------
CREATE TABLE `message` (
  `id`          BIGINT   NOT NULL AUTO_INCREMENT,
  `from_user_id` BIGINT  NOT NULL,
  `to_user_id`  BIGINT   NOT NULL,
  `content`     TEXT     NOT NULL,
  `is_read`     TINYINT  NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_to_read` (`to_user_id`, `is_read`),
  KEY `idx_from` (`from_user_id`),
  CONSTRAINT `fk_msg_from` FOREIGN KEY (`from_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_msg_to` FOREIGN KEY (`to_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='私信表(对话由 from/to 聚合，无 conversation 表)';

CREATE TABLE `notification` (
  `id`           BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT   NOT NULL,
  `type`         TINYINT  NOT NULL COMMENT '1回复 2点赞 3@ 4系统 5私信',
  `sender_id`    BIGINT   DEFAULT NULL,
  `target_type`  TINYINT  DEFAULT NULL COMMENT '1帖子 2回复',
  `target_id`    BIGINT   DEFAULT NULL,
  `source_id`    BIGINT   DEFAULT NULL COMMENT '关联来源ID（如回复ID）',
  `content`      VARCHAR(200) DEFAULT NULL,
  `is_read`      TINYINT  NOT NULL DEFAULT 0,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`      TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_user_read` (`user_id`, `is_read`),
  KEY `idx_created` (`created_at`),
  -- 9-07：通知合并 (同 user/type/target/source 仅一条，source_id 可空；MySQL NULL 不互冲)
  UNIQUE KEY `uk_noti_merge` (`user_id`, `type`, `target_id`, `source_id`),
  CONSTRAINT `fk_noti_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_noti_sender` FOREIGN KEY (`sender_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知表';

-- ---------- 审核域 ----------
CREATE TABLE `report` (
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

CREATE TABLE `moderator_board` (
  `id`          BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT   NOT NULL COMMENT '版主用户ID',
  `game_id`     BIGINT   DEFAULT NULL COMMENT '负责游戏ID；NULL 表示不限游戏（兼容存量）',
  `board_id`    BIGINT   DEFAULT NULL COMMENT '负责板块ID；游戏级版主留 NULL 表示负责该游戏全部板块（1.2 起取消板块细分）',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_game_board` (`user_id`, `game_id`, `board_id`),
  KEY `idx_game_board_user` (`game_id`, `board_id`, `user_id`),
  CONSTRAINT `fk_mb_user`  FOREIGN KEY (`user_id`)  REFERENCES `user`  (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_mb_game`  FOREIGN KEY (`game_id`)  REFERENCES `game`  (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_mb_board` FOREIGN KEY (`board_id`) REFERENCES `board` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版主负责(游戏,板块)关联表';

-- ============ 游戏库表（P0：结构化游戏条目） ============
CREATE TABLE `game` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL COMMENT '游戏名称',
  `cover`       VARCHAR(255) DEFAULT NULL COMMENT '封面图 URL',
  `platform`    VARCHAR(50)  DEFAULT NULL COMMENT '平台：PC/手机/主机/多平台',
  `genre`       VARCHAR(50)  DEFAULT NULL COMMENT '类型：RPG/FPS/策略等',
  `description` VARCHAR(500) DEFAULT NULL COMMENT '游戏简介',
  `developer`   VARCHAR(100) DEFAULT NULL COMMENT '开发商',
  `publisher`   VARCHAR(100) DEFAULT NULL COMMENT '发行商',
  `release_date` DATE        DEFAULT NULL COMMENT '发行日期',
  `post_count`  INT          NOT NULL DEFAULT 0 COMMENT '关联帖子数',
  `sort`        INT          NOT NULL DEFAULT 0 COMMENT '排序权重',
  `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '0=展示 1=隐藏',
  `is_hot`      TINYINT      NOT NULL DEFAULT 0 COMMENT '是否热门游戏（首页/下拉优先展示）',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`     TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_status_sort` (`status`, `sort` DESC, `id` DESC),
  KEY `idx_platform` (`platform`),
  KEY `idx_genre` (`genre`),
  FULLTEXT KEY `ft_name_desc` (`name`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='游戏库表';

-- ============ 签到表（P0：每日签到成长） ============
CREATE TABLE `sign_in` (
  `id`               BIGINT   NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT   NOT NULL,
  `sign_date`        DATE     NOT NULL COMMENT '签到日期',
  `continuous_days`  INT      NOT NULL DEFAULT 1 COMMENT '连续签到天数',
  `points`           INT      NOT NULL DEFAULT 0 COMMENT '本次获得积分',
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date` (`user_id`, `sign_date`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_sign_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='签到表';

-- ============ 积分日志表（P0：积分变更流水） ============
CREATE TABLE `points_log` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT       NOT NULL,
  `type`          TINYINT      NOT NULL COMMENT '1签到 2发帖 3回帖 4获赞 5精华 6消费',
  `delta`         INT          NOT NULL COMMENT '变动值（正增负减）',
  `balance_after` INT          NOT NULL COMMENT '变动后余额',
  `description`   VARCHAR(200) DEFAULT NULL COMMENT '说明',
  `related_id`    BIGINT       DEFAULT NULL COMMENT '关联对象ID（如帖子ID）',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_type` (`user_id`, `type`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_points_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分日志表';

-- ============ 公告表（后台管理 · 系统公告） ============
CREATE TABLE `announcement` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(100) NOT NULL,
  `content`    TEXT         NOT NULL,
  `status`     TINYINT      NOT NULL DEFAULT 0 COMMENT '0=展示 1=隐藏',
  `is_top`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否置顶：0=否 1=是（v1.2 起替代 sort 数字权重）',
  `sort`       INT          NOT NULL DEFAULT 0 COMMENT '保留字段，不再使用（v1.2 起由 is_top 决定先后）',
  `created_by` BIGINT       DEFAULT NULL COMMENT '发布管理员 ID',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted`    TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_status_top_created` (`status`, `is_top` DESC, `created_at` DESC, `id` DESC),
  CONSTRAINT `fk_ann_user` FOREIGN KEY (`created_by`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统公告表';
