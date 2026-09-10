-- 024: 帖子新增 resubmit_at（被驳回后重新提交审核的时间）
-- 用途：status=2 且 resubmit_at 非空 → 前端/审核后台标注「待重审」，时间展示用 resubmit_at（而非首次 created_at）
-- 清空时机：审核通过（setPostStatus → 0）时置 NULL；再次驳回→重提会覆盖为新时间
ALTER TABLE `post`
    ADD COLUMN `resubmit_at` DATETIME DEFAULT NULL COMMENT '被驳回后重新提交审核的时间（待重审标记，通过后清空）' AFTER `reviewer_id`;
