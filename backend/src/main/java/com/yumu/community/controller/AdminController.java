package com.yumu.community.controller;

import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.HandleReportRequest;
import com.yumu.community.dto.RejectPostRequest;
import com.yumu.community.entity.Post;
import com.yumu.community.entity.Report;
import com.yumu.community.entity.Reply;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.mapper.ReplyMapper;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.service.PostService;
import com.yumu.community.service.ReplyService;
import com.yumu.community.service.ReportService;
import com.yumu.community.vo.PostVO;
import com.yumu.community.vo.ReportVO;
import com.yumu.community.vo.ReplyVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 管理/审核后台接口：ADMIN 可管理所有板块，MODERATOR 只能处理自己负责板块的内容。
 * - 帖子置顶/加精：仅 ADMIN
 * - 帖子隐藏/恢复：ADMIN 或 MODERATOR（且帖子属于负责板块）
 * - 举报列表与处理：ADMIN 或 MODERATOR（且举报目标帖子/回复属于负责板块）
 */
@RestController
@RequestMapping("/admin")
@RequiredArgsConstructor
@PreAuthorize("hasAnyRole('ADMIN','MODERATOR')")
public class AdminController {

    private final PostService postService;
    private final ReportService reportService;
    private final ModeratorBoardService moderatorBoardService;
    private final PostMapper postMapper;
    private final ReplyMapper replyMapper;
    private final ReplyService replyService;

    @PostMapping("/posts/{id}/pin")
    @PreAuthorize("hasRole('ADMIN')")
    public Result<Map<String, Object>> togglePin(@PathVariable Long id) {
        return Result.success(postService.setPin(id));
    }

    @PostMapping("/posts/{id}/essence")
    public Result<Map<String, Object>> toggleEssence(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        // 加精：ADMIN 全权；版主仅可对其负责的游戏加精（按游戏级授权校验）
        assertCanModeratePost(id, details);
        return Result.success(postService.setEssence(id));
    }

    @PostMapping("/posts/{id}/hide")
    public Result<Map<String, Object>> hide(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        assertCanModeratePost(id, details);
        return Result.success(postService.setHidden(id, true));
    }

    @PostMapping("/posts/{id}/restore")
    public Result<Map<String, Object>> restore(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        assertCanModeratePost(id, details);
        return Result.success(postService.setHidden(id, false));
    }

    @PostMapping("/posts/{id}/approve")
    public Result<Map<String, Object>> approve(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        if (!postService.canReviewPost(id, details.getUserId())) {
            throw new BusinessException(403, "无权审核该帖子（可能因为你就是发帖人，或需更高级别审核）");
        }
        return Result.success(postService.setPostStatus(id, 0));
    }

    @PostMapping("/posts/{id}/pending")
    @PreAuthorize("hasRole('ADMIN')")
    public Result<Map<String, Object>> pending(@PathVariable Long id) {
        return Result.success(postService.setPostStatus(id, 2));
    }

    /** 驳回帖子：status=1 隐藏 + 写入驳回理由 + 通知发帖人。仅当层级允许时可通过（canReviewPost）。 */
    @PostMapping("/posts/{id}/reject")
    public Result<Map<String, Object>> reject(
            @PathVariable Long id,
            @Valid @RequestBody RejectPostRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        if (!postService.canReviewPost(id, details.getUserId())) {
            throw new BusinessException(403, "无权驳回该帖子（可能因为你就是发帖人，或需更高级别审核）");
        }
        return Result.success(postService.rejectPost(id, req.getReason(), details.getUserId()));
    }

    /** 单帖子审核权限预览：当前用户能否 review 这个帖子（前端"批准/驳回"按钮的使能依据）。 */
    @GetMapping("/posts/{id}/can-review")
    public Result<Map<String, Object>> canReview(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(Map.of("canReview", postService.canReviewPost(id, details.getUserId())));
    }

    /**
     * 审核预览帖子详情（含被隐藏/待审核的）。任何有审核资格的角色都能查看：
     * - ADMIN 全权
     * - MODERATOR 仅可查看自己负责板块的待审帖（由 canReviewPost 校验）
     * 之前固定 @PreAuthorize("hasRole('ADMIN')") 把版主挡在外面，是 bug。
     */
    @GetMapping("/posts/{id}/detail")
    public Result<PostVO> adminDetail(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        if (!postService.canReviewPost(id, details.getUserId())) {
            throw new BusinessException(403, "无权限查看该帖子（需要管理员或对应板块版主）");
        }
        return Result.success(postService.getAdminDetail(id));
    }

    @GetMapping("/posts/{id}/replies")
    public Result<List<ReplyVO>> adminReplies(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        assertCanModeratePost(id, details);
        return Result.success(replyService.listAdminByPost(id));
    }

    @GetMapping("/posts")
    public Result<PageResult<PostVO>> listPosts(
            @RequestParam(required = false) Long boardId,
            @RequestParam(required = false) Long gameId,
            @RequestParam(required = false) Integer status,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size,
            @RequestParam(defaultValue = "desc") String order,
            @RequestParam(required = false) Integer days,
            @AuthenticationPrincipal CustomUserDetails details) {
        // ADMIN：coverage=null（可见全部）；MODERATOR：仅自己负责的 (游戏, 板块) 对
        List<com.yumu.community.entity.ModeratorBoard> coverage =
                isAdmin(details) ? null : moderatorBoardService.listAssignments(details.getUserId());
        return Result.success(postService.pagePostsForModeration(boardId, gameId, status, current, size, order, days, coverage));
    }

    @GetMapping("/reports")
    public Result<PageResult<ReportVO>> listReports(
            @RequestParam(required = false) Integer status,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        // 举报列表：版主按所负责板块（跨游戏）查看；具体处理时由 canModerateReportTarget 精确校验 (游戏, 板块)
        List<Long> boardIds = isAdmin(details) ? null : moderatorBoardService.listBoardIdsByUserId(details.getUserId());
        return Result.success(reportService.list(status, current, size, boardIds));
    }

    @PostMapping("/reports/{id}/handle")
    public Result<Void> handleReport(
            @PathVariable Long id,
            @Valid @RequestBody HandleReportRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        if (!canModerateReportTarget(details, id)) {
            throw new BusinessException(403, "无权限处理该举报");
        }
        reportService.handle(id, req.getStatus(), req.getHandleNote(), details.getUserId());
        return Result.success();
    }

    private void assertCanModeratePost(Long postId, CustomUserDetails details) {
        if (isAdmin(details)) return;
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        if (!moderatorBoardService.covers(details.getUserId(), p.getGameId(), p.getBoardId())) {
            throw new BusinessException(403, "无权限审核该 (游戏, 板块) 帖子");
        }
    }

    @PostMapping("/replies/{id}/hide")
    public Result<Map<String, Object>> hideReply(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        assertCanModerateReply(id, details);
        return Result.success(replyService.setHidden(id, true));
    }

    @PostMapping("/replies/{id}/restore")
    public Result<Map<String, Object>> restoreReply(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        assertCanModerateReply(id, details);
        return Result.success(replyService.setHidden(id, false));
    }

    private void assertCanModerateReply(Long replyId, CustomUserDetails details) {
        if (isAdmin(details)) return;
        Reply rp = replyMapper.selectById(replyId);
        if (rp == null) throw new BusinessException(404, "回复不存在");
        Post p = postMapper.selectById(rp.getPostId());
        if (p == null) throw new BusinessException(404, "回复所属帖子不存在");
        if (!moderatorBoardService.covers(details.getUserId(), p.getGameId(), p.getBoardId())) {
            throw new BusinessException(403, "无权限审核该 (游戏, 板块) 回帖");
        }
    }

    /** 解析举报目标对应的 (游戏, 板块)，判断版主是否有权处理。 */
    private boolean canModerateReportTarget(CustomUserDetails details, Long reportId) {
        if (isAdmin(details)) return true;
        Report r = reportService.getReport(reportId);
        if (r == null) throw new BusinessException(404, "举报记录不存在");
        Long gameId = null;
        Long boardId = null;
        if (r.getTargetType() != null) {
            switch (r.getTargetType()) {
                case 1 -> {
                    Post p = postMapper.selectById(r.getTargetId());
                    if (p != null) { gameId = p.getGameId(); boardId = p.getBoardId(); }
                }
                case 2 -> {
                    Reply rp = replyMapper.selectById(r.getTargetId());
                    if (rp != null) {
                        Post p = postMapper.selectById(rp.getPostId());
                        if (p != null) { gameId = p.getGameId(); boardId = p.getBoardId(); }
                    }
                }
                default -> { }
            }
        }
        if (boardId == null) return false;
        return moderatorBoardService.covers(details.getUserId(), gameId, boardId);
    }

    private boolean isAdmin(CustomUserDetails details) {
        return details.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }
}
