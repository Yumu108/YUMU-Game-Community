package com.yumu.community.websocket;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * WebSocket 会话管理：userId → 该用户的全部在线会话（支持同一用户多标签页/多端）。
 * 线程安全：ConcurrentHashMap + CopyOnWriteArraySet。
 */
@Component
public class WebSocketSessionManager {

    private final ConcurrentHashMap<Long, CopyOnWriteArraySet<WebSocketSession>> sessions = new ConcurrentHashMap<>();

    /** 绑定会话到用户。 */
    public void add(Long userId, WebSocketSession session) {
        if (userId == null || session == null) return;
        sessions.computeIfAbsent(userId, k -> new CopyOnWriteArraySet<>()).add(session);
    }

    /** 解绑会话；该用户无会话时清理 map 项，避免内存泄漏。 */
    public void remove(Long userId, WebSocketSession session) {
        if (userId == null || session == null) return;
        CopyOnWriteArraySet<WebSocketSession> set = sessions.get(userId);
        if (set == null) return;
        set.remove(session);
        if (set.isEmpty()) {
            sessions.remove(userId, set);
        }
    }

    /** 取用户全部会话（只读视图；无会话时返回空集）。 */
    public Set<WebSocketSession> get(Long userId) {
        if (userId == null) return Set.of();
        CopyOnWriteArraySet<WebSocketSession> set = sessions.get(userId);
        return set == null ? Set.of() : set;
    }

    /** 在线用户数（按 userId 去重）。 */
    public int onlineUserCount() {
        return sessions.size();
    }

    /** 在线会话总数（含同一用户多端）。 */
    public int onlineSessionCount() {
        return sessions.values().stream().mapToInt(Set::size).sum();
    }
}
