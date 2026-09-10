package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.SendMessageRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.MessageService;
import com.yumu.community.vo.ConversationVO;
import com.yumu.community.vo.MessageVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/messages")
@RequiredArgsConstructor
public class MessageController {

    private final MessageService messageService;

    /** 私信会话列表 */
    @GetMapping("/conversations")
    public Result<List<ConversationVO>> conversations(
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(messageService.listConversations(details.getUserId()));
    }

    /** 与某用户的对话记录 */
    @GetMapping("/{userId}")
    public Result<PageResult<MessageVO>> with(
            @PathVariable Long userId,
            @AuthenticationPrincipal CustomUserDetails details,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "30") long size) {
        return Result.success(messageService.listMessages(details.getUserId(), userId, current, size));
    }

    /** 发送私信 */
    @PostMapping
    public Result<Map<String, Object>> send(
            @Valid @RequestBody SendMessageRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long id = messageService.send(details.getUserId(), req.getToUserId(), req.getContent());
        return Result.success(Map.of("id", id));
    }

    /** 标记与某用户的对话为已读 */
    @PostMapping("/read/{userId}")
    public Result<Void> read(
            @PathVariable Long userId,
            @AuthenticationPrincipal CustomUserDetails details) {
        messageService.markRead(details.getUserId(), userId);
        return Result.success();
    }
}
