package com.yumu.community.websocket;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * 通知通道 WebSocket 处理器。
 *
 * 握手鉴权在 {@link JwtHandshakeInterceptor} 完成，此处只处理：
 * - 建连：登记会话 + 回发 connected 帧
 * - 断连/异常：注销会话
 * - 收到文本：仅应答心跳（前端发 {"type":"ping"} → 回 {"type":"pong"}），不做业务写操作
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationWsHandler extends TextWebSocketHandler {

    private final WebSocketSessionManager sessionManager;
    private final NotificationPushService pushService;

    /** 握手阶段由拦截器注入的属性名。 */
    public static final String ATTR_USER_ID = "userId";

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        Object uid = session.getAttributes().get(ATTR_USER_ID);
        if (!(uid instanceof Long userId)) {
            // 理论上不会发生（拦截器已校验），兜底直接关闭
            session.close(CloseStatus.NOT_ACCEPTABLE);
            return;
        }
        sessionManager.add(userId, session);
        log.info("[WS] 连接建立 userId={} sessionId={} 在线用户={}", userId, session.getId(), sessionManager.onlineUserCount());
        pushService.pushConnected(userId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // 心跳：前端定期 ping，后端回 pong（保活 + 便于前端探测链路）
        String payload = message.getPayload();
        if (payload != null && payload.contains("\"ping\"")) {
            session.sendMessage(new TextMessage("{\"type\":\"pong\",\"at\":" + System.currentTimeMillis() + "}"));
        }
        // 其余消息忽略：本通道为服务端单向推送，不接受业务写操作（避免越权面）
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Object uid = session.getAttributes().get(ATTR_USER_ID);
        if (uid instanceof Long userId) {
            sessionManager.remove(userId, session);
            log.info("[WS] 连接关闭 userId={} status={} 在线用户={}", userId, status, sessionManager.onlineUserCount());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        Object uid = session.getAttributes().get(ATTR_USER_ID);
        if (uid instanceof Long userId) {
            sessionManager.remove(userId, session);
        }
        log.warn("[WS] 传输异常: {}", exception.getMessage());
    }
}
