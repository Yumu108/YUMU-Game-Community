package com.yumu.community.vo;

import lombok.Data;

/**
 * 关注关系中的用户视图（脱敏，不含密码）。
 */
@Data
public class FollowUserVO {

    private Long id;
    private String nickname;
    private String avatar;
    private String bio;

    /** 当前登录用户是否已关注该用户（用于粉丝列表回关/取关切换） */
    private Boolean isFollowing;
}
