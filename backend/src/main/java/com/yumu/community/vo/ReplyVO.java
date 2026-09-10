package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 回复视图对象（含作者与被回复者信息）。
 */
@Data
public class ReplyVO {

    private Long id;
    private Long postId;
    private Long userId;
    private String content;
    private Long replyToId;
    private Integer floor;
    private Integer likeCount;
    private LocalDateTime createdAt;

    /** 0=正常 1=隐藏（管理端列表使用） */
    private Integer status;

    private String authorName;
    private String authorAvatar;
    private String replyToName;
    /** 被回复者(父回复作者)的 userId —— 前端「回复 @昵称」前缀点击跳主页用 */
    private Long replyToUserId;

    /** 作者身份徽章 */
    private String authorBadge;
    private String authorBadgeColor;
    /** 作者活跃度等级与称号 */
    private Integer authorLevel;
    private String authorLevelTitle;
}
