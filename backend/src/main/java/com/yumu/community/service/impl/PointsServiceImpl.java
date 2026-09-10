package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.entity.PointsLog;
import com.yumu.community.entity.SignIn;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.PointsLogMapper;
import com.yumu.community.mapper.SignInMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.PointsService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class PointsServiceImpl implements PointsService {

    private final UserMapper userMapper;
    private final PointsLogMapper pointsLogMapper;
    private final SignInMapper signInMapper;

    private static final int SIGN_BASE = 10;
    private static final int SIGN_EXTRA_PER_DAY = 5;
    private static final int SIGN_MAX_EXTRA = 50; // 连续 10 天后封顶

    @Override
    @Transactional
    public void addPoints(Long userId, Integer type, Integer delta, String description, Long relatedId) {
        if (userId == null || delta == null || delta == 0) return;
        User u = userMapper.selectById(userId);
        if (u == null) return;
        int before = u.getPoints() == null ? 0 : u.getPoints();
        int after = before + delta;
        if (after < 0) after = 0;
        // 更新用户积分
        userMapper.update(null, Wrappers.<User>lambdaUpdate()
                .eq(User::getId, userId)
                .set(User::getPoints, after));
        // 写日志
        PointsLog log = new PointsLog();
        log.setUserId(userId);
        log.setType(type);
        log.setDelta(delta);
        log.setBalanceAfter(after);
        log.setDescription(description);
        log.setRelatedId(relatedId);
        pointsLogMapper.insert(log);
    }

    @Override
    @Transactional
    public Map<String, Object> signIn(Long userId) {
        if (userId == null) throw new BusinessException(401, "请先登录");
        LocalDate today = LocalDate.now();
        SignIn todaySign = signInMapper.selectOne(Wrappers.<SignIn>lambdaQuery()
                .eq(SignIn::getUserId, userId)
                .eq(SignIn::getSignDate, today));
        if (todaySign != null) {
            return Map.of(
                    "signed", true,
                    "signedToday", true,
                    "continuousDays", todaySign.getContinuousDays(),
                    "points", todaySign.getPoints(),
                    "totalPoints", getPoints(userId));
        }
        // 计算连续签到天数
        LocalDate yesterday = today.minusDays(1);
        SignIn lastSign = signInMapper.selectOne(Wrappers.<SignIn>lambdaQuery()
                .eq(SignIn::getUserId, userId)
                .eq(SignIn::getSignDate, yesterday));
        int continuous = (lastSign != null) ? (lastSign.getContinuousDays() + 1) : 1;
        int extra = Math.min((continuous - 1) * SIGN_EXTRA_PER_DAY, SIGN_MAX_EXTRA);
        int points = SIGN_BASE + extra;

        SignIn record = new SignIn();
        record.setUserId(userId);
        record.setSignDate(today);
        record.setContinuousDays(continuous);
        record.setPoints(points);
        signInMapper.insert(record);

        addPoints(userId, 1, points, "每日签到奖励", null);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("signed", true);
        m.put("signedToday", true);
        m.put("continuousDays", continuous);
        m.put("points", points);
        m.put("totalPoints", getPoints(userId));
        return m;
    }

    @Override
    public int getPoints(Long userId) {
        if (userId == null) return 0;
        User u = userMapper.selectById(userId);
        return u == null || u.getPoints() == null ? 0 : u.getPoints();
    }

    @Override
    public PageResult<PointsLog> listLogs(Long userId, long current, long size) {
        if (userId == null) return PageResult.of(0, 0, current, size, java.util.List.of());
        Page<PointsLog> page = new Page<>(Math.max(1, current), Math.min(100, Math.max(1, size)));
        pointsLogMapper.selectPage(page, Wrappers.<PointsLog>lambdaQuery()
                .eq(PointsLog::getUserId, userId)
                .orderByDesc(PointsLog::getCreatedAt));
        return PageResult.of(page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(), page.getRecords());
    }

    @Override
    public boolean hasSignedToday(Long userId) {
        if (userId == null) return false;
        return signInMapper.selectCount(Wrappers.<SignIn>lambdaQuery()
                .eq(SignIn::getUserId, userId)
                .eq(SignIn::getSignDate, LocalDate.now())) > 0;
    }
}
