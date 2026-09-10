package com.yumu.community.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 智能助手多轮会话中的单条消息（仅用于服务端历史缓存与上游 messages 组装）。
 *
 * <p>之所以单独建类而不是用 {@code Map}：会话历史走 {@code CacheService}，
 * Redis 分支用 Jackson 按具体类型反序列化，用明确的类才能稳定还原。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiChatMessage {

    /** user / assistant（system 由服务端组装，不入历史缓存） */
    private String role;

    /** 消息正文 */
    private String content;
}
