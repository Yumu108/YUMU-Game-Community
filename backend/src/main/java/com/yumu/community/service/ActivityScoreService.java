package com.yumu.community.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 活跃度累计与等级重算服务。
 *
 * 计分规则：
 *   发帖 +10
 *   回帖 +5
 *   被点赞 +2
 *   每日首次登录 +3
 *
 * 等级阈值：100/500/2000/5000 → 2/3/4/5
 *   1 = 🥉初出茅庐（< 100）
 *   2 = ⚔️活跃玩家（100–499）
 *   3 = 🏅资深玩家（500–1999）
 *   4 = 💎社区精英（2000–4999）
 *   5 = 🔥传说玩家（≥ 5000）
 */
@Service
@RequiredArgsConstructor
public class ActivityScoreService {

    private final UserMapper userMapper;

    /** 触发：发布帖子 → +10。 */
    @Transactional
    public void onPostCreated(Long userId) {
        addScore(userId, 10);
    }

    /** 触发：发布回复 → +5。 */
    @Transactional
    public void onReplyCreated(Long userId) {
        addScore(userId, 5);
    }

    /** 触发：被点赞 → +2（被点赞者加分，点赞者不加分）。 */
    @Transactional
    public void onLiked(Long targetUserId) {
        if (targetUserId == null) return;
        addScore(targetUserId, 2);
    }

    /** 触发：每日首次登录 → +3（同一天重复登录不重复加分）。 */
    @Transactional
    public void onDailyLogin(Long userId) {
        if (userId == null) return;
        User u = userMapper.selectById(userId);
        if (u == null) return;
        LocalDate today = LocalDate.now();
        LocalDate lastLogin = u.getLastLoginAt() == null ? null : u.getLastLoginAt().toLocalDate();
        if (lastLogin != null && lastLogin.equals(today)) {
            // 今天已计过活跃度，仅刷新 lastLoginAt 时间戳
            userMapper.update(null, Wrappers.<User>lambdaUpdate()
                    .eq(User::getId, userId).set(User::getLastLoginAt, LocalDateTime.now()));
            return;
        }
        // 新的一天：加分 + 重算 level + 更新 lastLoginAt
        addScore(userId, 3);
        userMapper.update(null, Wrappers.<User>lambdaUpdate()
                .eq(User::getId, userId).set(User::getLastLoginAt, LocalDateTime.now()));
    }

    // ---------------- helper ----------------

    /** 累加 score 并按阈值重算 level，更新 user 表。 */
    private void addScore(Long userId, int delta) {
        if (delta == 0) return;
        User u = userMapper.selectById(userId);
        if (u == null) return;
        int score = (u.getActivityScore() == null ? 0 : u.getActivityScore()) + delta;
        int level = calcLevel(score);
        userMapper.update(null, Wrappers.<User>lambdaUpdate()
                .eq(User::getId, userId)
                .set(User::getActivityScore, score)
                .set(User::getActivityLevel, level));
    }

    /** 按阈值返回等级 1-5。 */
    public static int calcLevel(int score) {
        if (score >= 5000) return 5;
        if (score >= 2000) return 4;
        if (score >= 500) return 3;
        if (score >= 100) return 2;
        return 1;
    }
}