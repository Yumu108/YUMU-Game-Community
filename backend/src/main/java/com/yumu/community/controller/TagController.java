package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.PostService;
import com.yumu.community.service.TagService;
import com.yumu.community.vo.PostVO;
import com.yumu.community.vo.TagVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/tags")
@RequiredArgsConstructor
public class TagController {

    private final TagService tagService;
    private final PostService postService;

    /** 全部标签（公开，供发帖选择器联想） */
    @GetMapping
    public Result<List<TagVO>> list() {
        return Result.success(tagService.listTags());
    }

    /** 热门标签（公开，右栏/发帖页热词） */
    @GetMapping("/hot")
    public Result<List<TagVO>> hot(@RequestParam(defaultValue = "10") int limit) {
        return Result.success(tagService.hotTags(limit));
    }

    /** 单个标签详情（公开） */
    @GetMapping("/{tagId}")
    public Result<TagVO> detail(@PathVariable Long tagId) {
        return Result.success(tagService.getTag(tagId));
    }

    /** 标签下的帖子列表（公开，分页） */
    @GetMapping("/{tagId}/posts")
    public Result<PageResult<PostVO>> posts(
            @PathVariable Long tagId,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long uid = details != null ? details.getUserId() : null;
        return Result.success(postService.getPostsByTag(tagId, current, size, uid));
    }
}
