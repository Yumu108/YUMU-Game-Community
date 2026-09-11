-- ============================================================
-- D2（9-10）：管理员账号 —— 幂等初始化 / 口令重置
-- ------------------------------------------------------------
-- 为什么需要它：
--   此前管理员账号是**手工在数据库里建的**，`backend/src/main/resources/db/` 下
--   没有任何创建管理员的 SQL —— 换一台服务器部署就复现不出来（只能靠"记得当初怎么建"）。
--   任何写死于仓库或文档的弱凭据（如 admin/admin123456）上线即可被猜解，一律禁止。
--
-- 用法（任选其一）：
--   【推荐】deploy/tools/init-admin.sh
--           —— 自动生成随机强口令 → 生成 BCrypt 哈希 → 执行本脚本，一条命令搞定
--   【手工】
--     1) 生成 BCrypt 哈希（后端 jar 自带工具，无需任何额外依赖）：
--          java -jar backend/target/yumu-community-1.0.0.jar --gen-password
--     2) 带着哈希执行：
--          mysql -uroot -p yumu_community -e "SET @admin_password_hash='<上一步的哈希>'; SOURCE deploy/tools/init-admin.sql"
--
-- 幂等保证：
--   · 账号不存在 → 创建；已存在 → 仅重置口令并恢复启用状态，不动 id、不重复插入；
--   · @admin_password_hash 未提供 → **整份脚本零副作用**（绝不误建"空口令管理员"）。
-- 角色：绑定 role_id=3（ADMIN）+ role_id=1（普通用户，与注册用户一致）。
-- ============================================================

SET @admin_username = IFNULL(@admin_username, 'admin');
SET @admin_nickname = IFNULL(@admin_nickname, '管理员');

-- ① 不存在则创建（仅在确实提供了哈希时）
INSERT INTO user (username, nickname, password, status, points, created_at)
SELECT @admin_username, @admin_nickname, @admin_password_hash, 0, 0, NOW()
FROM DUAL
WHERE @admin_password_hash IS NOT NULL
  AND @admin_password_hash <> ''
  AND NOT EXISTS (SELECT 1 FROM user WHERE username = @admin_username);

-- ② 已存在则重置口令 + 恢复启用（status=0）；不动 id，避免破坏外键引用
UPDATE user
SET password = @admin_password_hash,
    status   = 0
WHERE username = @admin_username
  AND @admin_password_hash IS NOT NULL
  AND @admin_password_hash <> '';

-- ③ 角色绑定（幂等：先用 NOT EXISTS 判重，不依赖表上是否有唯一约束）
INSERT INTO user_role (user_id, role_id)
SELECT u.id, 3 FROM user u
WHERE u.username = @admin_username
  AND NOT EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = u.id AND ur.role_id = 3);

INSERT INTO user_role (user_id, role_id)
SELECT u.id, 1 FROM user u
WHERE u.username = @admin_username
  AND NOT EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = u.id AND ur.role_id = 1);

-- ④ 结果回显（含"未提供哈希"的显式提示，避免静默什么都没做）
SELECT u.id                             AS id,
       u.username                       AS username,
       u.nickname                       AS nickname,
       u.status                         AS status,
       GROUP_CONCAT(r.name)             AS roles,
       IF(@admin_password_hash IS NULL OR @admin_password_hash = '',
          '未提供 @admin_password_hash —— 本次未改动任何数据',
          '口令已设置：请用新口令登录，并尽快在个人设置中确认') AS result
FROM user u
LEFT JOIN user_role ur ON ur.user_id = u.id
LEFT JOIN role r       ON r.id = ur.role_id
WHERE u.username = @admin_username
GROUP BY u.id, u.username, u.nickname, u.status;
