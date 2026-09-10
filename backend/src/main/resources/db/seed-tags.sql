-- ============================================================
-- 标签种子 + 关联回灌（开发期演示数据）
-- 说明：tag / post_tag 表初始为空，本脚本灌入 12 个常用游戏标签，
--       并把现有正常帖按 id 取模挂 1~2 个标签，使「热门标签」与标签页有内容。
-- 幂等：每次先清空再插入。
-- ============================================================
DELETE FROM post_tag;
DELETE FROM tag;
ALTER TABLE tag AUTO_INCREMENT = 1;
ALTER TABLE post_tag AUTO_INCREMENT = 1;

INSERT INTO tag (name, use_count) VALUES
('单机大作', 0),
('多人联机', 0),
('魂系', 0),
('开放世界', 0),
('Roguelike', 0),
('二次元', 0),
('电竞', 0),
('模拟经营', 0),
('恐怖生存', 0),
('独立游戏', 0),
('手柄操作', 0),
('速通攻略', 0);

-- 每帖按 id 取模挂第 1 个标签
INSERT INTO post_tag (post_id, tag_id)
SELECT p.id, (1 + (p.id % 12)) AS tag_id
FROM post p WHERE p.status = 0;

-- 再按另一种取模挂第 2 个标签（与第 1 个重复时因唯一约束自动忽略）
INSERT INTO post_tag (post_id, tag_id)
SELECT p.id, (1 + ((p.id * 7) % 12)) AS tag_id
FROM post p WHERE p.status = 0
ON DUPLICATE KEY UPDATE post_id = p.id;

-- 重算每个标签的 use_count
UPDATE tag t SET use_count = (SELECT COUNT(*) FROM post_tag pt WHERE pt.tag_id = t.id);
