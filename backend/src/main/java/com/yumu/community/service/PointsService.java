package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.entity.PointsLog;

import java.util.Map;

public interface PointsService {

    /** 给用户增加积分并写日志（事务内）。 */
    void addPoints(Long userId, Integer type, Integer delta, String description, Long relatedId);

    /** 每日签到：返回 { signed, continuousDays, points, totalPoints }。 */
    Map<String, Object> signIn(Long userId);

    /** 查询用户当前积分余额。 */
    int getPoints(Long userId);

    /** 分页查询用户积分日志。 */
    PageResult<PointsLog> listLogs(Long userId, long current, long size);

    /** 今日是否已签到。 */
    boolean hasSignedToday(Long userId);
}
