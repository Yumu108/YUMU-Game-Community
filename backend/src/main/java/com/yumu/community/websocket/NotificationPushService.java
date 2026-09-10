package com.yumu.community.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 实时推送服务：把「新通知 / 新私信」主动推给在线用户。
 *
 * 设计要点：
 * - 推送是「尽力而为」的旁路：任何异常都静默吞掉，绝不阻断主业务（点赞/回帖/私信本身不能因推送失败而失败）。
 * - 用户不在线则无会话，直接返回（下次进页面由前端主动拉未读数兜底）。
 * - 前端收到 event 后再主动拉一次未读数，避免后端在推送时计算未读数带来的并发一致性问题。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class NotificationPushService {

    private final WebSocketSessionManager sessionManager;
    private final ObjectMapper objectMapper;

    /** 底层：向某用户的全部在线会话广播 JSON 文本。 */
    public void sendToUser(Long userId, Map<String, Object> payload) {
        if (userId == null) return;
        Set<WebSocketSession> sessionSet = sessionManager.get(userId);
        if (sessionSet.isEmpty()) return;
        String json;
        try {
            json = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[WS] 推送序列化失败: {}", e.getMessage());
            return;
        }
        for (WebSocketSession session : sessionSet) {
            if (!session.isOpen()) continue;
            try {
                session.sendMessage(new TextMessage(json));
            } catch (Exception e) {
                // 单会话失败不影响其他会话
                log.warn("[WS] 推送失败 userId={}: {}", userId, e.getMessage());
            }
        }
    }

    /**
     * 新通知推送。
     * notifyType：1 点赞 / 2 评论·回帖 / 3 关注 / 4 系统公告 / 5 审核驳回
     */
    public void pushNotification(Long userId, Long notificationId, Integer notifyType,
                                 String content, Long senderId, Long targetId) {
        if (userId == null) return;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "notification");
        m.put("notificationId", notificationId);
        m.put("notifyType", notifyType);
        m.put("content", content);
        m.put("senderId", senderId);
        m.put("targetId", targetId);
        m.put("at", System.currentTimeMillis());
        sendToUser(userId, m);
    }

    /** 新私信推送。 */
    public void pushMessage(Long toUserId, Long messageId, Long fromUserId,
                            String fromName, String content) {
        if (toUserId == null) return;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "message");
        m.put("messageId", messageId);
        m.put("fromUserId", fromUserId);
        m.put("fromName", fromName);
        m.put("content", content);
        m.put("at", System.currentTimeMillis());
        sendToUser(toUserId, m);
    }

    /** 连接建立后的欢迎帧（含当前在线会话数，便于前端确认链路可用）。 */
    public void pushConnected(Long userId) {
        if (userId == null) return;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", "connected");
        m.put("userId", userId);
        m.put("at", System.currentTimeMillis());
        sendToUser(userId, m);
    }
}
