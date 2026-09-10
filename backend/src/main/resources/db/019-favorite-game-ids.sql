-- ============ 019：游戏爱好（多选游戏 ID） ============
-- 在 user 表新增 favorite_game_ids 字段（存逗号分隔的 game.id），用于替代旧的 hobbies 字段。
-- 旧 hobbies 字段保留不动（避免破坏既有数据），新代码统一读写 favorite_game_ids。
-- 字段位置：紧邻 favorite_board_ids，便于阅读。

ALTER TABLE `user`
  ADD COLUMN `favorite_game_ids` VARCHAR(500) DEFAULT NULL
  COMMENT '喜欢的游戏 ID，逗号分隔；从游戏库多选（1.2 起替代 hobbies）' AFTER `favorite_board_ids`;