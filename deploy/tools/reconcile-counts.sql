-- ============================================================================
-- 冗余计数对账（幂等，可反复执行）
-- ============================================================================
-- 背景
--   board.post_count / game.post_count 是**冗余计数**：发帖、过审、删除、隐藏、
--   改归属时由业务代码增量维护。一旦某个分支漏加/漏减（如 2026-09-03 修复前的
--   "待审通过双计"），计数就会与事实漂移；表现是**前台板块/游戏帖数 ≠ 列表里的条数**。
--
-- 本脚本按「唯一事实来源」重算，口径与业务代码完全一致：
--   只统计 status = 0（已公开；待审 2 / 隐藏或驳回 1 都不计）
--     且 deleted = 0（未逻辑删除）的帖
--
-- 何时执行
--   · 上线前 / 数据迁移或导入后
--   · 发现前台帖数与点进去的列表条数对不上时
--   · 大批量删帖、批量审核、批量改归属之后
--
-- 用法
--   mysql -uroot -p --default-character-set=utf8mb4 yumu_community < reconcile-counts.sql
-- ============================================================================

UPDATE `board` b
SET b.post_count = (
    SELECT COUNT(*) FROM `post` p
    WHERE p.board_id = b.id AND p.status = 0 AND p.deleted = 0
);

UPDATE `game` g
SET g.post_count = (
    SELECT COUNT(*) FROM `post` p
    WHERE p.game_id = g.id AND p.status = 0 AND p.deleted = 0
);

-- 对账结果（应全部为 0）
SELECT 'board 不一致' AS 项,
       COUNT(*) AS 条数
FROM `board` b
WHERE b.post_count <> (SELECT COUNT(*) FROM `post` p
                       WHERE p.board_id = b.id AND p.status = 0 AND p.deleted = 0)
UNION ALL
SELECT 'game 不一致', COUNT(*)
FROM `game` g
WHERE g.post_count <> (SELECT COUNT(*) FROM `post` p
                       WHERE p.game_id = g.id AND p.status = 0 AND p.deleted = 0);
