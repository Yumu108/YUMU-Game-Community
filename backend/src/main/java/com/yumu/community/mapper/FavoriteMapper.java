package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.Favorite;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface FavoriteMapper extends BaseMapper<Favorite> {

    /** 物理删除（用于取消收藏，避免逻辑删除后唯一键冲突） */
    @Delete("DELETE FROM favorite WHERE id = #{id}")
    int physicalDeleteById(Long id);

    /**
     * 物理删除某个用户对某个帖子的全部 favorite 行（包括逻辑删除的僵尸数据）。
     * 在 toggleFavorite 中先调用此方法清理（防御性），再决定是否插入。
     */
    @Delete("DELETE FROM favorite WHERE user_id = #{userId} AND post_id = #{postId}")
    int physicalDeleteByUserPost(@org.apache.ibatis.annotations.Param("userId") Long userId,
                                  @org.apache.ibatis.annotations.Param("postId") Long postId);
}
