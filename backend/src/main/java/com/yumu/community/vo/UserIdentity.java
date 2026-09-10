package com.yumu.community.vo;

import lombok.Data;

/**
 * 用户身份徽章 + 活跃度等级的轻量汇总。
 * 由 BadgeService 计算并填充到 PostVO / ReplyVO / UserInfoVO 的展开字段。
 */
@Data
public class UserIdentity {

    /** ADMIN / MODERATOR / SUB_MODERATOR / null */
    private String badge;
    /** Element Plus tag type：danger / warning / primary / null */
    private String badgeColor;
    /** 管理员 / 版主 / 子板主 */
    private String badgeText;

    /** 活跃度等级 1-5 */
    private Integer level;
    /** 等级称号：🥉初出茅庐 / ⚔️活跃玩家 / 🏅资深玩家 / 💎社区精英 / 🔥传说玩家 */
    private String levelTitle;
}