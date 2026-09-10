package com.yumu.community.controller;

import com.yumu.community.common.BusinessException;
import com.yumu.community.common.Result;
import com.yumu.community.dto.CreateReplyRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.ReplyService;
import com.yumu.community.vo.ReplyVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/posts")
@RequiredArgsConstructor
public class ReplyController {

    private final ReplyService replyService;

    @GetMapping("/{postId}/replies")
    public Result<List<ReplyVO>> list(@PathVariable Long postId) {
        return Result.success(replyService.listByPost(postId));
    }

    @PostMapping("/{postId}/replies")
    public Result<Map<String, Object>> create(
            @PathVariable Long postId,
            @Valid @RequestBody CreateReplyRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        req.setPostId(postId);
        Long id = replyService.createReply(req, details.getUserId());
        return Result.success(Map.of("id", id));
    }

    /**
     * 作者本人 / ADMIN 删除自己的���帖（软删除 deleted=1）。
     * 不可通过此接口删别人的回帖（版主审核走 setHidden 隐藏接口）。
     */
    @DeleteMapping("/replies/{id}")
    public Result<Map<String, Object>> delete(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(replyService.deleteOwnReply(id, details.getUserId()));
    }

    /**
     * 1.2：切换对某条回复的点赞状态。返回 { liked, likeCount }。
     * 需登录；前端未登录态应禁用按钮。
     */
    @PostMapping("/replies/{id}/like")
    public Result<Map<String, Object>> toggleLike(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        if (details == null) {
            throw new BusinessException(401, "请先登录");
        }
        return Result.success(replyService.toggleLike(id, details.getUserId()));
    }
}
