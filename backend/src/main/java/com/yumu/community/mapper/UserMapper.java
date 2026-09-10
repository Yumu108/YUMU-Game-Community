package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.User;
import com.yumu.community.vo.ActiveUserVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface UserMapper extends BaseMapper<User> {

    /**
     * 活跃用户：按发帖数降序取前 limit 名。
     */
    @Select("""
            SELECT u.id AS id, u.nickname AS nickname, u.avatar AS avatar, u.bio AS bio,
                   COUNT(p.id) AS post_count,
                   u.activity_level AS activityLevel,
                   u.activity_score AS activityScore
            FROM user u
            LEFT JOIN post p ON p.user_id = u.id AND p.deleted = 0
            WHERE u.deleted = 0
            GROUP BY u.id, u.nickname, u.avatar, u.bio, u.activity_level, u.activity_score
            ORDER BY post_count DESC
            LIMIT #{limit}
            """)
    List<ActiveUserVO> selectActiveUsers(@Param("limit") long limit);

    /**
     * 某游戏的活跃玩家：按在该游戏下的发帖数（仅 status=0 可见帖）降序取前 limit 名。
     * LEFT JOIN 的 game_id / status 条件放在 ON 子句，未在该游戏发帖的用户 post_count=0 被 HAVING 过滤。
     */
    @Select("""
            SELECT u.id AS id, u.nickname AS nickname, u.avatar AS avatar, u.bio AS bio,
                   COUNT(p.id) AS post_count,
                   u.activity_level AS activityLevel,
                   u.activity_score AS activityScore
            FROM user u
            LEFT JOIN post p ON p.user_id = u.id AND p.deleted = 0 AND p.status = 0 AND p.game_id = #{gameId}
            WHERE u.deleted = 0
            GROUP BY u.id, u.nickname, u.avatar, u.bio, u.activity_level, u.activity_score
            HAVING post_count > 0
            ORDER BY post_count DESC
            LIMIT #{limit}
            """)
    List<ActiveUserVO> selectActiveUsersByGame(@Param("gameId") Long gameId, @Param("limit") long limit);

    /**
     * 某游戏的版主列表：JOIN moderator_board（1.2 起取消板块细分，版主按游戏授权，
     * board_id IS NULL 表示负责该游戏全部板块）。按用户聚合，返回 boardNames 由调用方拆成 List。
     * 同时附带该游戏下该版主的可见帖数（status=0 & deleted=0），用于展示「N 帖 · 称号」。
     */
    @Select("""
            SELECT u.id AS id, u.nickname AS nickname, u.avatar AS avatar, u.bio AS bio,
                   u.activity_level AS activityLevel,
                   u.activity_score AS activityScore,
                   COALESCE(pc.cnt, 0) AS postCount,
                   GROUP_CONCAT(DISTINCT b.name ORDER BY b.id) AS boardNames
            FROM user u
            JOIN moderator_board mb ON mb.user_id = u.id
            LEFT JOIN board b ON b.id = mb.board_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS cnt
                FROM post
                WHERE game_id = #{gameId} AND status = 0 AND deleted = 0
                GROUP BY user_id
            ) pc ON pc.user_id = u.id
            WHERE u.deleted = 0 AND mb.game_id = #{gameId}
            GROUP BY u.id, u.nickname, u.avatar, u.bio, u.activity_level, u.activity_score, pc.cnt
            ORDER BY u.id
            """)
    List<com.yumu.community.vo.GameModeratorVO> selectModeratorsByGame(@Param("gameId") Long gameId);

    /**
     * 9-07：@提及解析兼容 username OR nickname。用户手打 @登录名 或 @昵称 都能命中。
     * IN 列表用 OR 拼接；同一用户被多次命中（既匹配 username 又匹配 nickname）由 caller 端去重。
     * 仅返回 id+nickname+username 字段（避免回表）。
     */
    @Select("""
            <script>
            SELECT id, nickname, username FROM user
            WHERE deleted = 0
              AND (
                <foreach collection='nicks' item='n' separator=' OR '>
                  (nickname = #{n} OR username = #{n})
                </foreach>
              )
            </script>
            """)
    List<User> selectMentionedByNicknameOrUsername(@Param("nicks") java.util.List<String> nicks);
}
