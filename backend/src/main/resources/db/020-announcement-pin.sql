-- 公告新增「置顶」列（v1.2 起替代手动数字排序权重）
-- 设计理由：旧版要求管理员填一个 0–9999 的 sort 数字表示「越大越靠前」，
-- 实际体验很差：
--   1. 不知道其他公告当前用了什么数字，会乱填一堆重复值导致排序不确定
--   2. 数字权重本质上只能是「置顶 / 普通」两档，过细的数值没有业务价值
-- 新设计：is_top=1 表示置顶；列表按 is_top DESC, created_at DESC 排序，
--   置顶项自动聚顶，非置顶项按创建时间倒序。

ALTER TABLE `announcement`
  ADD COLUMN `is_top` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否置顶：0=否，1=是' AFTER `status`;

-- 替换旧索引，新索引服务于 is_top 排序
ALTER TABLE `announcement` DROP INDEX `idx_status_sort`;
ALTER TABLE `announcement` ADD INDEX `idx_status_top_created` (`status`, `is_top` DESC, `created_at` DESC, `id` DESC);

-- 旧的 `sort` 列保留不动（兼容历史数据），但前端/接口不再使用它。
