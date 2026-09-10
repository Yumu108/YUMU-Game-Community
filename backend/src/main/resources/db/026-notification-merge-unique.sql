-- 026: notification 合并：同 (user_id, type, target_id, source_id) 合并为一条 + 计数
-- 背景：当前 @提及 (type=6) 每发一次帖子/回帖都新增一条，同帖同用户被 @ 多次会出现 N 条「提到了你」信息轰炸
-- 改造：加 (user_id, type, target_id, source_id) 联合唯一索引（source_id 可为 NULL，MySQL 允许多个 NULL 不冲突）
-- 后端 MentionNotifier 改 update-or-insert：同 key 已有则 count+1、content 更新为"提到了你 (×N)"、is_read=0、created_at=now
ALTER TABLE `notification`
    ADD UNIQUE KEY `uk_noti_merge` (`user_id`, `type`, `target_id`, `source_id`);
