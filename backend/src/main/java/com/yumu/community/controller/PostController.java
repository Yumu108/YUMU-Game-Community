package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.CreatePostRequest;
import com.yumu.community.dto.SetPostTagsRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.PostService;
import com.yumu.community.service.TagService;
import com.yumu.community.vo.PostVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/posts")
@RequiredArgsConstructor
public class PostController {

    private final PostService postService;
    private final TagService tagService;

    @GetMapping
    public Result<PageResult<PostVO>> list(
            @RequestParam(required = false) Long boardId,
            @RequestParam(required = false) Long gameId,
            @RequestParam(defaultValue = "latest") String sort,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long uid = details != null ? details.getUserId() : null;
        return Result.success(postService.pagePosts(boardId, gameId, sort, current, size, uid));
    }

    /**
     * 关注流：仅当前用户关注的人（follow.follow_type=1）发的可见帖。
     * 支持排序二次筛选：all/latest/hot/essence/reply/favorite。
     * 需登录；未登录返回 401（Spring Security 默认）。
     */
    @GetMapping("/following")
    public Result<PageResult<PostVO>> following(
            @RequestParam(defaultValue = "latest") String sort,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        if (details == null) {
            return Result.error(401, "请先登录");
        }
        return Result.success(postService.pageFollowingFeed(details.getUserId(), sort, current, size));
    }

    @GetMapping("/{id}")
    public Result<PostVO> detail(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long uid = details != null ? details.getUserId() : null;
        return Result.success(postService.getDetail(id, uid));
    }

    @PostMapping
    public Result<Map<String, Object>> create(
            @Valid @RequestBody CreatePostRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long id = postService.createPost(req, details.getUserId());
        return Result.success(Map.of("id", id));
    }

    @PostMapping("/{id}/like")
    public Result<Map<String, Object>> like(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(postService.toggleLike(id, details.getUserId()));
    }

    @PostMapping("/{id}/favorite")
    public Result<Map<String, Object>> favorite(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(postService.toggleFavorite(id, details.getUserId()));
    }

    @PutMapping("/{id}/tags")
    public Result<Void> updateTags(
            @PathVariable Long id,
            @Valid @RequestBody SetPostTagsRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        tagService.setPostTags(id, details.getUserId(), req.getTags());
        return Result.success();
    }

    /** 作者/管理员隐藏自己的帖子（status=1） */
    @PostMapping("/{id}/hide")
    public Result<Map<String, Object>> hide(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(postService.setHiddenOwned(id, true, details.getUserId()));
    }

    /** 作者/管理员恢复自己的帖子（status=0） */
    @PostMapping("/{id}/restore")
    public Result<Map<String, Object>> restore(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(postService.setHiddenOwned(id, false, details.getUserId()));
    }

    /** 作者/管理员删除自��的帖子（软删除） */
    @DeleteMapping("/{id}")
    public Result<Map<String, Object>> delete(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(postService.deletePost(id, details.getUserId()));
    }

    /**
     * 作者/管理员编辑自己的帖子（更新 title/content/summary/cover/tags/gameId/type/boardId）。
     * 不可通过此接口改 status/isTop/isEssence 等审核字段（保持原值，避免被绕审）。
     */
    @PutMapping("/{id}")
    public Result<Map<String, Object>> update(
            @PathVariable Long id,
            @Valid @RequestBody CreatePostRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(postService.updatePost(id, req, details.getUserId()));
    }
}
