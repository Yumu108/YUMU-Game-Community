package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("reply")
public class Reply extends BaseEntity {

    private Long postId;
    private Long userId;
    private String content;
    private Long replyToId;
    private Integer floor;
    private Integer status;
    private Integer likeCount;
}
