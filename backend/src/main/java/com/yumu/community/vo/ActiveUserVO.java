package com.yumu.community.vo;

import lombok.Data;

/**
 * 活跃用户视图：含发帖数。
 */
@Data
public class ActiveUserVO {

    private Long id;
    private String nickname;
    private String avatar;
    private String bio;
    private Long postCount;
    /** 活跃度等级 1-5 */
    private Integer activityLevel;
    /** 活跃度称号 */
    private String activityTitle;
}
