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

    /**
     * 2026-09-26：举报目标的归属（帖子/回复所在帖子的 game/board）。
     *
     * 为什么补这四个字段 —— 端内「举报处理」页需要回答版主最关心的那个问题：
     * **这条举报归不归我管**。v1 的列表只给 `targetTitle`，版主看到一堆理由
     * 却不知道是哪个游戏下的，只能靠点进去猜。
     *
     * ⚠️ type=3（举报用户）没有归属，四个字段全为 null —— 这类举报**只有管理员**
     *    能处理（版主的 `covers(userId, null, null)` 恒 false）。端内据此把
     *    处理按钮置灰，而不是让版主点了吃 403。
     * ⚠️ 目标帖子已被物理删除时也全为 null（`EXISTS` 查不到），文案退化成
     *    `(帖子已删除)`，同样不给处理按钮。
     */
    private Long gameId;
    private String gameName;
    private Long boardId;
    private String boardName;
}
