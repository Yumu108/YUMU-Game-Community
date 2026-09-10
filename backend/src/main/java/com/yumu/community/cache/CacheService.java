package com.yumu.community.cache;

import java.time.Duration;
import java.util.List;

/**
 * 统一缓存抽象。
 * 实现：
 *  - {@link RedisCacheServiceImpl}（@Primary）：优先用 Redis；连接失败自动回退到 {@link LocalCacheServiceImpl}。
 *  - {@link LocalCacheServiceImpl}：进程内 ConcurrentHashMap 兜底缓存（无 Redis 时也能跑）。
 *
 * 这样无论本机是否有 Redis，应用都能正常启动与运行；Redis 就绪后无需改代码即可启用。
 */
public interface CacheService {

    /** 读取缓存对象；不存在返回 null。 */
    <T> T get(String key, Class<T> type);

    /** 读取缓存中的对象列表；不存在返回 null。 */
    <T> List<T> getList(String key, Class<T> elementType);

    /** 写入缓存，可指定 TTL；ttl 为 null 表示不过期。 */
    void put(String key, Object value, Duration ttl);

    /** 删除指定 key。 */
    void delete(String key);

    /** 按前缀批量删除（用于失效统计类缓存）。 */
    void deleteByPrefix(String prefix);

    /** 当前是否真正使用 Redis（false 表示回退到进程内）。 */
    boolean isRedis();

    /** 探测 Redis 是否可达（true 表示后端真的是 Redis）。 */
    boolean ping();
}
