-- ============================================================
-- 1.2 游戏库种子：热门游戏 + "其他游戏"兜底项
-- 幂等：ON DUPLICATE KEY UPDATE（重跑只更新，不重复插）
-- ============================================================

-- 0) 幂等给活库 game 表加 is_hot 列（schema.sql 已含，活库需补）
SET @db = 'yumu_community';
SET @h = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='game' AND COLUMN_NAME='is_hot');
SET @a = IF(@h=0, "ALTER TABLE game ADD COLUMN is_hot TINYINT NOT NULL DEFAULT 0 COMMENT '是否热门游戏（首页/下拉优先展示）' AFTER status", 'SELECT 1');
PREPARE sa FROM @a; EXECUTE sa; DEALLOCATE PREPARE sa;

INSERT INTO `game` (`id`, `name`, `cover`, `platform`, `genre`, `description`, `developer`, `publisher`, `release_date`, `post_count`, `sort`, `status`, `is_hot`, `created_at`, `updated_at`, `deleted`) VALUES
(1,  '其他游戏',           NULL, '多平台', '其他',   '库里没有的小众/冷门游戏，发布时选它兜底', NULL, NULL, NULL, 0, 999, 0, 0, NOW(), NOW(), 0),
(2,  '原神',               NULL, '多平台', 'RPG',   '米哈游开放世界动作 RPG', 'miHoYo', 'miHoYo', '2020-09-28', 0, 10, 0, 1, NOW(), NOW(), 0),
(3,  '王者荣耀',           NULL, '手机',   'MOBA',  '腾讯天美国民级手游', '腾讯天美', '腾讯', '2015-11-26', 0, 11, 0, 1, NOW(), NOW(), 0),
(4,  '和平精英',           NULL, '手机',   '射击',  '腾讯光子战术竞技手游', '腾讯光子', '腾讯', '2019-05-08', 0, 12, 0, 1, NOW(), NOW(), 0),
(5,  '英雄联盟',           NULL, 'PC',     'MOBA',  'Riot Games 经典 MOBA', 'Riot Games', 'Riot Games', '2009-10-27', 0, 13, 0, 1, NOW(), NOW(), 0),
(6,  'CS2',                NULL, 'PC',     'FPS',   'Valve 战术射击', 'Valve', 'Valve', '2023-09-27', 0, 14, 0, 1, NOW(), NOW(), 0),
(7,  '永劫无间',           NULL, 'PC',     '动作',  '24 Entertainment / 网易 武侠吃鸡', '24 Entertainment', '网易', '2021-08-12', 0, 15, 0, 1, NOW(), NOW(), 0),
(8,  '蛋仔派对',           NULL, '手机',   '派对',  '网易休闲派对竞技', '网易', '网易', '2022-05-26', 0, 16, 0, 1, NOW(), NOW(), 0),
(9,  '第五人格',           NULL, '手机',   '非对称', '网易非对称对抗手游', '网易', '网易', '2018-04-02', 0, 17, 0, 1, NOW(), NOW(), 0),
(10, '崩坏：星穹铁道',     NULL, '多平台', 'RPG',   'miHoYo 回合制 RPG', 'miHoYo', 'miHoYo', '2023-04-26', 0, 18, 0, 1, NOW(), NOW(), 0),
(11, '绝区零',             NULL, '多平台', 'ACT',   'miHoYo 都市动作 RPG', 'miHoYo', 'miHoYo', '2024-07-04', 0, 19, 0, 1, NOW(), NOW(), 0),
(12, '明日方舟',           NULL, '手机',   '塔防',  '鹰角网络策略塔防', '鹰角网络', '鹰角网络', '2019-05-01', 0, 20, 0, 1, NOW(), NOW(), 0),
(13, '阴阳师',             NULL, '手机',   'RPG',   '网易和风卡牌 RPG', '网易', '网易', '2016-09-02', 0, 21, 0, 1, NOW(), NOW(), 0),
(14, 'DOTA2',              NULL, 'PC',     'MOBA',  'Valve 经典 MOBA', 'Valve', 'Valve', '2013-07-09', 0, 22, 0, 1, NOW(), NOW(), 0),
(15, 'APEX英雄',           NULL, '多平台', '射击',  'Respawn / EA 大逃杀', 'Respawn', 'EA', '2019-02-04', 0, 23, 0, 1, NOW(), NOW(), 0),
(16, '艾尔登法环',         NULL, '多平台', '魂类',  'FromSoftware 开放世界魂', 'FromSoftware', '万代南梦宫', '2022-02-25', 0, 24, 0, 1, NOW(), NOW(), 0),
(17, '黑神话：悟空',       NULL, 'PC',     'ACT',   '游戏科学 国产 3A 动作', '游戏科学', '游戏科学', '2024-08-20', 0, 25, 0, 1, NOW(), NOW(), 0),
(18, '塞尔达传说：王国之泪', NULL, '主机', '开放世界', '任天堂开放世界冒险', '任天堂', '任天堂', '2023-05-12', 0, 26, 0, 1, NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`), `platform`=VALUES(`platform`), `genre`=VALUES(`genre`),
  `description`=VALUES(`description`), `developer`=VALUES(`developer`), `publisher`=VALUES(`publisher`),
  `release_date`=VALUES(`release_date`), `sort`=VALUES(`sort`), `status`=VALUES(`status`), `is_hot`=VALUES(`is_hot`);
