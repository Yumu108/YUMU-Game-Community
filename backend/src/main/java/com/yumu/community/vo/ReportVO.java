package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 举报视图对象（附带举报人昵称与被举报对象标题，便于审核后台展示）。
 */
@Data
public class ReportVO {

    private Long id;
    private Long reporterId;
    private String reporterName;
    private Integer targetType;
    private Long targetId;
    /** 标题/摘要：帖子=帖子标题；回复="回复 #{floor}「{content 前 30}」"；用户=昵称。 */
    private String targetTitle;
    private String reason;
    private Integer status;
    private String handleNote;
    private Long handlerId;
    private LocalDateTime createdAt;

    /** 9-07：举报回复时 = 该回复所在帖子 id；举报帖子时 = 帖子自身 id（用于前端"查看原文"跳转）。 */
    private Long postId;
    /** 9-07：仅 type=2 回复时填，前端拼接 /post/{postId}?replyId={replyId} 高亮该楼。 */
    private Long replyId;
    /** 9-07：仅 type=2 回复时填，用于 targetTitle 摘要。 */
    private Integer replyFloor;
}
