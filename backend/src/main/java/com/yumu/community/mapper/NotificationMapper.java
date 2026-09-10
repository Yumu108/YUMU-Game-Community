package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.Notification;
import org.apache.ibatis.annotations.Mapper;
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
}
