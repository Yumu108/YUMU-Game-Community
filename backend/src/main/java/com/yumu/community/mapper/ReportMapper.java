package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.entity.Report;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface ReportMapper extends BaseMapper<Report> {

    /**
     * 分页查询举报列表；支持按状态过滤，支持按负责板块过滤（MODERATOR）。
     * boardIds 为 null 时不过滤板块（ADMIN 使用）。
     */
    @Select("<script>" +
            "SELECT r.* FROM report r " +
            "WHERE r.deleted = 0 " +
            "<if test='status != null'> AND r.status = #{status} </if>" +
            "<if test='boardIds != null and boardIds.size &gt; 0'>" +
            " AND (" +
            "   (r.target_type = 1 AND EXISTS (SELECT 1 FROM post p WHERE p.id = r.target_id AND p.board_id IN " +
            "     <foreach collection='boardIds' item='bid' open='(' separator=',' close=')'> #{bid} </foreach>))" +
            "   OR " +
            "   (r.target_type = 2 AND EXISTS (SELECT 1 FROM reply rp JOIN post p ON p.id = rp.post_id WHERE rp.id = r.target_id AND p.board_id IN " +
            "     <foreach collection='boardIds' item='bid' open='(' separator=',' close=')'> #{bid} </foreach>))" +
            " )" +
            "</if>" +
            " ORDER BY r.created_at DESC" +
            "</script>")
    IPage<Report> selectReportPage(Page<Report> page,
                                   @Param("status") Integer status,
                                   @Param("boardIds") List<Long> boardIds);
}
