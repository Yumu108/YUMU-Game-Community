package com.yumu.community.controller;

import com.yumu.community.cache.CacheService;
import com.yumu.community.common.Result;
import com.yumu.community.entity.Notification;
import com.yumu.community.mapper.NotificationMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.PostService;
import com.yumu.community.vo.ActiveUserVO;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;

@RestController
@RequestMapping("/stats")
@RequiredArgsConstructor
public class StatsController {

    private final PostService postService;
    private final UserMapper userMapper;
    private final NotificationMapper notificationMapper;
    private final CacheService cache;

    /** 热门帖：按 (回复数*2 + 点赞数) 降序。结果缓存 60s（热点数据，Redis 不可用时回退进程内缓存）。 */
    @GetMapping("/hot-posts")
    public Result<List<PostVO>> hotPosts(@RequestParam(defaultValue = "8") int limit) {
        String key = "stats:hot:" + limit;
        List<PostVO> cached = cache.getList(key, PostVO.class);
        if (cached != null) return Result.success(cached);
        List<PostVO> list = postService.listHotPosts(limit);
        cache.put(key, list, Duration.ofSeconds(60));
        return Result.success(list);
    }

    /** 活跃用户：按发帖数降序。变化较慢，缓存 5min。 */
    @GetMapping("/active-users")
    public Result<List<ActiveUserVO>> activeUsers(@RequestParam(defaultValue = "8") int limit) {
        String key = "stats:active:" + limit;
        List<ActiveUserVO> cached = cache.getList(key, ActiveUserVO.class);
        if (cached != null) return Result.success(cached);
        List<ActiveUserVO> list = userMapper.selectActiveUsers(limit);
        // 按 activityLevel 补 title（VO 只持 level，便于缓存兼容）
        for (ActiveUserVO u : list) {
            if (u.getActivityLevel() == null) u.setActivityLevel(1);
            u.setActivityTitle(levelTitle(u.getActivityLevel()));
        }
        cache.put(key, list, Duration.ofMinutes(5));
        return Result.success(list);
    }

    private static String levelTitle(int level) {
        return switch (level) {
            case 5 -> "🔥传说玩家";
            case 4 -> "💎社区精英";
            case 3 -> "🏅资深玩家";
            case 2 -> "⚔️活跃玩家";
            default -> "🥉初出茅庐";
        };
    }

    /** 系统公告：notification 表中 type=4 的最近若干条。变化很少，缓存 10min。 */
    @GetMapping("/announcements")
    public Result<List<Notification>> announcements(@RequestParam(defaultValue = "5") int limit) {
        String key = "stats:announcements:" + limit;
        List<Notification> cached = cache.getList(key, Notification.class);
        if (cached != null) return Result.success(cached);
        List<Notification> list = notificationMapper.selectSystemAnnouncements(limit);
        cache.put(key, list, Duration.ofMinutes(10));
        return Result.success(list);
    }
}
