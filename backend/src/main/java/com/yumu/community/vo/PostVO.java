package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 帖子视图对象（含作者与板块信息，以及当前用户的点赞/收藏状态）。
 */
@Data
public class PostVO {

    private Long id;
    private Long userId;
    private Long boardId;
    private Long gameId;
    private String gameName;
    private String gameCover;
    private String title;
    private String content;
    private String summary;
    private String cover;
    private Integer isTop;
    private Integer isEssence;
    private Integer viewCount;
    private Integer replyCount;
    private Integer likeCount;
    private Integer status;
    private LocalDateTime createdAt;

    private String authorName;
    private String authorAvatar;
    private String boardName;

    /** 作者身份徽章：ADMIN / MODERATOR / SUB_MODERATOR / null */
    private String authorBadge;
    private String authorBadgeColor;
    /**
     * 作者负责的游戏名列表（仅当 authorBadge=MODERATOR 时才有意义）。
     * 用于作者徽章展示：「版主 · 三角洲行动」之类；多个游戏时取第一个，剩余放 tooltip。
     */
    private List<String> authorModeratorGameNames;
    /** 作者活跃度等级 1-5 与称号 */
    private Integer authorLevel;
    private String authorLevelTitle;

    /** 仅当传入 userId 时填充：当前用户是否已点赞 */
    private Boolean liked;
    /** 仅当传入 userId 时填充：当前用户是否已收藏 */
    private Boolean favorited;

    /** 帖子挂载的标签（仅详情接口填充） */
    private List<TagVO> tags;

    /** 驳回理由（status=1 时填写） */
    private String rejectReason;
    /** 审核人 user_id */
    private Long reviewerId;
    /** 被驳回后重新提交审核的时间；status=2 且非空 = 「待重审」，前端时间展示优先用它 */
    private LocalDateTime resubmitAt;

    /**
     * 是否为「预览态」：true 表示当前用户是管理员或版主，正在预览一个已隐藏/驳回的帖子
     * （前端应显示预览横幅，并禁用点赞/收藏/回帖/举报等会污染数据的操作；不计入 view_count）。
     * status=0 或作者本人查看时不标记；普通用户无权访问，更不会标记。
     */
    private Boolean previewOnly;

    /**
     * 是否为运营手动精选。
     * true = 后台 admin 手动指定的精选/热门；
     * false = 后台未选，自动从「最近热度榜」兜底（保证页面永远有内容）。
     * 前端可在 UI 上加不同角标提示。
     */
    private Boolean curated;
}
