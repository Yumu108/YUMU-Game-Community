-- 初始化板块数据（1.2：固定六种分类，取消子版块）
-- 仅在 board 表为空时执行；如已存在可删除旧数据后重跑。
DELETE FROM `board`;
ALTER TABLE `board` AUTO_INCREMENT = 1;

INSERT INTO `board` (`id`, `name`, `description`, `icon`, `parent_id`, `sort`, `post_count`, `status`, `created_at`, `updated_at`, `deleted`) VALUES
(1, '攻略心得', '游戏攻略与心得分享',        '📘', NULL, 1, 0, 0, NOW(), NOW(), 0),
(2, '游戏吐槽', '想吐槽就来这',              '💬', NULL, 2, 0, 0, NOW(), NOW(), 0),
(3, '组队大厅', '召集队友、开黑组队',        '🤝', NULL, 3, 0, 0, NOW(), NOW(), 0),
(4, '资讯速递', '游戏新闻与行业资讯',        '📰', NULL, 4, 0, 0, NOW(), NOW(), 0),
(5, '二次创作', '同人图 / 视频 / 音乐',      '🎨', NULL, 5, 0, 0, NOW(), NOW(), 0),
(6, '其他',     '不属于以上分类的杂谈',      '📦', NULL, 6, 0, 0, NOW(), NOW(), 0);
