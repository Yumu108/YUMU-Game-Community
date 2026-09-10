package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.Follow;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface FollowMapper extends BaseMapper<Follow> {

    /**
     * 物理删除某用户对某目标的全部 follow 行（包括逻辑删除的僵尸数据）。
     * 在 toggleFollow 中先调用此方法清理（防御性），再决定是否插入，避免唯一键冲突。
     */
    @Delete("DELETE FROM follow WHERE user_id = #{userId} AND follow_type = #{followType} AND follow_id = #{followId}")
    int physicalDeleteByTarget(@Param("userId") Long userId,
                               @Param("followType") Integer followType,
                               @Param("followId") Long followId);
}
