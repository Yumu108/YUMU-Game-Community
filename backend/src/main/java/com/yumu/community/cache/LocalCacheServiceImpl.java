package com.yumu.community.cache;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 进程内兜底缓存：ConcurrentHashMap + 软过期。无 Redis 时作为唯一缓存实现，
 * 也可被 {@link RedisCacheServiceImpl} 在 Redis 抖动时临时复用。
 */
@Component
public class LocalCacheServiceImpl implements CacheService {

    private static final class Entry {
        final Object value;
        final long expireAt; // 0 表示不过期

        Entry(Object value, long expireAt) {
            this.value = value;
            this.expireAt = expireAt;
        }
    }

    private final Map<String, Entry> map = new ConcurrentHashMap<>();

    private boolean expired(Entry e) {
        return e.expireAt > 0 && e.expireAt < System.currentTimeMillis();
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> type) {
        Entry e = map.get(key);
        if (e == null) return null;
        if (expired(e)) { map.remove(key); return null; }
        return (T) e.value;
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> List<T> getList(String key, Class<T> elementType) {
        Entry e = map.get(key);
        if (e == null) return null;
        if (expired(e)) { map.remove(key); return null; }
        return (List<T>) e.value;
    }

    @Override
    public void put(String key, Object value, Duration ttl) {
        long expireAt = (ttl == null) ? 0 : System.currentTimeMillis() + ttl.toMillis();
        map.put(key, new Entry(value, expireAt));
    }

    @Override
    public void delete(String key) {
        map.remove(key);
    }

    @Override
    public void deleteByPrefix(String prefix) {
        map.keySet().removeIf(k -> k.startsWith(prefix));
    }

    @Override
    public boolean isRedis() {
        return false;
    }

    @Override
    public boolean ping() {
        return false;
    }
}
