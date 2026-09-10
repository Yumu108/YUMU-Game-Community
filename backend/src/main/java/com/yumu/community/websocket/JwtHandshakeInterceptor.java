package com.yumu.community.websocket;

import com.yumu.community.config.JwtUtil;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * WebSocket 握手鉴权：从查询串取 ?token= 校验 JWT，解析出 userId 注入会话属性。
 *
 * 为什么用 query 传 token：浏览器原生 WebSocket API 无法自定义请求头，
 * 因此 token 只能走 URL 查询串（或 Cookie）。这里明确使用 query + 校验，
 * 校验不通过直接拒绝握手（返回 false）。
 *
 * 安全：同时校验用户存在、未逻辑删除、未被封禁——与 JWT 过滤器的封禁即时生效策略一致。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class JwtHandshakeInterceptor implements HandshakeInterceptor {

    private final JwtUtil jwtUtil;
    private final UserMapper userMapper;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)) {
            return false;
        }
        String token = servletRequest.getServletRequest().getParameter("token");
        if (token == null || token.isBlank() || !jwtUtil.validate(token)) {
            log.warn("[WS] 握手拒绝：token 缺失或无效");
            return false;
        }
        Long userId;
        try {
            userId = jwtUtil.getUserId(token);
        } catch (Exception e) {
            log.warn("[WS] 握手拒绝：token 解析失败");
            return false;
        }
        if (userId == null) {
            return false;
        }
        // 用户存在性 + 封禁校验（封禁用户立即断开实时通道）
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeleted() == 1 || (user.getStatus() != null && user.getStatus() == 1)) {
            log.warn("[WS] 握手拒绝：用户不存在或已封禁 userId={}", userId);
            return false;
        }
        attributes.put(NotificationWsHandler.ATTR_USER_ID, userId);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // 无需处理
    }
}
