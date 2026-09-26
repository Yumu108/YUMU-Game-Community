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
     * 分页查询举报列表；支持按状态过滤，支持按负责**游戏**过滤（MODERATOR）。
     * gameIds 为 null 时不过滤（ADMIN 使用）。
     *
     * 🚨 2026-09-26 修正：过滤维度由 `p.board_id` 改为 **`p.game_id`**。
     *    原因：授权模型早已从「(游戏, 板块) 细分」改成**游戏级**
     *    （`moderator_board.board_id` 统一为 NULL，见 `ModeratorBoardService` 注释），
     *    而 `listBoardIdsByUserId` 是对 `board_id` 列做 `distinct().sorted()` ——
     *    全 NULL 时结果是 `[null]`（单元素列表，不抛 NPE），于是这条 SQL 生成
     *    `p.board_id IN (null)`，**永远匹配不到任何行**：
     *    ⇒ 版主在主站举报队列里看到的是**空列表**，而他明明有权限处理。
     *      这属于「静默返回空」类故障 —— 接口 200、无报错、只是没有数据，
     *      很长一段时间没人发现（本轮做端内举报页时才暴露出来）。
     *
     *    ⚠️ 别改回 board_id：现在没有任何一行数据的 board_id 是非 NULL 的，
     *      按板块过滤等于按「一个恒不存在的值」过滤。
     */
    @Select("<script>" +
            "SELECT r.* FROM report r " +
            "WHERE r.deleted = 0 " +
            "<if test='status != null'> AND r.status = #{status} </if>" +
            "<if test='gameIds != null and gameIds.size &gt; 0'>" +
            " AND (" +
            "   (r.target_type = 1 AND EXISTS (SELECT 1 FROM post p WHERE p.id = r.target_id AND p.game_id IN " +
            "     <foreach collection='gameIds' item='gid' open='(' separator=',' close=')'> #{gid} </foreach>))" +
            "   OR " +
            "   (r.target_type = 2 AND EXISTS (SELECT 1 FROM reply rp JOIN post p ON p.id = rp.post_id WHERE rp.id = r.target_id AND p.game_id IN " +
            "     <foreach collection='gameIds' item='gid' open='(' separator=',' close=')'> #{gid} </foreach>))" +
            " )" +
            "</if>" +
            " ORDER BY r.created_at DESC" +
            "</script>")
    IPage<Report> selectReportPage(Page<Report> page,
                                   @Param("status") Integer status,
                                   @Param("gameIds") List<Long> gameIds);
}
