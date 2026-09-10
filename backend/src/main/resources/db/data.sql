-- 初始化角色数据（私信/用户系统依赖 role 表）
INSERT INTO `role` (`name`, `code`, `description`) VALUES
('普通用户', 'USER',  '默认注册用户'),
('版主',     'MODERATOR', '板块管理者'),
('管理员',   'ADMIN', '系统管理员');
