package com.yumu.community.utils;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 请求相关工具：获取当前线程绑定的 HttpServletRequest 与客户端 IP。
 * 业务代码（A2 限频 / A3 审计）通过该工具拿到调用方 IP，无需把 HttpServletRequest 一路传到 Service。
 */
public final class RequestUtils {

    private RequestUtils() {}

    /** 当前请求；非 Web 请求上下文返回 null。 */
    public static HttpServletRequest currentRequest() {
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs == null ? null : attrs.getRequest();
    }

    /**
     * 客户端 IP。优先读 X-Forwarded-For 第一项（反代 / Nginx 透传），否则读 remoteAddr。
     * 注意：XFF 可被伪造；上线时建议搭配 Nginx 配置 trusted_proxies，让代理段 IP 才被采纳。
     */
    public static String clientIp() {
        HttpServletRequest req = currentRequest();
        if (req == null) return "unknown";
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            // 形如 "client, proxy1, proxy2"，取第一项
            int comma = xff.indexOf(',');
            return (comma > 0 ? xff.substring(0, comma) : xff).trim();
        }
        String realIp = req.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) return realIp.trim();
        return req.getRemoteAddr() == null ? "unknown" : req.getRemoteAddr();
    }
}