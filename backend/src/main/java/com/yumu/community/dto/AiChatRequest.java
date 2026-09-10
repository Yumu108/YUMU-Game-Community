package com.yumu.community.dto;

import lombok.Data;

/**
 * 智能助手对话请求：前端以 fetch 流式推送用户消息。
 */
@Data
public class AiChatRequest {

    /** 用户本轮输入 */
    private String message;

    /** 前端维护的多轮会话 ID（首轮可空，后端回传新 ID） */
    private String conversationId;

    /** 用户标识（登录态传 uid，否则前端生成稳定匿名 ID） */
    private String userId;
}
