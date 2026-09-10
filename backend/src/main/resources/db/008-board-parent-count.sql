-- ============================================================
-- 修复父板块 post_count：使其等于所有子板块 post_count 之和
-- 可重复执行（幂等）
-- ============================================================

UPDATE `board` AS parent
LEFT JOIN (
    SELECT `parent_id`, SUM(`post_count`) AS sum_count
    FROM `board`
    WHERE `parent_id` IS NOT NULL AND `status` = 0 AND `deleted` = 0
    GROUP BY `parent_id`
) AS child ON child.parent_id = parent.id
SET parent.post_count = COALESCE(child.sum_count, 0)
WHERE parent.parent_id IS NULL
  AND parent.status = 0
  AND parent.deleted = 0;
