-- 009 用户资料扩展：个人爱好 + 常看板块
-- 幂等：通过 information_schema 判断字段是否存在，避免重复执行报错
DROP PROCEDURE IF EXISTS `yumu_009_user_profile`;
DELIMITER $$
CREATE PROCEDURE `yumu_009_user_profile`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'hobbies'
  ) THEN
    ALTER TABLE `user` ADD COLUMN `hobbies` VARCHAR(200) DEFAULT NULL COMMENT '个人爱好标签，逗号分隔';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'favorite_board_ids'
  ) THEN
    ALTER TABLE `user` ADD COLUMN `favorite_board_ids` VARCHAR(500) DEFAULT NULL COMMENT '常看板块ID，逗号分隔';
  END IF;
END$$
DELIMITER ;
CALL `yumu_009_user_profile`();
DROP PROCEDURE IF EXISTS `yumu_009_user_profile`;
