package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("notification")
public class Notification extends BaseEntity {

    private Long userId;
    private Integer type;
    private Long senderId;
    private Integer targetType;
    private Long targetId;
    /** 关联来源 ID，例如回复通知时存储 replyId，用于前端精准跳转 */
    private Long sourceId;
    private String content;
    private Integer isRead;
}
