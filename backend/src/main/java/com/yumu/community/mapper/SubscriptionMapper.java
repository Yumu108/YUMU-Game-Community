package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.Subscription;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;

public interface SubscriptionMapper extends BaseMapper<Subscription> {

    /**
     * 物理删除某用户的板块订阅（包括僵尸数据），避免 uk_user_sub 唯一键冲突。
     */
    @Delete("DELETE FROM subscription WHERE user_id = #{userId} AND sub_type = 1 AND target_id = #{boardId}")
    int physicalDeleteBoard(@Param("userId") Long userId, @Param("boardId") Long boardId);

    /**
     * 物理删除某用户的关键词订阅（包括僵尸数据）。
     */
    @Delete("DELETE FROM subscription WHERE user_id = #{userId} AND sub_type = 2 AND keyword = #{keyword}")
    int physicalDeleteKeyword(@Param("userId") Long userId, @Param("keyword") String keyword);
}
