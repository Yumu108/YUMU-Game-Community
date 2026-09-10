package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.vo.FollowUserVO;

import java.util.Map;

/**
 * 关注业务：目前仅支持关注用户（follow_type = 1）。
 */
public interface FollowService {

    /** 切换关注/取关某用户，返回当前是否已关注 */
    boolean toggleFollow(Long userId, Long targetUserId);

    /** 当前用户是否关注了目标用户 */
    boolean isFollowing(Long userId, Long targetUserId);

    /** 我关注的用户列表（分页） */
    PageResult<FollowUserVO> listFollowing(Long userId, long current, long size);

    /**
     * 我的粉丝列表（分页）。
     * viewerId 为当前登录用户 id，用于计算是否已回关每个粉丝；传 null 则全部未关注。
     */
    PageResult<FollowUserVO> listFollowers(Long userId, Long viewerId, long current, long size);

    /** 关注数 / 粉丝数 */
    Map<String, Long> getCounts(Long userId);
}
