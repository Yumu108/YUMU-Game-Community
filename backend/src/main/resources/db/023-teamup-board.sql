-- 023: 板块「教学讨论」更名「组队大厅」（2026-09-03）
-- 背景：教学讨论与攻略心得定位重叠，id=3 改为组队大厅（召集队友 / 开黑组队）。
-- 配套：
--   1) 原「教学讨论」下的帖子整体迁往「攻略心得」(board 1)，组队大厅从空开始承接组队帖；
--   2) 同步修复 post_count 口径：createPost 曾对待审帖多 +1（审核通过再 +1 造成双计），
--      代码已修复（PostServiceImpl createPost/deletePost/rejectPost），此处把各板块
--      post_count 与真实可见帖（deleted=0 AND status=0）对齐，消除历史漂移。
-- 前端常量同步：frontend/src/constants/boards.js；建库种子同步：init-boards.sql。
USE yumu_community;

-- 1) 板块更名 + 换图标 / 描述
UPDATE `board`
SET `name` = '组队大厅',
    `description` = '召集队友、开黑组队',
    `icon` = '🤝',
    `updated_at` = NOW()
WHERE `id` = 3;

-- 2) 原教学讨论帖子（含已隐藏/待审/逻辑删除行，保持归属一致）迁移到攻略心得
UPDATE `post` SET `board_id` = 1 WHERE `board_id` = 3;

-- 3) 各板块 post_count 与真实可见帖对齐（项目铁律：计数不造假）
UPDATE `board` b
LEFT JOIN (
    SELECT board_id, COUNT(*) AS visible_cnt
    FROM post
    WHERE deleted = 0 AND status = 0
    GROUP BY board_id
) c ON c.board_id = b.id
SET b.post_count = COALESCE(c.visible_cnt, 0),
    b.updated_at = NOW();
