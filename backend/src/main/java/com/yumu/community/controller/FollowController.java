package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.FollowService;
import com.yumu.community.vo.FollowUserVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/follow")
@RequiredArgsConstructor
public class FollowController {

    private final FollowService followService;

    /** 关注 / 取关某用户（切换），返回当前是否已关注 */
    @PostMapping("/{targetUserId}")
    public Result<Map<String, Object>> toggle(
            @PathVariable Long targetUserId,
            @AuthenticationPrincipal CustomUserDetails details) {
        boolean followed = followService.toggleFollow(details.getUserId(), targetUserId);
        return Result.success(Map.of("followed", followed));
    }

    /** 查询当前用户是否关注了目标用户 */
    @GetMapping("/check/{targetUserId}")
    public Result<Map<String, Object>> check(
            @PathVariable Long targetUserId,
            @AuthenticationPrincipal CustomUserDetails details) {
        boolean followed = followService.isFollowing(details.getUserId(), targetUserId);
        return Result.success(Map.of("followed", followed));
    }

    /** 我关注的用户 */
    @GetMapping("/following")
    public Result<PageResult<FollowUserVO>> following(
            @AuthenticationPrincipal CustomUserDetails details,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size) {
        return Result.success(followService.listFollowing(details.getUserId(), current, size));
    }

    /** 我的粉丝 */
    @GetMapping("/followers")
    public Result<PageResult<FollowUserVO>> followers(
            @AuthenticationPrincipal CustomUserDetails details,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size) {
        // viewerId = 当前登录用户，用于判断每个粉丝是否已被回关
        return Result.success(followService.listFollowers(details.getUserId(), details.getUserId(), current, size));
    }

    /** 某用户的关注数 / 粉丝数 */
    @GetMapping("/counts/{userId}")
    public Result<Map<String, Long>> counts(@PathVariable Long userId) {
        return Result.success(followService.getCounts(userId));
    }
}
