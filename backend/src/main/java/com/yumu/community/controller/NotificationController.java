package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.NotificationService;
import com.yumu.community.vo.NotificationVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    /** 我的通知列表 */
    @GetMapping
    public Result<List<NotificationVO>> list(
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(notificationService.list(details.getUserId()));
    }

    /** 未读数量（用于顶栏小红点） */
    @GetMapping("/unread-count")
    public Result<Map<String, Object>> unreadCount(
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(Map.of("count", notificationService.unreadCount(details.getUserId())));
    }

    /** 标记已读：不传 id 则全部已读 */
    @PostMapping("/read")
    public Result<Void> read(
            @RequestParam(required = false) Long id,
            @AuthenticationPrincipal CustomUserDetails details) {
        notificationService.markRead(details.getUserId(), id);
        return Result.success();
    }

    /** 清空已读：types 为空清全部，否则按类型范围清（如 @我的=6 / 系统=4,5） */
    @PostMapping("/clear-read")
    public Result<Void> clearRead(
            @RequestParam(required = false) List<Integer> types,
            @AuthenticationPrincipal CustomUserDetails details) {
        notificationService.clearRead(details.getUserId(), types);
        return Result.success();
    }
}
