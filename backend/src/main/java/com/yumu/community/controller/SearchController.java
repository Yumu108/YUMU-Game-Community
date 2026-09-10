package com.yumu.community.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.entity.Board;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.SearchService;
import com.yumu.community.vo.FollowUserVO;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/search")
@RequiredArgsConstructor
public class SearchController {

    private final SearchService searchService;

    /**
     * 综合搜索：keyword 为空时返回空结构。
     * type=all（默认）：帖子(分页) + 板块 + 用户 + 游戏
     * type=post：仅帖子分页
     * type=board：仅板块
     * type=user：仅用户
     * type=game：仅游戏
     */
    @GetMapping
    public Result<?> search(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String type,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long userId = details != null ? details.getUserId() : null;
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            if ("post".equals(type)) {
                return Result.success(PageResult.of(0L, 0L, current, size, List.of()));
            }
            return Result.success(Map.of("posts", PageResult.of(0L, 0L, current, size, List.of()),
                    "boards", List.of(), "users", List.of(), "games", List.of()));
        }
        return switch (type) {
            case "post" -> Result.success(searchService.searchPosts(kw, current, size, userId));
            case "board" -> Result.success(searchService.searchBoards(kw));
            case "user" -> Result.success(searchService.searchUsers(kw));
            case "game" -> Result.success(searchService.searchGames(kw));
            default -> Result.success(searchService.searchAll(kw, userId));
        };
    }
}
