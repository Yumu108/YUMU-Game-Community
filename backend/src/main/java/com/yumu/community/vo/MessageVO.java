package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;

/** 单条私信。 */
@Data
public class MessageVO {

    private Long id;
    private Long fromUserId;
    private String fromNickname;
    private Long toUserId;
    private String content;
    private Integer isRead;
    private LocalDateTime createdAt;
}
