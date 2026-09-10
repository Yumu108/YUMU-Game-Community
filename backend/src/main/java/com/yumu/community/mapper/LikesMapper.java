package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.Likes;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface LikesMapper extends BaseMapper<Likes> {

    /** 物理删除（用于取消点赞，避免逻辑删除后唯一键冲突） */
    @Delete("DELETE FROM likes WHERE id = #{id}")
    int physicalDeleteById(Long id);

    /**
     * 物理删除某个用户对某个目标的全部 likes 行（包括逻辑删除的僵尸数据）。
     * 在 toggleLike 中先调用此方法清理（防御性），再决定是否插入。
     */
    @Delete("DELETE FROM likes WHERE user_id = #{userId} AND target_type = #{targetType} AND target_id = #{targetId}")
    int physicalDeleteByTarget(@org.apache.ibatis.annotations.Param("userId") Long userId,
                                @org.apache.ibatis.annotations.Param("targetType") Integer targetType,
                                @org.apache.ibatis.annotations.Param("targetId") Long targetId);
}
