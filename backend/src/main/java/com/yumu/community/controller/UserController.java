package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.UpdatePasswordRequest;
import com.yumu.community.dto.UpdateProfileRequest;
import com.yumu.community.dto.UpdateUsernameRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.PostService;
import com.yumu.community.service.UserService;
import com.yumu.community.vo.PostVO;
import com.yumu.community.vo.UserInfoVO;
import com.yumu.community.vo.UserProfileVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final PostService postService;

    /** 用户主页公开信息 + 帖子列表（无需登录即可查看） */
    @GetMapping("/{id}")
    public Result<UserProfileVO> profile(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long vid = details != null ? details.getUserId() : null;
        return Result.success(userService.getProfile(id, vid));
    }

    /** 某用户的帖子列表（分页）。作者本人查看时包含自己的隐藏/待审核帖，其他人仅可见正常帖。 */
    @GetMapping("/{id}/posts")
    public Result<PageResult<PostVO>> posts(
            @PathVariable Long id,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long vid = details != null ? details.getUserId() : null;
        return Result.success(postService.postsByUser(id, current, size, vid));
    }

    /** 修改当前登录用户资料（昵称/头像/签名/爱好/常看板块） */
    @PutMapping("/me/profile")
    public Result<UserInfoVO> updateProfile(
            @Valid @RequestBody UpdateProfileRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(userService.updateProfile(details.getUserId(), req));
    }

    /** 修改密码（需原密码） */
    @PutMapping("/me/password")
    public Result<Void> updatePassword(
            @Valid @RequestBody UpdatePasswordRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        userService.updatePassword(details.getUserId(), req);
        return Result.success(null);
    }

    /** 修改登录账号（用户名），每年仅可修改一次，需登录 */
    @PutMapping("/me/username")
    public Result<UserInfoVO> updateUsername(
            @Valid @RequestBody UpdateUsernameRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(userService.updateUsername(details.getUserId(), req));
    }
}
