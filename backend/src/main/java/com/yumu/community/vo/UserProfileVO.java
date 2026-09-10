package com.yumu.community.vo;

import lombok.Data;

import java.util.List;

/**
 * 用户主页公开信息（脱敏，不含密码/邮箱等敏感字段）。
 */
@Data
public class UserProfileVO {

    private Long id;
    private String username;
    private String nickname;
    private String avatar;
    private String bio;
    private String hobbies;
    private String favoriteBoardIds;
    /** 喜欢的游戏 ID，逗号分隔（原始数据，供前端编辑回填）。 */
    private String favoriteGameIds;
    /** 喜欢的游戏解析后的精简信息（按热度/排序）。 */
    private List<com.yumu.community.vo.GameMiniVO> favoriteGames;
    private Integer gender;

    private Long followingCount;
    private Long followersCount;
    private Long postCount;

    /** P0 成长体系：积分与活跃度 */
    private Integer points;
    private Integer activityScore;
    private Integer activityLevel;
    private String activityTitle;

    /** 该用户所有可见帖子获得的点赞总数 */
    private Integer likeReceivedCount;

    /** 当前访客是否已关注该用户（未登录为 null/false） */
    private Boolean isFollowed;

    /** 角色 code 列表：["USER","MODERATOR","ADMIN"] */
    private List<String> roles;
    /** 身份徽章：ADMIN/MODERATOR/SUB_MODERATOR/null（与 BadgeService.compute 一致） */
    private String badge;
    /** 该用户负责的板块 id 列表（仅 MODERATOR/ADMIN 有，普通用户为空） */
    private List<Long> moderatorBoardIds;
    /** 该用户负责的板块名列表（前端展示用） */
    private List<String> moderatorBoardNames;
    /**
     * 该用户负责的游戏名列表（去重 + 按热度/sort 排序）。
     * 用于个人主页徽章展示：「版主 · 三角洲行动」之类。无负责游戏时为空列表。
     */
    private List<String> moderatorGameNames;

    /** 该用户最近帖子 */
    private List<PostVO> posts;
}
