package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.dto.HandleReportRequest;
import com.yumu.community.dto.SubmitReportRequest;
import com.yumu.community.entity.Post;
import com.yumu.community.entity.Report;
import com.yumu.community.entity.Reply;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.mapper.ReportMapper;
import com.yumu.community.mapper.ReplyMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.PostService;
import com.yumu.community.service.ReportService;
import com.yumu.community.service.ReplyService;
import com.yumu.community.vo.ReportVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ReportServiceImpl implements ReportService {

    private final ReportMapper reportMapper;
    private final UserMapper userMapper;
    private final PostMapper postMapper;
    private final ReplyMapper replyMapper;
    private final PostService postService;
    private final ReplyService replyService;

    /** 举报类型：1帖子 2回复 3用户 */
    private static final int TARGET_POST = 1;
    /** 处理状态：1已处理(违规) 2已驳回 */
    private static final int STATUS_RESOLVED = 1;
    private static final int STATUS_REJECTED = 2;

    @Override
    @Transactional
    public Long submit(SubmitReportRequest req, Long reporterId) {
        if (req.getTargetType() < 1 || req.getTargetType() > 3) {
            throw new BusinessException(400, "举报类型不合法");
        }
        // 校验被举报对象存在 + 状态（2026-09-08：非公开帖（待审核/隐藏/驳回）一律不接收举报）
        if (req.getTargetType() == TARGET_POST) {
            Post p = postMapper.selectById(req.getTargetId());
            if (p == null) {
                throw new BusinessException(404, "被举报的帖子不存在");
            }
            if (p.getStatus() != null && p.getStatus() != 0) {
                throw new BusinessException(403,
                        p.getStatus() == 2 ? "帖子正在审核中，暂不支持举报" : "该帖不可见，暂不支持举报");
            }
        }
        Report r = new Report();
        r.setReporterId(reporterId);
        r.setTargetType(req.getTargetType());
        r.setTargetId(req.getTargetId());
        r.setReason(req.getReason());
        r.setStatus(0);
        reportMapper.insert(r);
        return r.getId();
    }

    @Override
    public PageResult<ReportVO> list(Integer status, long current, long size, List<Long> allowedBoardIds) {
        current = Math.max(1, current);
        size = Math.min(100, Math.max(1, size));
        Page<Report> page = new Page<>(current, size);
        if (allowedBoardIds != null && allowedBoardIds.isEmpty()) {
            return PageResult.of(0, 0, current, size, List.of());
        }
        Page<Report> res = (Page<Report>) reportMapper.selectReportPage(page, status, allowedBoardIds);

        List<ReportVO> vos = toVOs(res.getRecords());
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    @Override
    public PageResult<ReportVO> listMine(Long reporterId, Integer status, long current, long size) {
        current = Math.max(1, current);
        size = Math.min(100, Math.max(1, size));
        Page<Report> res = reportMapper.selectPage(new Page<>(current, size),
                Wrappers.<Report>lambdaQuery()
                        .eq(Report::getReporterId, reporterId)
                        .eq(status != null, Report::getStatus, status)
                        .orderByDesc(Report::getCreatedAt));
        List<ReportVO> vos = toVOs(res.getRecords());
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    /** 组装举报 VO（昵称 / 目标标题摘要 / 跳转 id）。list 与 listMine 共用。 */
    private List<ReportVO> toVOs(List<Report> records) {
        Set<Long> reporterIds = records.stream().map(Report::getReporterId).collect(Collectors.toSet());
        Map<Long, User> userMap = reporterIds.isEmpty() ? Map.of()
                : userMapper.selectBatchIds(reporterIds).stream()
                    .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a));
        Set<Long> postIds = records.stream()
                .filter(r -> r.getTargetType() == TARGET_POST)
                .map(Report::getTargetId).collect(Collectors.toSet());
        Map<Long, Post> postMap = postIds.isEmpty() ? Map.of()
                : postMapper.selectBatchIds(postIds).stream()
                    .collect(Collectors.toMap(Post::getId, p -> p, (a, b) -> a));

        // 9-07：批量取回复（举报回复类型），用于填 targetTitle 摘要 + postId（回复所在帖子 id）
        Set<Long> replyIds = records.stream()
                .filter(r -> r.getTargetType() != null && r.getTargetType() == 2)
                .map(Report::getTargetId).collect(Collectors.toSet());
        Map<Long, Reply> replyMap = replyIds.isEmpty() ? Map.of()
                : replyMapper.selectBatchIds(replyIds).stream()
                    .collect(Collectors.toMap(Reply::getId, r -> r, (a, b) -> a));

        // 9-07：批量取被举报用户（type=3）的昵称
        Set<Long> reportedUserIds = records.stream()
                .filter(r -> r.getTargetType() != null && r.getTargetType() == 3)
                .map(Report::getTargetId).collect(Collectors.toSet());
        Map<Long, User> reportedUserMap = reportedUserIds.isEmpty() ? Map.of()
                : userMapper.selectBatchIds(reportedUserIds).stream()
                    .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a));

        List<ReportVO> vos = records.stream().map(r -> {
            ReportVO vo = new ReportVO();
            vo.setId(r.getId());
            vo.setReporterId(r.getReporterId());
            User u = userMap.get(r.getReporterId());
            vo.setReporterName(u != null ? (u.getNickname() != null ? u.getNickname() : u.getUsername()) : "未知用户");
            vo.setTargetType(r.getTargetType());
            vo.setTargetId(r.getTargetId());
            vo.setReason(r.getReason());
            vo.setStatus(r.getStatus());
            vo.setHandleNote(r.getHandleNote());
            vo.setHandlerId(r.getHandlerId());
            vo.setCreatedAt(r.getCreatedAt());
            if (r.getTargetType() != null && r.getTargetType() == TARGET_POST) {
                Post p = postMap.get(r.getTargetId());
                vo.setTargetTitle(p != null ? p.getTitle() : "(帖子已删除)");
                vo.setPostId(r.getTargetId()); // 帖子举报自身 = 跳转帖子
            } else if (r.getTargetType() != null && r.getTargetType() == 2) {
                Reply reply = replyMap.get(r.getTargetId());
                if (reply != null) {
                    String snippet = reply.getContent() == null ? "" : reply.getContent();
                    if (snippet.length() > 30) snippet = snippet.substring(0, 30) + "…";
                    vo.setReplyId(reply.getId());
                    vo.setReplyFloor(reply.getFloor());
                    vo.setPostId(reply.getPostId()); // 关键：回复所在帖子 id，用于跳转
                    vo.setTargetTitle("💬 回复 #" + reply.getFloor() + "「" + snippet + "」");
                } else {
                    vo.setTargetTitle("(回复已删除)");
                }
            } else if (r.getTargetType() != null && r.getTargetType() == 3) {
                User target = reportedUserMap.get(r.getTargetId());
                vo.setTargetTitle(target != null
                        ? "用户 @" + (target.getNickname() != null ? target.getNickname() : target.getUsername())
                        : "(用户已删除)");
            }
            return vo;
        }).toList();
        return vos;
    }

    @Override
    public Report getReport(Long reportId) {
        return reportMapper.selectById(reportId);
    }

    @Override
    @Transactional
    public void handle(Long reportId, Integer status, String handleNote, Long handlerId) {
        Report r = reportMapper.selectById(reportId);
        if (r == null) throw new BusinessException(404, "举报记录不存在");
        if (r.getStatus() != null && r.getStatus() != 0) {
            throw new BusinessException(400, "该举报已处理，不能重复处理");
        }
        if (status != STATUS_RESOLVED && status != STATUS_REJECTED) {
            throw new BusinessException(400, "处理结果必须是 1(违规) 或 2(驳回)");
        }
        r.setStatus(status);
        r.setHandleNote(handleNote);
        r.setHandlerId(handlerId);
        reportMapper.updateById(r);

        // 标记为违规时，按举报对象类型自动处理：帖子→隐藏；回复→隐藏
        if (status == STATUS_RESOLVED) {
            if (r.getTargetType() == TARGET_POST) {
                Post p = postMapper.selectById(r.getTargetId());
                if (p != null && p.getStatus() != null && p.getStatus() != 1) {
                    // 复用 PostService.setHidden：统一失效热门榜缓存并同步板块计数
                    postService.setHidden(r.getTargetId(), true);
                }
            } else if (r.getTargetType() == 2) { // 回复
                Reply reply = replyMapper.selectById(r.getTargetId());
                if (reply != null && reply.getStatus() != null && reply.getStatus() != 1) {
                    // 复用 ReplyService.setHidden：同步帖子回复数
                    replyService.setHidden(r.getTargetId(), true);
                }
            }
        }
    }
}
