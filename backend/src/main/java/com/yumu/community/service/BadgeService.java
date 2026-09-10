package com.yumu.community.service;

import com.yumu.community.entity.User;
import com.yumu.community.vo.UserIdentity;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 计算用户身份徽章（管理员/版主）与活跃度等级。
 * - ADMIN：固定徽章；
 * - MODERATOR：1.2 起统一为「版主」（负责某个 (游戏, 板块) 对，可多名版主共管）；
 * - 普通用户：徽章为 null。
 *
 * 活跃度等级：
 *   score = 发帖×10 + 回帖×5 + 获赞×2 + 登录天数×3
 *   1=🥉初出茅庐 / 2=⚔️活跃玩家 / 3=🏅资深玩家 / 4=💎社区精英 / 5=🔥传说玩家
 */
@Service
@RequiredArgsConstructor
public class BadgeService {

    public UserIdentity compute(User user, List<String> roles, List<Long> moderatorBoardIds) {
        UserIdentity id = new UserIdentity();

        // ---------- 身份徽章 ----------
        if (roles != null && roles.contains("ADMIN")) {
            id.setBadge("ADMIN");
            id.setBadgeColor("danger");
            id.setBadgeText("管理员");
        } else if (roles != null && roles.contains("MODERATOR")) {
            // 1.2 起不再区分大/小版主，统一标识为「版主」
            id.setBadge("MODERATOR");
            id.setBadgeColor("warning");
            id.setBadgeText("版主");
        } else {
            id.setBadge(null);
            id.setBadgeColor(null);
            id.setBadgeText(null);
        }

        // ---------- 活跃度等级 ----------
        int score = user.getActivityScore() == null ? 0 : user.getActivityScore();
        if (score >= 5000) { id.setLevel(5); id.setLevelTitle("🔥传说玩家"); }
        else if (score >= 2000) { id.setLevel(4); id.setLevelTitle("💎社区精英"); }
        else if (score >= 500)  { id.setLevel(3); id.setLevelTitle("🏅资深玩家"); }
        else if (score >= 100)  { id.setLevel(2); id.setLevelTitle("⚔️活跃玩家"); }
        else { id.setLevel(1); id.setLevelTitle("🥉初出茅庐"); }

        return id;
    }
}