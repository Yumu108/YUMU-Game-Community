package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 通知视图对象。
 * type: 1=点赞 2=评论/回复 3=关注 4=系统公告 5=审核通知(帖子驳回)
 */
@Data
public class NotificationVO {

    private Long id;
    private Integer type;
    private Long senderId;
    private String senderNickname;
    private Integer targetType;
    private Long targetId;
    /** 关联来源 ID，例如回复通知的 replyId */
    private Long sourceId;
    private String content;
    private Integer isRead;
    private LocalDateTime createdAt;
}
