package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.PostService;
import com.yumu.community.service.SubscriptionService;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/subscribe")
@RequiredArgsConstructor
public class SubscriptionController {

    private final SubscriptionService subscriptionService;
    private final PostService postService;

    /** 切换板块订阅 */
    @PostMapping("/board/{boardId}")
    public Result<Map<String, Object>> toggleBoard(
            @PathVariable Long boardId,
            @AuthenticationPrincipal CustomUserDetails details) {
        boolean followed = subscriptionService.toggleBoard(details.getUserId(), boardId);
        return Result.success(Map.of("followed", followed));
    }

    /** 切换关键词订阅 */
    @PostMapping("/keyword")
    public Result<Map<String, Object>> toggleKeyword(
            @RequestBody Map<String, String> body,
            @AuthenticationPrincipal CustomUserDetails details) {
        String keyword = body == null ? null : body.get("keyword");
        boolean followed = subscriptionService.toggleKeyword(details.getUserId(), keyword);
        return Result.success(Map.of("followed", followed));
    }

    /** 我的订阅列表（板块 + 关键词） */
    @GetMapping("/list")
    public Result<Map<String, Object>> list(@AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(subscriptionService.listSubscriptions(details.getUserId()));
    }

    /** 个性化订阅流：订阅板块 + 命中关键词的帖子（分页） */
    @GetMapping("/feed")
    public Result<PageResult<PostVO>> feed(
            @AuthenticationPrincipal CustomUserDetails details,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size) {
        return Result.success(postService.pagePersonalizedFeed(details.getUserId(), current, size));
    }
}
