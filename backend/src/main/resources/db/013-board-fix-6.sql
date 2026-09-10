-- ============================================================
-- 1.2 板块重构：取消子版块，固定 6 种分类
--   攻略心得 / 游戏吐槽 / 教学讨论 / 资讯速递 / 二次创作 / 其他
-- 仅处理 post + board（moderator_board 归并见 014）
-- 可重复执行（幂等）
-- ============================================================

-- 1) 原种子帖归并到父板块（按 parent_id 映射；52 视频剪辑语义属二次创作，校正到 5）
UPDATE `post` SET `board_id` = 1 WHERE `board_id` IN (11,12,13);
UPDATE `post` SET `board_id` = 5 WHERE `board_id` IN (52);
UPDATE `post` SET `board_id` = 2 WHERE `board_id` IN (31,32);
UPDATE `post` SET `board_id` = 3 WHERE `board_id` IN (21,22);
UPDATE `post` SET `board_id` = 4 WHERE `board_id` IN (41,42);
UPDATE `post` SET `board_id` = 5 WHERE `board_id` IN (51);

-- 2) 先确保「其他」板块(id=6)存在（兜底 UPDATE 需引用它）
INSERT INTO `board` (`id`, `name`, `description`, `icon`, `parent_id`, `sort`, `post_count`, `status`, `created_at`, `updated_at`, `deleted`)
SELECT 6, '其他', '不属于以上分类的杂谈', '📦', NULL, 6, 0, 0, NOW(), NOW(), 0
WHERE NOT EXISTS (SELECT 1 FROM `board` WHERE `id` = 6);

-- 3) 兜底：任何非固定板块(1-6)的残留帖子（如历史验证测试板块），归并到「其他」(6)
UPDATE `post` SET `board_id` = 6 WHERE `board_id` NOT IN (1,2,3,4,5,6);

-- 4) 删除所有非固定板块（帖子已先迁走，FK ON DELETE CASCADE 不会误删）
DELETE FROM `board` WHERE `id` NOT IN (1,2,3,4,5,6);

-- 5) 重算各板块 post_count（仅 status=0 可见帖）
UPDATE `board` b
SET b.`post_count` = (
  SELECT COUNT(*) FROM `post` p WHERE p.`board_id` = b.`id` AND p.`status` = 0 AND p.`deleted` = 0
)
WHERE b.`id` IN (1,2,3,4,5,6);
