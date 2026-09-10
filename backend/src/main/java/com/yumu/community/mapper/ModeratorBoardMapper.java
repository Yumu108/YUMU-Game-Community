package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.ModeratorBoard;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ModeratorBoardMapper extends BaseMapper<ModeratorBoard> {

    /**
     * 物理删除某用户的所有版主板块关联。
     * 必须绕过 @TableLogic：moderator_board 是纯关联表，若用逻辑删除，被删旧行仍占据
     * (user_id, board_id) 唯一键，重新分配同一板块时会触发 Duplicate entry 异常。
     */
    @Delete("DELETE FROM moderator_board WHERE user_id = #{userId}")
    void physicalDeleteByUserId(@Param("userId") Long userId);
}
