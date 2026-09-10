package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.ResetPasswordRequest;
import com.yumu.community.dto.SetModeratorBoardsRequest;
import com.yumu.community.dto.UpdateUserRolesRequest;
import com.yumu.community.dto.UpdateUserProfileRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.AdminUserService;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.vo.AdminUserDetailVO;
import com.yumu.community.vo.AdminUserVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 后台管理系统用户管理接口：仅 ADMIN 可访问。
 * - 用户列表与搜索
 * - 修改用户角色（USER / MODERATOR / ADMIN）
 * - 分配版主负责板块
 */
@RestController
@RequestMapping("/admin/users")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminUserController {

    private final AdminUserService adminUserService;
    private final ModeratorBoardService moderatorBoardService;

    @GetMapping
    public Result<PageResult<AdminUserVO>> list(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long gameId,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size) {
        return Result.success(adminUserService.listUsers(keyword, gameId, current, size));
    }

    @GetMapping("/{id}")
    public Result<AdminUserDetailVO> detail(@PathVariable Long id) {
        return Result.success(adminUserService.getUserDetail(id));
    }

    @PutMapping("/{id}/roles")
    public Result<Void> updateRoles(
            @PathVariable Long id,
            @Valid @RequestBody UpdateUserRolesRequest req) {
        adminUserService.updateUserRoles(id, req.getRoles());
        return Result.success();
    }

    @GetMapping("/{id}/moderator-boards")
    public Result<List<com.yumu.community.vo.ModeratorAssignmentVO>> listModeratorBoards(@PathVariable Long id) {
        return Result.success(moderatorBoardService.listAssignmentsVO(id));
    }

    @PutMapping("/{id}/moderator-boards")
    public Result<Void> setModeratorBoards(
            @PathVariable Long id,
            @RequestBody SetModeratorBoardsRequest req) {
        moderatorBoardService.setModeratorBoards(id, req.getItems());
        return Result.success();
    }

    @PutMapping("/{id}/status")
    public Result<Void> setStatus(
            @PathVariable Long id,
            @RequestParam int status,
            @AuthenticationPrincipal CustomUserDetails details) {
        adminUserService.setUserStatus(details.getUserId(), id, status);
        return Result.success();
    }

    @PutMapping("/{id}/profile")
    public Result<Void> updateProfile(
            @PathVariable Long id,
            @Valid @RequestBody UpdateUserProfileRequest req) {
        adminUserService.updateUserProfile(id, req);
        return Result.success();
    }

    @PutMapping("/{id}/reset-password")
    public Result<Map<String, String>> resetPassword(
            @PathVariable Long id,
            @RequestBody ResetPasswordRequest req) {
        String pwd = adminUserService.resetPassword(id, req);
        return Result.success(Map.of("password", pwd));
    }

    @DeleteMapping("/{id}")
    public Result<Void> deleteUser(
            @PathVariable Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        adminUserService.deleteUser(details.getUserId(), id);
        return Result.success();
    }
}
