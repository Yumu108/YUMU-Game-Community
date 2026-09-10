package com.yumu.community.vo;

import lombok.Data;

import java.util.List;

/**
 * 用户信息（对外脱敏，不含密码）。
 */
@Data
public class UserInfoVO {

    private Long id;
    private String username;
    private String nickname;
    private String avatar;
    private String email;
    private String bio;
    private String hobbies;
    private String favoriteBoardIds;
    /** 喜欢的游戏 ID，逗号分隔（原始数据，供前端编辑回填）。 */
    private String favoriteGameIds;
    /** 喜欢的游戏解析后的精简信息（按热度/排序）。 */
    private List<com.yumu.community.vo.GameMiniVO> favoriteGames;
    private Integer gender;
    private List<String> roles;
    /** 身份徽章：ADMIN/MODERATOR/SUB_MODERATOR/null */
    private String badge;
    private String badgeColor;
    private String badgeText;
    /** 活跃度累计分 */
    private Integer activityScore;
    /** 活跃度等级 1-5 */
    private Integer activityLevel;
    /** 活跃度称号（活跃玩家/资深玩家…） */
    private String activityTitle;
    /** 当前积分余额（P0 成长体系） */
    private Integer points;

    /** 该用户所有可见帖子获得的点赞总数 */
    private Integer likeReceivedCount;

    /** 该用户负责的板块 id 列表（MODERATOR/ADMIN 才有，普通用户为空） */
    private List<Long> moderatorBoardIds;
    /** 该用户负责的板块名列表（前端展示用） */
    private List<String> moderatorBoardNames;
    /**
     * 该用户负责的游戏名列表（去重 + 按热度/sort 排序）。
     * 用于作者徽章展示：「版主 · 三角洲行动」之类。无负责游戏时为空列表。
     */
    private List<String> moderatorGameNames;

    /** 账号是否当前可修改（从未修改过 或 距上次修改已满一年） */
    private Boolean canChangeUsername;
    /** 若当前不可修改，下一次允许修改的时间点（ISO）；可修改时为 null */
    private java.time.LocalDateTime nextUsernameChangeAt;
}
