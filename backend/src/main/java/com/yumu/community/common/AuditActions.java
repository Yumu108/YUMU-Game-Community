package com.yumu.community.common;

import java.util.List;
import java.util.Map;

/**
 * 审计动作码的唯一定义处 + 中文标签映射。
 *
 * 为什么不用散落的字符串字面量：动作码既要写进数据库、又要在后台界面展示，
 * 一旦两处拼写不一致就会出现「日志有记录但筛选不到 / 界面显示英文码」的隐性 bug。
 * 统一在这里定义常量与标签，调用方引用常量（编译期防拼错），展示层用 {@link #label(String)}。
 */
public final class AuditActions {

    private AuditActions() {}

    // ---------- 帖子 ----------
    public static final String POST_PIN = "POST_PIN";
    public static final String POST_UNPIN = "POST_UNPIN";
    public static final String POST_ESSENCE = "POST_ESSENCE";
    public static final String POST_UNESSENCE = "POST_UNESSENCE";
    public static final String POST_HIDE = "POST_HIDE";
    public static final String POST_RESTORE = "POST_RESTORE";
    public static final String POST_APPROVE = "POST_APPROVE";
    public static final String POST_PENDING = "POST_PENDING";
    public static final String POST_REJECT = "POST_REJECT";
    public static final String POST_DELETE = "POST_DELETE";

    // ---------- 回复 ----------
    public static final String REPLY_HIDE = "REPLY_HIDE";
    public static final String REPLY_RESTORE = "REPLY_RESTORE";

    // ---------- 举报 ----------
    public static final String REPORT_HANDLE = "REPORT_HANDLE";

    // ---------- 用户 ----------
    public static final String USER_ROLE_UPDATE = "USER_ROLE_UPDATE";
    public static final String USER_BAN = "USER_BAN";
    public static final String USER_UNBAN = "USER_UNBAN";
    public static final String USER_DELETE = "USER_DELETE";
    public static final String USER_PASSWORD_RESET = "USER_PASSWORD_RESET";
    public static final String MODERATOR_ASSIGN = "MODERATOR_ASSIGN";

    // ---------- 公告 ----------
    public static final String ANNOUNCEMENT_CREATE = "ANNOUNCEMENT_CREATE";
    public static final String ANNOUNCEMENT_UPDATE = "ANNOUNCEMENT_UPDATE";
    public static final String ANNOUNCEMENT_DELETE = "ANNOUNCEMENT_DELETE";
    public static final String ANNOUNCEMENT_PIN = "ANNOUNCEMENT_PIN";

    // ---------- 游戏 ----------
    public static final String GAME_CREATE = "GAME_CREATE";
    public static final String GAME_UPDATE = "GAME_UPDATE";
    public static final String GAME_DELETE = "GAME_DELETE";
    public static final String GAME_STATUS = "GAME_STATUS";

    // ---------- 对象类型 ----------
    public static final String TARGET_POST = "POST";
    public static final String TARGET_REPLY = "REPLY";
    public static final String TARGET_USER = "USER";
    public static final String TARGET_REPORT = "REPORT";
    public static final String TARGET_ANNOUNCEMENT = "ANNOUNCEMENT";
    public static final String TARGET_GAME = "GAME";

    private static final Map<String, String> LABELS = Map.ofEntries(
            Map.entry(POST_PIN, "帖子置顶"),
            Map.entry(POST_UNPIN, "取消置顶"),
            Map.entry(POST_ESSENCE, "帖子加精"),
            Map.entry(POST_UNESSENCE, "取消加精"),
            Map.entry(POST_HIDE, "隐藏帖子"),
            Map.entry(POST_RESTORE, "恢复帖子"),
            Map.entry(POST_APPROVE, "审核通过"),
            Map.entry(POST_PENDING, "转待审核"),
            Map.entry(POST_REJECT, "驳回帖子"),
            Map.entry(POST_DELETE, "删除帖子"),
            Map.entry(REPLY_HIDE, "隐藏回复"),
            Map.entry(REPLY_RESTORE, "恢复回复"),
            Map.entry(REPORT_HANDLE, "处理举报"),
            Map.entry(USER_ROLE_UPDATE, "修改用户角色"),
            Map.entry(USER_BAN, "封禁用户"),
            Map.entry(USER_UNBAN, "解封用户"),
            Map.entry(USER_DELETE, "删除用户"),
            Map.entry(USER_PASSWORD_RESET, "重置用户密码"),
            Map.entry(MODERATOR_ASSIGN, "调整版主授权"),
            Map.entry(ANNOUNCEMENT_CREATE, "发布公告"),
            Map.entry(ANNOUNCEMENT_UPDATE, "修改公告"),
            Map.entry(ANNOUNCEMENT_DELETE, "删除公告"),
            Map.entry(ANNOUNCEMENT_PIN, "公告置顶/取消"),
            Map.entry(GAME_CREATE, "新增游戏"),
            Map.entry(GAME_UPDATE, "修改游戏"),
            Map.entry(GAME_DELETE, "删除游戏"),
            Map.entry(GAME_STATUS, "启用/禁用游戏")
    );

    /** 所有动作码（供前端下拉筛选，保证前后端枚举一致）。 */
    public static List<String> all() {
        return LABELS.keySet().stream().sorted().toList();
    }

    /** 中文标签；未登记的码原样返回，便于新增动作码时不至于界面空白。 */
    public static String label(String action) {
        if (action == null) return null;
        return LABELS.getOrDefault(action, action);
    }
}
