package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("post")
public class Post extends BaseEntity {

    private Long userId;
    private Long boardId;
    private Long gameId;
    private String title;
    private String content;
    private String summary;
    private String cover;
    private Integer type;
    private Integer status;
    private Integer isTop;
    private Integer isEssence;
    private Integer viewCount;
    private Integer replyCount;
    private Integer likeCount;
    private String rejectReason;
    private Long reviewerId;
    /** 被驳回后重新提交审核的时间（status=2 时非空即“待重审”）；审核通过后清空 */
    private LocalDateTime resubmitAt;
}
