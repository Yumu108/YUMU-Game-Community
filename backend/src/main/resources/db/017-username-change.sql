-- ============ 017：账号(登录名)修改能力 ============
-- 记录用户上次修改登录账号的时间，用于「账号每隔一年可修改一次」限制。
-- 历史用户该字段为 NULL，视为「从未修改过」，可立即修改一次。

ALTER TABLE `user`
  ADD COLUMN `last_username_change_at` DATETIME DEFAULT NULL
  COMMENT '上次修改账号(登录名)时间，用于每年一次限制'
  AFTER `last_login_at`;
