package com.yumu.community.security;

import com.yumu.community.cache.CacheService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A2：通用滑动窗口限频器。
 *
 *  - 默认走 Redis 滑动窗口（Lua 脚本原子：清理过期 + 计数 + 写入），多实例一致；
 *  - Redis 不可用时回退进程内 ConcurrentHashMap（单实例足够，多实例会放水但不会彻底失效）；
 *  - 业务侧统一入口 {@link #tryAcquire(String, int, int)}：key + 限额 + 窗口秒。
 *
 * 用法（业务代码示例）：
 *   if (!rateLimiter.tryAcquire("login:ip:" + ip, 10, 60)) {
 *       throw new BusinessException(429, "登录尝试过于频繁，请稍后再试");
 *   }
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RateLimiter {

    private final CacheService cache;
    private final StringRedisTemplate redisTemplate;

    /** 总开关；yumu.security.rate-limit.enabled=false 时所有限频直接放行（仅本地调试用）。 */
    @Value("${yumu.security.rate-limit.enabled:true}")
    private boolean enabled;

    /**
     * 滑动窗口 Lua：原子地清理过期元素 + 计数 + 写入；
     * 返回当前窗口内的命中次数（含本次）。
     */
    private static final String SLIDING_WINDOW_LUA =
            "local key = KEYS[1]\n" +
            "local now = tonumber(ARGV[1])\n" +
            "local windowMs = tonumber(ARGV[2])\n" +
            "local limit = tonumber(ARGV[3])\n" +
            "local member = ARGV[4]\n" +
            "redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)\n" +
            "local count = redis.call('ZCARD', key)\n" +
            "if count >= limit then\n" +
            "  return count\n" +
            "end\n" +
            "redis.call('ZADD', key, now, member)\n" +
            "redis.call('PEXPIRE', key, windowMs)\n" +
            "return count + 1";

    private final DefaultRedisScript<Long> slidingWindowScript =
            new DefaultRedisScript<>(SLIDING_WINDOW_LUA, Long.class);

    /**
     * 申请一次配额；未超限 true，超限 false。
     *
     * @param key         限频维度（如 "login:ip:1.2.3.4" / "post:user:42"）
     * @param maxRequests 窗口内允许的最大次数
     * @param windowSec   窗口秒数
     */
    public boolean tryAcquire(String key, int maxRequests, int windowSec) {
        if (!enabled) return true;
        if (key == null || key.isBlank()) return true;
        boolean redisUp = false;
        try { redisUp = cache.isRedis(); } catch (Exception ignored) {}
        if (redisUp) {
            try {
                return tryAcquireRedis(key, maxRequests, windowSec);
            } catch (Exception e) {
                log.warn("rate-limit redis fail, fallback to local: key={}, err={}", key, e.getMessage());
                return tryAcquireLocal(key, maxRequests, windowSec);
            }
        }
        if (log.isDebugEnabled()) log.debug("rate-limit local: key={}, max={}, win={}", key, maxRequests, windowSec);
        return tryAcquireLocal(key, maxRequests, windowSec);
    }

    /** Redis 版滑动窗口。返回 true 表示「本次未超限」。 */
    private boolean tryAcquireRedis(String key, int maxRequests, int windowSec) {
        String redisKey = "rl:" + key;
        long now = System.currentTimeMillis();
        long windowMs = windowSec * 1000L;
        // member 加随机数避免同毫秒成员冲突（ZADD 同 member 会更新 score 而非新增）
        String member = now + ":" + Thread.currentThread().getId() + ":" + Math.random();
        Long count = redisTemplate.execute(
                slidingWindowScript,
                List.of(redisKey),
                String.valueOf(now),
                String.valueOf(windowMs),
                String.valueOf(maxRequests),
                member);
        return count != null && count <= maxRequests;
    }

    /** ---------------- 本地兜底 ----------------
     *  static 字段防御性兜底：Spring 即使意外创建了多个 RateLimiter 实例，
     *  进程内的限频计数仍能共享；与 CacheService 一样的"进程级"语义。 */
    private static final ConcurrentHashMap<String, Window> localWindows = new ConcurrentHashMap<>();
    private static final long LOCAL_GC_INTERVAL_MS = 60_000L;
    private static final AtomicLong lastLocalGc = new AtomicLong(0);

    private boolean tryAcquireLocal(String key, int maxRequests, int windowSec) {
        long now = System.currentTimeMillis();
        long windowMs = windowSec * 1000L;
        Window w = localWindows.computeIfAbsent(key, k -> new Window());
        synchronized (w) {
            // 清理窗口外的
            while (!w.timestamps.isEmpty() && now - w.timestamps.peekFirst() > windowMs) {
                w.timestamps.pollFirst();
            }
            if (w.timestamps.size() >= maxRequests) {
                log.debug("rate-limit BLOCKED: key={}, cur={}, max={}", key, w.timestamps.size(), maxRequests);
                return false;
            }
            w.timestamps.addLast(now);
            // 周期性 GC 防止内存膨胀
            if (now - lastLocalGc.get() > LOCAL_GC_INTERVAL_MS) {
                lastLocalGc.set(now);
                long cutoff = now;
                localWindows.entrySet().removeIf(en -> {
                    Window win = en.getValue();
                    synchronized (win) {
                        while (!win.timestamps.isEmpty() && cutoff - win.timestamps.peekFirst() > windowMs) {
                            win.timestamps.pollFirst();
                        }
                        return win.timestamps.isEmpty();
                    }
                });
            }
            return true;
        }
    }

    private static final class Window {
        final ArrayDeque<Long> timestamps = new ArrayDeque<>();
    }
}