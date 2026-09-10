package com.yumu.community.service;

import com.yumu.community.vo.PostVO;

import java.time.LocalDate;
import java.util.List;

/**
 * 每日精选 / 本周热门：均改为系统按规则自动计算（v1.2 起）。
 * - listPicks(1) 当日精选：当天 is_essence=1 的帖子（人工加精，优先级最高）+
 *   按综合评分 view_count*1 + like_count*2 + reply_count*3 降序补足，最多 5 条
 * - listPicks(2) 本周热门：本周一 00:00 起 status=0 的帖子，按 (like + reply*2) 降序取前 5
 *
 * 旧的人工运营位（daily_pick 表 + setPick/removePick/pagePicks）已废弃。
 */
public interface DailyPickService {

    /** 查询某天的精选/热榜帖子（带 PostVO）。 */
    List<PostVO> listPicks(Integer pickType, LocalDate date, Long viewerId);
}