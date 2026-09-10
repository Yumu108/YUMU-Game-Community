package com.yumu.community.utils;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.UserMapper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 提及解析：从文本中提取 @username 标记，并查找对应的用户 ID。
 *
 * 解析规则：
 *   - 匹配形式：@昵称（昵称 = [字母数字下划线短横线 / 中文] 连续 1-20 字符）
 *   - 同一文本中同一昵称只取一次；多个昵称各取一次
 *   - 通过 userMapper 按 nickname 查询；deleted=0
 *   - 找不到的昵称静默跳过（不报错）
 *
 * 注意：本工具只解析纯文本中的 @mention；图片 / 链接 markdown 中的 @ 已被 [..](..) 包裹，
 * 不在正则匹配范围内，无需特别处理。
 */
public final class MentionParser {

    /** @ 后接 1-20 个字符（字母数字下划线短横线，或任意中文）。结尾不能是英文/数字/下划线/短横线（防止误吞邮箱）。 */
    private static final Pattern MENTION = Pattern.compile(
            "@([\\p{L}\\p{N}_\\-]{1,20})(?![\\p{L}\\p{N}_\\-])");

    private MentionParser() {}

    /** 仅解析昵称（去重，按出现顺序），不做数据库查询。 */
    public static List<String> extractNicknames(String text) {
        if (text == null || text.isEmpty()) return Collections.emptyList();
        Matcher m = MENTION.matcher(text);
        Set<String> seen = new LinkedHashSet<>();
        while (m.find()) {
            seen.add(m.group(1));
        }
        return new ArrayList<>(seen);
    }

    /**
     * 解析 @提及，返回去重后的 userId 列表（按 nickname/username 出现顺序）。
     * 找不到的用户（已删除/昵称错）静默跳过；不会因为某条 @ 用户名错而抛错。
     *
     * 9-07：兼容 username 和 nickname（同时按 nickname/username 匹配 OR 命中；同一用户多次匹配会按出现顺序去重）。
     */
    public static List<Long> resolveUserIds(String text, UserMapper userMapper) {
        List<String> nicks = extractNicknames(text);
        if (nicks.isEmpty() || userMapper == null) return Collections.emptyList();
        // 9-07：兼容 username + nickname，OR 命中（大小写不敏感）
        List<User> users = userMapper.selectMentionedByNicknameOrUsername(nicks);
        if (users.isEmpty()) return Collections.emptyList();
        // 同一用户可能既匹配 nickname 又匹配 username，用小写 key 去重
        Map<String, Long> matchedKey = new java.util.LinkedHashMap<>();
        for (User u : users) {
            if (u.getNickname() != null) {
                String k = u.getNickname().toLowerCase();
                matchedKey.putIfAbsent(k, u.getId());
            }
            if (u.getUsername() != null) {
                String k = u.getUsername().toLowerCase();
                matchedKey.putIfAbsent(k, u.getId());
            }
        }
        // 按原文中 @ 出现的顺序解析（同一用户只记一次）
        List<Long> ids = new ArrayList<>();
        Set<Long> seenIds = new LinkedHashSet<>();
        for (String n : nicks) {
            Long id = matchedKey.get(n.toLowerCase());
            if (id != null) seenIds.add(id);
        }
        ids.addAll(seenIds);
        return ids;
    }
}