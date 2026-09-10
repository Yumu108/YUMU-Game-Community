package com.yumu.community.cache;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Redis 缓存实现（@Primary）。
 *
 * 优雅降级策略：
 *  - 默认认为 Redis 健康，优先走 Redis；
 *  - 任意 Redis 操作抛 {@link RedisConnectionFailureException} 时，标记不健康并回退到 LocalCacheServiceImpl；
 *  - 不健康后进入冷却期（COOLDOWN_MS），冷却期内不重试 Redis；冷却结束后自动重新探测，
 *    一旦 Redis 恢复即切回（无需重启）。
 * 这样本机没有 Redis（Docker 未起）时应用照常启动，Redis 就绪后自动启用缓存。
 */
@Service
@Primary
@RequiredArgsConstructor
public class RedisCacheServiceImpl implements CacheService {

    private final StringRedisTemplate redisTemplate;
    private final LocalCacheServiceImpl local;

    // Jackson 3 变化：① java.time 支持已内置（不再有独立 jsr310 模块，无需 registerModule）；
    //               ② ObjectMapper 配置不可变，改配置只能走 JsonMapper.builder()。
    private final ObjectMapper objectMapper = JsonMapper.builder()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .build();

    private final AtomicBoolean redisHealthy = new AtomicBoolean(true);
    private volatile long lastFailAt = 0;
    private static final long COOLDOWN_MS = 30_000;

    private boolean redisOk() {
        if (redisHealthy.get()) return true;
        if (System.currentTimeMillis() - lastFailAt > COOLDOWN_MS) {
            // 冷却结束，尝试重连探测
            try {
                redisTemplate.getConnectionFactory().getConnection().ping();
                redisHealthy.set(true);
            } catch (Exception e) {
                lastFailAt = System.currentTimeMillis();
            }
        }
        return redisHealthy.get();
    }

    private void markDown() {
        redisHealthy.set(false);
        lastFailAt = System.currentTimeMillis();
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> type) {
        if (!redisOk()) return local.get(key, type);
        try {
            String s = redisTemplate.opsForValue().get(key);
            if (s == null) return null;
            return objectMapper.readValue(s, type);
        } catch (RedisConnectionFailureException e) {
            markDown();
            return local.get(key, type);
        } catch (Exception e) {
            return local.get(key, type);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> List<T> getList(String key, Class<T> elementType) {
        if (!redisOk()) return local.getList(key, elementType);
        try {
            String s = redisTemplate.opsForValue().get(key);
            if (s == null) return null;
            return objectMapper.readValue(s,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, elementType));
        } catch (RedisConnectionFailureException e) {
            markDown();
            return local.getList(key, elementType);
        } catch (Exception e) {
            return local.getList(key, elementType);
        }
    }

    @Override
    public void put(String key, Object value, Duration ttl) {
        if (!redisOk()) { local.put(key, value, ttl); return; }
        try {
            String s = objectMapper.writeValueAsString(value);
            if (ttl != null) redisTemplate.opsForValue().set(key, s, ttl);
            else redisTemplate.opsForValue().set(key, s);
        } catch (RedisConnectionFailureException e) {
            markDown();
            local.put(key, value, ttl);
        } catch (Exception e) {
            local.put(key, value, ttl);
        }
    }

    @Override
    public void delete(String key) {
        try {
            redisTemplate.delete(key);
        } catch (RedisConnectionFailureException e) {
            markDown();
        } catch (Exception ignored) {
        }
        local.delete(key);
    }

    @Override
    public void deleteByPrefix(String prefix) {
        try {
            Set<String> keys = redisTemplate.keys(prefix + "*");
            if (keys != null && !keys.isEmpty()) redisTemplate.delete(keys);
        } catch (RedisConnectionFailureException e) {
            markDown();
        } catch (Exception ignored) {
        }
        local.deleteByPrefix(prefix);
    }

    @Override
    public boolean isRedis() {
        return redisHealthy.get();
    }

    @Override
    public boolean ping() {
        try {
            redisTemplate.getConnectionFactory().getConnection().ping();
            redisHealthy.set(true);
            return true;
        } catch (Exception e) {
            markDown();
            return false;
        }
    }
}
