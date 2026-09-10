package com.yumu.community.utils;

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
     * 9-07：合并写入——同 (userId, type, targetId, sourceId) 只保留一条，
     * 累计计数写 content「提到了你 (×N)」，is_read 置 0、created_at 刷新。
     *
     * 🚨 查重必须用 selectByMergeKeyIgnoreDeleted（**含软删行**）：软删行虽然查询不可见，
     * 但 uk_noti_merge 唯一键照样生效，漏查就会 Duplicate entry → 500。
     * 写入统一走 mapper 的原子 upsert（ON DUPLICATE KEY UPDATE），命中软删行时自动复活。
     */
    private void upsertMentionNotification(Long userId, Long postId, int targetType,
                                           Long sourceId, Long actorId) {
        Notification existing = notificationMapper.selectByMergeKeyIgnoreDeleted(
                userId, TYPE_MENTION, postId, sourceId);
        int prev = 0;
        if (existing != null && (existing.getDeleted() == null || existing.getDeleted() == 0)) {
            Matcher m = COUNT_IN_CONTENT.matcher(existing.getContent() == null ? "" : existing.getContent());
            if (m.find()) {
                try { prev = Integer.parseInt(m.group(1)); } catch (NumberFormatException ignore) {}
            } else if (existing.getContent() != null && !existing.getContent().isBlank()) {
                prev = 1;   // 首次提及写的是「提到了你」（不含计数）
            }
        }
        int next = prev + 1;
        String content = next > 1 ? CONTENT_TPL + " (×" + next + ")" : CONTENT_TPL;

        Notification n = new Notification();
        n.setUserId(userId);
        n.setType(TYPE_MENTION);
        n.setSenderId(actorId);
        n.setTargetType(targetType);
        n.setTargetId(postId);
        n.setSourceId(sourceId);
        n.setContent(content);
        notificationMapper.upsertByMergeKey(n);   // 回填 n.id（含命中已存在行的情况）
        pushService.pushNotification(userId, n.getId(), TYPE_MENTION, content, actorId, postId);
    }
}