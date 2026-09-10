package com.yumu.community.controller;

import com.yumu.community.cache.CacheService;
import com.yumu.community.common.Result;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 系统信息：暴露缓存运行模式，便于验证 Redis 接入是否生效（无需登录）。
 */
@RestController
@RequestMapping("/system")
@RequiredArgsConstructor
public class SystemController {

    private final CacheService cacheService;

    @GetMapping("/cache-mode")
    public Result<Map<String, Object>> cacheMode() {
        boolean up = cacheService.ping(); // 先探测真实连通性，并同步内部健康状态
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("mode", up ? "redis" : "local");
        m.put("redisAvailable", up);
        return Result.success(m);
    }
}
