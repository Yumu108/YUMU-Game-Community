package com.yumu.community.websocket;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * WebSocket 配置：注册实时通知通道。
 *
 * 端点：/ws（context-path 为 /api，故前端实际连接 ws://host/api/ws?token=xxx）
 * 鉴权：由 JwtHandshakeInterceptor 在握手阶段校验 ?token=，失败直接拒绝握手。
 * 跨域：放行所有 origin——本通道靠 token 鉴权而非 Cookie，不存在 CSWSH（跨站 WebSocket 劫持）风险；
 *       与 REST 接口的 CORS 白名单策略解耦，便于多端/多端口调试。
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final NotificationWsHandler wsHandler;
    private final JwtHandshakeInterceptor handshakeInterceptor;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(wsHandler, "/ws")
                .addInterceptors(handshakeInterceptor)
                .setAllowedOriginPatterns("*");
    }
}
