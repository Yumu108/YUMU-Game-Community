package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.dto.HandleReportRequest;
import com.yumu.community.dto.SubmitReportRequest;
import com.yumu.community.entity.Report;
import com.yumu.community.vo.ReportVO;

import java.util.List;

public interface ReportService {

    /** 提交举报（任意登录用户）。返回举报记录 id。 */
    Long submit(SubmitReportRequest req, Long reporterId);

    /**
     * 举报列表（管理员/版主，按状态过滤 + 分页）。
     *
     * @param allowedGameIds `null` = 不过滤（ADMIN 看全部）；
     *        具体列表 = MODERATOR 只看**这些游戏**下的举报；**空列表** = 一条都不给看
     *        （版主没被分配任何游戏时的正确结果，调用方别把空列表当成 null 传）。
     *
     * 🚨 判据是**游戏**而不是板块（2026-09-26 修正）：授权模型已改为游戏级
     *    （`moderator_board.board_id` 恒 NULL）。原先按 board_id 过滤会生成
     *    `IN (null)` 恒不命中，版主永远看到空列表 —— 详见 `ReportMapper#selectReportPage`。
     */
    PageResult<ReportVO> list(Integer status, long current, long size, List<Long> allowedGameIds);

    /**
     * C2：我的举报（举报人视角，分页 + 可选状态过滤）。
     * 举报闭环：用户能看到自己的举报处于「待处理 / 已处理(违规) / 已驳回」。
     */
    PageResult<ReportVO> listMine(Long reporterId, Integer status, long current, long size);

    /** 获取举报记录（用于权限校验）。 */
    Report getReport(Long reportId);

    /** 处理举报（管理员/版主）。status=1 标记违规(帖子类会自动隐藏)，status=2 驳回。 */
    void handle(Long reportId, Integer status, String handleNote, Long handlerId);
}
