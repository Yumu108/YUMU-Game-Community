package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.entity.Follow;
import com.yumu.community.entity.Notification;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.FollowMapper;
import com.yumu.community.mapper.NotificationMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.FollowService;
import com.yumu.community.vo.FollowUserVO;
import com.yumu.community.websocket.NotificationPushService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class FollowServiceImpl implements FollowService {

    private final FollowMapper followMapper;
    private final UserMapper userMapper;
    private final NotificationMapper notificationMapper;
    private final NotificationPushService pushService;

    /** 关注类型：1=用户（原型期仅实现用户关注） */
    private static final int TYPE_USER = 1;

    @Override
    @Transactional
    public boolean toggleFollow(Long userId, Long targetUserId) {
        if (userId.equals(targetUserId)) {
            throw new BusinessException(400, "不能关注自己");
        }
        if (userMapper.selectById(targetUserId) == null) {
            throw new BusinessException(404, "用户不存在");
        }
        // 1. 状态判断：只看有效行（deleted=0）
        Long activeCount = followMapper.selectCount(Wrappers.<Follow>lambdaQuery()
                .eq(Follow::getUserId, userId)
                .eq(Follow::getFollowType, TYPE_USER)
                .eq(Follow::getFollowId, targetUserId)
                .eq(Follow::getDeleted, 0));
        boolean followed = activeCount != null && activeCount > 0;
        // 2. 防御性物理清理：无论状态先清掉所有相关行（含僵尸数据），避免 uk_user_target 唯一键冲突
        followMapper.physicalDeleteByTarget(userId, TYPE_USER, targetUserId);
        if (followed) {
            // 当前已关注 → 取消
            return false;
        }
        // 当前未关注 → 新增
        Follow f = new Follow();
        f.setUserId(userId);
        f.setFollowType(TYPE_USER);
        f.setFollowId(targetUserId);
        followMapper.insert(f);
        // 给被关注者发一条 type=3 关注通知
        Notification n = new Notification();
        n.setUserId(targetUserId);
        n.setType(3);
        n.setSenderId(userId);
        n.setTargetType(1);
        n.setTargetId(targetUserId);
        n.setContent("关注了你");
        n.setIsRead(0);
        notificationMapper.insert(n);
        pushService.pushNotification(targetUserId, n.getId(), 3, "关注了你", userId, targetUserId);
        return true;
    }

    @Override
    public boolean isFollowing(Long userId, Long targetUserId) {
        return followMapper.selectCount(Wrappers.<Follow>lambdaQuery()
                .eq(Follow::getUserId, userId)
                .eq(Follow::getFollowType, TYPE_USER)
                .eq(Follow::getFollowId, targetUserId)) > 0;
    }

    @Override
    public PageResult<FollowUserVO> listFollowing(Long userId, long current, long size) {
        current = Math.max(1, current);
        size = Math.min(100, Math.max(1, size));
        Page<Follow> page = new Page<>(current, size);
        followMapper.selectPage(page, Wrappers.<Follow>lambdaQuery()
                .eq(Follow::getUserId, userId)
                .eq(Follow::getFollowType, TYPE_USER)
                .orderByDesc(Follow::getCreatedAt));
        List<Long> ids = page.getRecords().stream().map(Follow::getFollowId).toList();
        Map<Long, User> userMap = loadUsers(ids);
        List<FollowUserVO> vos = ids.stream()
                .map(id -> toVO(userMap.get(id)))
                .toList();
        return PageResult.of(page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(), vos);
    }

    @Override
    public PageResult<FollowUserVO> listFollowers(Long userId, Long viewerId, long current, long size) {
        current = Math.max(1, current);
        size = Math.min(100, Math.max(1, size));
        Page<Follow> page = new Page<>(current, size);
        followMapper.selectPage(page, Wrappers.<Follow>lambdaQuery()
                .eq(Follow::getFollowId, userId)
                .eq(Follow::getFollowType, TYPE_USER)
                .orderByDesc(Follow::getCreatedAt));
        List<Long> ids = page.getRecords().stream().map(Follow::getUserId).toList();
        Map<Long, User> userMap = loadUsers(ids);
        // 批量查询 viewer 是否已关注这些粉丝（空 ids 时跳过，避免 MyBatis 生成非法的 IN ()）
        Set<Long> followingIds;
        if (viewerId == null || ids.isEmpty()) {
            followingIds = Set.of();
        } else {
            followingIds = followMapper.selectList(
                            Wrappers.<Follow>lambdaQuery()
                                    .eq(Follow::getUserId, viewerId)
                                    .eq(Follow::getFollowType, TYPE_USER)
                                    .in(Follow::getFollowId, ids))
                    .stream().map(Follow::getFollowId).collect(Collectors.toSet());
        }
        List<FollowUserVO> vos = ids.stream()
                .map(id -> toVO(userMap.get(id), followingIds.contains(id)))
                .toList();
        return PageResult.of(page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(), vos);
    }

    @Override
    public Map<String, Long> getCounts(Long userId) {
        long following = followMapper.selectCount(Wrappers.<Follow>lambdaQuery()
                .eq(Follow::getUserId, userId)
                .eq(Follow::getFollowType, TYPE_USER));
        long followers = followMapper.selectCount(Wrappers.<Follow>lambdaQuery()
                .eq(Follow::getFollowId, userId)
                .eq(Follow::getFollowType, TYPE_USER));
        Map<String, Long> map = new LinkedHashMap<>();
        map.put("following", following);
        map.put("followers", followers);
        return map;
    }

    private Map<Long, User> loadUsers(List<Long> ids) {
        if (ids.isEmpty()) return Map.of();
        return userMapper.selectBatchIds(ids).stream()
                .collect(java.util.stream.Collectors.toMap(User::getId, u -> u, (a, b) -> a));
    }

    private FollowUserVO toVO(User u) {
        return toVO(u, false);
    }

    private FollowUserVO toVO(User u, boolean isFollowing) {
        FollowUserVO vo = new FollowUserVO();
        if (u == null) return vo;
        vo.setId(u.getId());
        vo.setNickname(u.getNickname());
        vo.setAvatar(u.getAvatar());
        vo.setBio(u.getBio());
        vo.setIsFollowing(isFollowing);
        return vo;
    }
}
