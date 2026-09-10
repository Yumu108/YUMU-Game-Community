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
     * allowedBoardIds 为 null 时表示 ADMIN 可查看全部；为具体列表时表示 MODERATOR 仅可查看负责板块相关的举报。
     */
    PageResult<ReportVO> list(Integer status, long current, long size, List<Long> allowedBoardIds);

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
