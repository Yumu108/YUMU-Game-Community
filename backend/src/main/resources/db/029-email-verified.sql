-- 029: 邮箱功能启用 —— user 表新增 email_verified（该邮箱是否经过验证码验证）
--
-- 背景：`user.email` 与唯一键 `uk_email` 自建表起就存在，但**一直未启用**——
--       注册时邮箱可选、无格式校验，登录也只认 username。9-15 起启用全套邮箱能力：
--       邮箱注册 / 邮箱登录 / 邮箱找回密码 / 换绑邮箱。
--
-- 语义：
--   0 = 未验证（或从未绑定邮箱，此时 email 为空）
--   1 = 已验证（走过邮箱验证码流程：新注册、或换绑成功）
--
-- 兼容：85 个老账号中 email 为空的保持 0；即便某个老账号历史上填过 email 也保持 0
--       （从未验证过），但这**不影响**它们继续用「账号id」登录。
ALTER TABLE `user`
    ADD COLUMN `email_verified` TINYINT NOT NULL DEFAULT 0 COMMENT '邮箱是否已验证：0=未验证/未绑定，1=已验证' AFTER `email`;
