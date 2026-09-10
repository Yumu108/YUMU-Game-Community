package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;

/** 私信会话：与某位用户的汇总（最后一条消息 + 未读数）。 */
@Data
public class ConversationVO {

    private Long userId;
    private String nickname;
    private String avatar;
    private String lastMessage;
    private LocalDateTime lastTime;
    private Long unread;
}
