package com.yumu.community.vo;

import lombok.Data;

import java.util.List;

/**
 * 游戏专区页版主视图：含用户基本信息与该游戏下负责的板块名列表。
 */
@Data
public class GameModeratorVO {

    private Long id;
    private String nickname;
    private String avatar;
    private String bio;
    /** 活跃度等级 1-5 */
    private Integer activityLevel;
    /** 活跃度称号（由 Controller 补） */
    private String activityTitle;
    /** 该游戏下的可见帖数（status=0 & deleted=0） */
    private Long postCount;
    /** 后端 GROUP_CONCAT 原始串（Controller 拆成 boards 后置 null，不下发） */
    private String boardNames;
    /** 该游戏下负责的板块名列表（按板块 id 升序） */
    private List<String> boards;
}