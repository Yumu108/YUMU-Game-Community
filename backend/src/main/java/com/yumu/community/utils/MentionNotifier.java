package com.yumu.community.utils;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.entity.Notification;
import com.yumu.community.mapper.NotificationMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.websocket.NotificationPushService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 通知中心：在发帖/回帖时把正文里的 @昵称 解析成用户 ID，
 * 给被 @ 的用户发「@我的」通知（type=6）。
 *
 * - 不会给自己发通知（自 @ 不提醒）
 * - 静默跳过找不到/已删除的用户
 * - 9-07：同 (被@者, 帖子/回复) 多次 @ 自动合并为一条通知，content 累计计数（"提到了你 (×N)"）；
 *       利用 notification 表的 uk_noti_merge 唯一索引 (user_id, type, target_id, source_id)；
 *       实时推送（WS 红点）每条 @ 仍推一次（用户体验上仍是"被提到了"）
 */
@Component
@RequiredArgsConstructor
public class MentionNotifier {

    private final UserMapper userMapper;
    private final NotificationMapper notificationMapper;
    private final NotificationPushService pushService;

    /** notification.type=6 ——「有人@你」（@我的 Tab 数据源） */
    public static final int TYPE_MENTION = 6;
    /** 通知文本模板：初始 / 合并后写库的内容；数字 N 表示累计被 @ 次数 */
    private static final String CONTENT_TPL = "提到了你";
    private static final Pattern COUNT_IN_CONTENT = Pattern.compile("\\(×(\\d+)\\)");

    /**
     * 在帖子/回复创建后调用（解析 content 里的 @昵称）。
     * @param postId     帖子 ID（通知跳转目标，String 以兼容 PathVariable）
     * @param targetType  Notification.target_type：1=帖子 2=回复
     * @param sourceId    跳转锚点（回复 ID），用于通知红点跳转到具体楼层；帖子创建可传 null
     * @param content     内容文本（用于解析 @昵称）
     * @param actorId     发起 @ 的用户 ID（自己不通知）
     */
    public void notify(String postId, int targetType, Long sourceId, String content, Long actorId) {
        List<Long> mentioned = MentionParser.resolveUserIds(content, userMapper);
        if (mentioned.isEmpty()) return;
        Long postIdLong = Long.valueOf(postId);
        for (Long userId : mentioned) {
            if (userId.equals(actorId)) continue;
            upsertMentionNotification(userId, postIdLong, targetType, sourceId, actorId);
        }
    }

    /**
     * 9-07：直接传入 userIds 列表，跳过解析（用于"编辑帖子补发新增 @"等 diff 场景，
     * 避免对老 @ 用户重复发通知 + 走 P0-3 合并自然去重）。
     */
    public void notifyMentionedUsers(String postId, int targetType, Long sourceId,
                                      List<Long> userIds, Long actorId) {
        if (userIds == null || userIds.isEmpty()) return;
        Long postIdLong = Long.valueOf(postId);
        for (Long userId : userIds) {
            if (userId.equals(actorId)) continue;
            upsertMentionNotification(userId, postIdLong, targetType, sourceId, actorId);
        }
    }

    /**
     * 9-07：upsert 实现——同 (userId, type, targetId, sourceId) 合并为一条，
     * 累计计数写 content "提到了你 (×N)"，is_read 置 0、created_at 刷新，sender/target 不动。
     */
    private void upsertMentionNotification(Long userId, Long postId, int targetType,
                                           Long sourceId, Long actorId) {
        // 1) 查重
        QueryWrapper<Notification> qw = new QueryWrapper<Notification>()
                .eq("user_id", userId)
                .eq("type", TYPE_MENTION)
                .eq("target_id", postId)
                .eq("source_id", sourceId)   // sourceId == null → 自动 IS NULL
                .eq("deleted", 0)
                .last("LIMIT 1");
        Notification existing = notificationMapper.selectOne(qw);
        if (existing == null) {
            // 2a) 全新通知
            Notification n = new Notification();
            n.setUserId(userId);
            n.setType(TYPE_MENTION);
            n.setSenderId(actorId);
            n.setTargetType(targetType);
            n.setTargetId(postId);
            n.setSourceId(sourceId);
            n.setContent(CONTENT_TPL);
            n.setIsRead(0);
            notificationMapper.insert(n);
            pushService.pushNotification(userId, n.getId(), TYPE_MENTION,
                    CONTENT_TPL, actorId, postId);
        } else {
            // 2b) 合并：原 content 形如 "提到了你 (×N)"，N +1 后回写
            int prev = 1;
            Matcher m = COUNT_IN_CONTENT.matcher(existing.getContent() == null ? "" : existing.getContent());
            if (m.find()) {
                try { prev = Integer.parseInt(m.group(1)); } catch (NumberFormatException ignore) {}
            }
            int next = prev + 1;
            String newContent = CONTENT_TPL + " (×" + next + ")";
            notificationMapper.update(null, Wrappers.<Notification>lambdaUpdate()
                    .eq(Notification::getId, existing.getId())
                    .set(Notification::getContent, newContent)
                    .set(Notification::getIsRead, 0)
                    .set(Notification::getCreatedAt, java.time.LocalDateTime.now()));
            pushService.pushNotification(userId, existing.getId(), TYPE_MENTION,
                    newContent, actorId, postId);
        }
    }
}