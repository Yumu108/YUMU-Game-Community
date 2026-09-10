package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.Notification;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface NotificationMapper extends BaseMapper<Notification> {

    /**
     * 系统公告：type=4 的最近 limit 条（全局，不区分用户）。
     */
    @Select("""
            SELECT id, user_id, type, sender_id, target_type, target_id, content, is_read,
                   created_at, updated_at, deleted
            FROM notification
            WHERE deleted = 0 AND type = 4
            ORDER BY created_at DESC
            LIMIT #{limit}
            """)
    List<Notification> selectSystemAnnouncements(@Param("limit") long limit);

    /**
     * 按合并键查询（**故意忽略逻辑删除**）。
     *
     * 🚨 背景：notification 表自 026 起有唯一键 uk_noti_merge(user_id, type, target_id, source_id)。
     * 而 BaseEntity 的 @TableLogic 会让 deleted=1 的行对常规查询不可见 —— **但唯一索引照样生效**。
     * 因此「先按 deleted=0 查不到 → 再 insert」的写法，一旦存在同键软删行就必然
     * Duplicate entry → 500。凡按合并键写入的路径，查重都必须走本方法。
     *
     * `<=>` 是 MySQL 的 NULL 安全等于：source_id 为 NULL（如 @提及帖子场景）也能正确命中。
     */
    @Select("""
            SELECT id, user_id, type, sender_id, target_type, target_id, source_id,
                   content, is_read, created_at, updated_at, deleted
            FROM notification
            WHERE user_id = #{userId}
              AND type = #{type}
              AND target_id <=> #{targetId,jdbcType=BIGINT}
              AND source_id <=> #{sourceId,jdbcType=BIGINT}
            ORDER BY id DESC
            LIMIT 1
            """)
    Notification selectByMergeKeyIgnoreDeleted(@Param("userId") Long userId,
                                               @Param("type") int type,
                                               @Param("targetId") Long targetId,
                                               @Param("sourceId") Long sourceId);

    /**
     * 按合并键原子 upsert：不存在则插入；已存在（**含软删行**）则更新并复活。
     *
     * 语义：同 (user, type, target, source) 只保留一条，后发生的事件覆盖文案并置未读。
     * `id = LAST_INSERT_ID(id)` 是 MySQL 惯用法 —— 让 useGeneratedKeys 回填
     * **已存在行的真实 id**，调用方拿到的 n.getId() 一定有效，可直接用于 WebSocket 推送。
     */
    @Insert("""
            INSERT INTO notification
                (user_id, type, sender_id, target_type, target_id, source_id, content, is_read, deleted)
            VALUES
                (#{userId}, #{type}, #{senderId}, #{targetType},
                 #{targetId,jdbcType=BIGINT}, #{sourceId,jdbcType=BIGINT},
                 #{content}, 0, 0)
            ON DUPLICATE KEY UPDATE
                id          = LAST_INSERT_ID(id),
                sender_id   = #{senderId},
                target_type = #{targetType},
                content     = #{content},
                is_read     = 0,
                deleted     = 0,
                created_at  = NOW(),
                updated_at  = NOW()
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int upsertByMergeKey(Notification notification);
}
