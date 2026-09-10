package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.entity.Post;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.service.DailyPickService;
import com.yumu.community.service.PostService;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class DailyPickServiceImpl implements DailyPickService {

    private final PostMapper postMapper;
    private final PostService postService;

    @Override
    public List<PostVO> listPicks(Integer pickType, LocalDate date, Long viewerId) {
        if (pickType == null || date == null) return List.of();

        if (pickType == 1) {
            // 每日精选：人工加精优先 + 综合评分补足，最多 5 条
            return listDailyPicksByScore(date, viewerId);
        }
        if (pickType == 2) {
            // 本周热门：本周一 00:00 起 status=0 的帖子，按 (like + reply*2) 降序取前 5
            LocalDateTime since = date.with(java.time.DayOfWeek.MONDAY).atStartOfDay();
            List<Post> hotPosts = postMapper.selectList(Wrappers.<Post>lambdaQuery()
                    .eq(Post::getStatus, 0)
                    .ge(Post::getCreatedAt, since)
                    .last("ORDER BY (like_count + reply_count * 2) DESC, id DESC LIMIT 5"));
            if (hotPosts.isEmpty()) return List.of();
            return postService.convertToVOList(hotPosts, viewerId);
        }
        return List.of();
    }

    /**
     * 当日精选：人工加精优先 + 综合评分补足。
     * 综合评分公式：view_count * 1 + like_count * 2 + reply_count * 3
     */
    private List<PostVO> listDailyPicksByScore(LocalDate date, Long viewerId) {
        final int PICK_LIMIT = 5;
        LocalDateTime dayStart = date.atStartOfDay();
        LocalDateTime dayEnd = dayStart.plusDays(1);

        // 1) 当天 is_essence=1 的帖子（人工加精，优先级最高）；按 id DESC 保持稳定顺序
        List<Post> essence = postMapper.selectList(Wrappers.<Post>lambdaQuery()
                .eq(Post::getStatus, 0)
                .eq(Post::getIsEssence, 1)
                .ge(Post::getCreatedAt, dayStart)
                .lt(Post::getCreatedAt, dayEnd)
                .orderByDesc(Post::getId));
        // 2) 当天其他 status=0 帖子，按综合评分降序
        List<Post> ranked = postMapper.selectList(Wrappers.<Post>lambdaQuery()
                .eq(Post::getStatus, 0)
                .ne(Post::getIsEssence, 1)
                .ge(Post::getCreatedAt, dayStart)
                .lt(Post::getCreatedAt, dayEnd)
                .last("ORDER BY (view_count + like_count * 2 + reply_count * 3) DESC, id DESC"));

        // 合并：essence 全加（SQL 已按 id DESC），再补 ranked 至上限
        List<Post> merged = new ArrayList<>(PICK_LIMIT);
        for (Post p : essence) {
            if (merged.size() >= PICK_LIMIT) break;
            merged.add(p);
        }
        for (Post p : ranked) {
            if (merged.size() >= PICK_LIMIT) break;
            merged.add(p);
        }
        if (merged.isEmpty()) return List.of();
        return postService.convertToVOList(merged, viewerId);
    }
}