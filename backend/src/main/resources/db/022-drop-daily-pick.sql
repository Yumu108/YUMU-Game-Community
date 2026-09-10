-- v1.2：去除人工精选管理功能，删除 daily_pick 表
-- 每日精选改为由系统按综合评分自动选取（人工加精优先）
DROP TABLE IF EXISTS `daily_pick`;