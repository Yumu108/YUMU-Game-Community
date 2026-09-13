-- ============================================================
-- 演示用户种子（2026-09-13）
-- 用途：`016-v12-content-reset.sql` 的演示帖子/回帖/点赞引用了
--       user_id = 2、10~15，但**全新空库里这些用户不存在**，
--       会直接报 FK 1452（Cannot add or update a child row）。
--       本文件负责在导入演示内容前把演示用户建出来。
-- 适用：仅用于本地/演示环境；`init-db.sh --no-demo` 不会执行本文件。
-- 说明：
--   · 密码统一为 123456（BCrypt），仅供演示，生产环境请勿使用；
--   · id 与 `016-v12-content-reset.sql` 的作者一一对应，勿改；
--   · INSERT IGNORE：重复执行安全（不会撞 uk_username）。
-- ============================================================

-- ---------- 1. 演示用户 ----------
INSERT IGNORE INTO `user`
  (id, username, nickname, password, status, points, activity_score, activity_level, bio, created_at)
VALUES
  (2,  'yumu',       'yumu',     '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 523, 431, 2, 'YUMU 社区的小编，游戏都玩一点。',        DATE_SUB(NOW(), INTERVAL 200 DAY)),
  (10, 'ye_xingzhe', '夜行者',   '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 306, 351, 2, '夜猫子玩家，凌晨开黑找我。',              DATE_SUB(NOW(), INTERVAL 150 DAY)),
  (11, 'caicaizi',   '菜菜子',   '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 397, 417, 2, '手残但爱玩，接受一切组队邀请。',          DATE_SUB(NOW(), INTERVAL 150 DAY)),
  (12, 'laoxianyu',  '老咸鱼',   '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 307, 314, 2, '咸鱼一条，只玩自己喜欢的。',              DATE_SUB(NOW(), INTERVAL 150 DAY)),
  (13, 'dianjing',   '电竞少女', '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 537, 426, 2, 'FPS 专精，天梯爱好者。',                  DATE_SUB(NOW(), INTERVAL 120 DAY)),
  (14, 'moyu',       '摸鱼大师', '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 252, 381, 2, '上班摸鱼，下班开黑。',                    DATE_SUB(NOW(), INTERVAL 120 DAY)),
  (15, 'yinghe',     '硬核玩家', '$2a$10$in7Oy94kfg8pbC9Jg.xor..FjJnSQ1IfOKxoYmZrhdT6iBxfsBT9u', 0, 248, 410, 2, '只玩硬核，欢迎交流。',                    DATE_SUB(NOW(), INTERVAL 100 DAY));

-- ---------- 2. 绑定普通用户角色（role id：1=USER 2=MODERATOR 3=ADMIN） ----------
INSERT IGNORE INTO `user_role` (user_id, role_id) VALUES
  (2, 1), (10, 1), (11, 1), (12, 1), (13, 1), (14, 1), (15, 1);
