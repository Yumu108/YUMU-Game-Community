-- 030: 板块「组队大厅」更名「玩家天地」并扩展定位（2026-09-17）
-- 背景：id=3 原本只承接组队帖，内容形态单一（求队/招募），板块活跃度靠单一题材撑。
--   更名「玩家天地」后定位放宽为「玩家向综合区」，允许三类内容：
--     1) 晒欧气 / 抽卡展示   2) 组队请求   3) 疑难求助 / 萌新提问
--   帖子归属不变（仍是 board_id=3），因此本迁移只改板块元信息 + 对齐计数，
--   不动 post 表；板块内的新内容由内容种子（db-seed）追加。
-- 配套：
--   · 前端常量：frontend/src/constants/boards.js（key teamup → players，emoji 🤝 → 🎮）
--   · 建库种子：backend/src/main/resources/db/init-boards.sql
--   · 小程序板块映射：miniprogram/src/api/config.js（仅注释）
--   · AI 知识库：YUMU社区知识库.md ↔ backend/src/main/resources/ai/community-knowledge.md（两份必须同步）
USE yumu_community;

-- 1) 板块更名 + 换图标 / 描述
UPDATE `board`
SET `name` = '玩家天地',
    `description` = '晒卡晒欧气 / 组队开黑 / 求助提问',
    `icon` = '🎮',
    `updated_at` = NOW()
WHERE `id` = 3;

-- 2) 板块 post_count 与真实可见帖对齐（项目铁律：计数不造假）
UPDATE `board` b
LEFT JOIN (
    SELECT board_id, COUNT(*) AS visible_cnt
    FROM post
    WHERE deleted = 0 AND status = 0
    GROUP BY board_id
) c ON c.board_id = b.id
SET b.post_count = COALESCE(c.visible_cnt, 0),
    b.updated_at = NOW();

-- 3) 对账（应返回「玩家天地」且各板块计数一致）
SELECT b.id, b.name, b.icon, b.post_count,
       (SELECT COUNT(*) FROM post p
         WHERE p.board_id = b.id AND p.deleted = 0 AND p.status = 0) AS real_cnt,
       IF(b.post_count = (SELECT COUNT(*) FROM post p
                           WHERE p.board_id = b.id AND p.deleted = 0 AND p.status = 0),
          'OK', 'MISMATCH') AS chk
FROM `board` b
ORDER BY b.id;
