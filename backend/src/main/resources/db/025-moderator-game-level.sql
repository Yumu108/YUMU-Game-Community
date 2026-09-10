-- 025 取消版主板块细分：版主改为「按游戏」授权（board_id 置 NULL 表示负责该游戏全部板块）
-- 同一游戏可配多名版主（上限见 ModeratorBoardServiceImpl.MAX_MODS_PER_GAME）。

-- 1) board_id 允许为 NULL
ALTER TABLE moderator_board
    MODIFY COLUMN `board_id` BIGINT DEFAULT NULL
    COMMENT '负责板块ID；游戏级版主留 NULL 表示负责该游戏全部板块（1.2 起取消板块细分）';

-- 2) 将同一 (user_id, game_id) 的多条 (游戏, 板块) 细分授权合并为一条游戏级授权：
--    保留每对 (user, game) 中 id 最小的一条并置 board_id=NULL，其余删除。
CREATE TEMPORARY TABLE IF NOT EXISTS mb_keep AS
    SELECT MIN(id) AS keep_id, user_id, game_id
    FROM moderator_board
    WHERE deleted = 0 AND board_id IS NOT NULL
    GROUP BY user_id, game_id;

-- 2a) 保留行置为游戏级（board_id = NULL）
UPDATE moderator_board mb
JOIN mb_keep k
  ON k.user_id = mb.user_id AND k.game_id = mb.game_id
SET mb.board_id = NULL
WHERE mb.id = k.keep_id AND mb.deleted = 0;

-- 2b) 删除同一 (user, game) 下的其余细分行（保留行已置 NULL，故被 board_id IS NOT NULL 排除）
DELETE mb2
FROM moderator_board mb2
JOIN mb_keep k
  ON k.user_id = mb2.user_id AND k.game_id = mb2.game_id
WHERE mb2.deleted = 0 AND mb2.board_id IS NOT NULL AND mb2.id != k.keep_id;

DROP TEMPORARY TABLE IF EXISTS mb_keep;
