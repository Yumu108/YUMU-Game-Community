package com.yumu.community.security;

import com.yumu.community.cache.CacheService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Date;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A3：JWT 退出黑名单服务。
 *
 * 双层存储（Redis 优先 + 本地内存兜底）：
 *  - Redis 健康：jti 入 Redis，TTL = 剩余有效期；多实例共享，立即生效。
 *  - Redis 不可用：jti 入本进程 ConcurrentHashMap，TTL 到期由读取时懒清理；
 *    单实例足够拦截"用户退出→旧 token 立刻刷自己的接口"这条路径，
 *    多实例部署时需要 Redis 才能 100% 生效（已在 9-09 评估清单里要求）。
 *
 * 入黑名单：
 *  - 用户点「退出登录」 → AuthController 解析 token 的 jti + exp，调用 {@link #blacklist(String, Date)}；
 *  - JwtAuthenticationFilter 解析 token 后调用 {@link #isBlacklisted(String)} 检查 jti 是否在列；
 *    若在列则等同未登录（401），防止旧 token 盗用。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TokenBlacklistService {

    private static final String KEY_PREFIX = "jwt:bl:";

    private final CacheService cache;

    /** 本地兜底黑名单：jti → 过期时间戳（毫秒）。懒清理。
 *  用 static 是为了防御性兜底——Spring 即使因某些情况创建了多个 bean 实例，
 *  也能保证跨实例共享；与业务 bean 的 singleton 无关，纯粹是个进程级黑名单。
 *  退出后旧 token 立刻失效的关键就在这条路径。 */
    private static final Map<String, Long> localBlacklist = new ConcurrentHashMap<>();

    /**
     * 把 jti 写入黑名单，TTL = 剩余有效期（至少 1 秒，最大不超过 24h）。
     */
    public void blacklist(String jti, Date expiration) {
        if (jti == null || jti.isBlank()) return;
        long ttlSec = 3600L; // fallback
        long expireAtMs = 0;
        if (expiration != null) {
            expireAtMs = expiration.getTime();
            long diff = (expireAtMs - System.currentTimeMillis()) / 1000L;
            if (diff > 0) ttlSec = Math.min(diff, 86400L); // 上限 24h
        }
        try {
            cache.put(KEY_PREFIX + jti, "1", Duration.ofSeconds(ttlSec));
        } catch (Exception e) {
            log.warn("blacklist redis put fail, using local only: jti={}, err={}", jti, e.getMessage());
        }
        // 同时写本地兜底（双写，Redis 健康时数据会重叠，但不冲突）
        localBlacklist.put(jti, expireAtMs);
        log.debug("token blacklisted: jti={}, ttlSec={}", jti, ttlSec);
    }

    /** 检查 jti 是否已被加入黑名单。 */
    public boolean isBlacklisted(String jti) {
        if (jti == null || jti.isBlank()) return false;
        long now = System.currentTimeMillis();
        // 1) 本地查（懒清理过期）
        Long localExp = localBlacklist.get(jti);
        if (localExp != null) {
            if (localExp > now) {
                log.debug("isBlacklisted HIT (local): jti={}, exp={}, now={}, localSize={}", jti, localExp, now, localBlacklist.size());
                return true;
            }
            localBlacklist.remove(jti);
        }
        log.debug("isBlacklisted MISS: jti={}, localSize={}", jti, localBlacklist.size());
        // 2) Redis 查
        try {
            if (!cache.isRedis()) return false;
            String v = cache.get(KEY_PREFIX + jti, String.class);
            return v != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** 测试 / 管理用：清空本地黑名单。 */
    public void clearLocal() {
        localBlacklist.clear();
    }

    /** 暴露给运维查看本地黑名单大小。 */
    public int localSize() {
        // 顺手清理过期项，避免 OOM
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, Long>> it = localBlacklist.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Long> e = it.next();
            if (e.getValue() <= now) it.remove();
        }
        return localBlacklist.size();
    }
}