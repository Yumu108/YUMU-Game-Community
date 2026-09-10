-- 修正 status 列默认值：代码约定 status=0 为「正常/可见」，原 DEFAULT 1 会导致
-- 任何未显式指定 status 的插入（帖子/回复/板块/用户）默认进入「隐藏/禁用」状态，属潜在缺陷。
-- 全部改为 DEFAULT 0，与运行时代码语义一致。
ALTER TABLE `user`   ALTER `status` SET DEFAULT 0;
ALTER TABLE `board`  ALTER `status` SET DEFAULT 0;
ALTER TABLE `post`   ALTER `status` SET DEFAULT 0;
ALTER TABLE `reply`  ALTER `status` SET DEFAULT 0;
