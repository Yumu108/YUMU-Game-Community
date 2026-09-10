package com.yumu.community.security;

import com.yumu.community.common.BusinessException;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * C1：内容风控 —— 敏感词（违禁词）+ 站外联系方式（微信/QQ/群号）识别。
 *
 * 策略：
 *  - 违禁词：发帖 / 编辑 / 回复一律拦截（400），提示用户修改；
 *  - 站外联系方式：帖子强制转人工审核（即使 ADMIN 直发也不放行），回复直接拦截——
 *    组队大厅是广告 / 诈骗重灾区，引流内容必须经人审再曝光。
 *
 * 词库：classpath:sensitive-words.txt（一行一词，# 开头为注释），可随时追加而无需改代码。
 */
@Slf4j
@Service
public class ContentRiskService {

    /** 违禁词库（启动时加载，小写比较）。 */
    private final List<String> bannedWords = new ArrayList<>();

    /** 站外联系方式识别规则：关键词 + 账号形态，避免把普通数字误判为 QQ 号。 */
    private static final List<Pattern> CONTACT_PATTERNS = List.of(
            // 微信 / 加V / VX / 威信 / weixin + 5~20 位账号
            Pattern.compile("(?:微信|加微|加\\s*v|加v|vx|wx号|威信|weixin)\\s*[号码:：#\\s]{0,4}[a-zA-Z][a-zA-Z0-9_-]{4,19}", Pattern.CASE_INSENSITIVE),
            Pattern.compile("(?:微信|加微|vx|wx|威信|weixin)\\s*[号码:：#\\s]{0,4}[0-9]{5,18}", Pattern.CASE_INSENSITIVE),
            // QQ / 扣扣 / 企鹅 + 5~12 位数字
            Pattern.compile("(?:qq|扣扣|叩叩|企鹅)\\s*[号群:：#\\s]{0,4}[0-9]{5,12}", Pattern.CASE_INSENSITIVE),
            // 交流群 / 裙 / 群号 + 6~12 位数字
            Pattern.compile("(?:群号|裙号|交流[群裙]|开车[群裙])\\s*[:：#\\s]{0,3}[0-9]{6,12}"),
            // 「联系 + 7~12 位数字」（手机号形态）
            Pattern.compile("(?:联系电话?|电话号码|手机号)\\s*[:：#\\s]{0,3}1[0-9]{10}")
    );

    @PostConstruct
    public void load() {
        bannedWords.clear();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new ClassPathResource("sensitive-words.txt").getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String w = line.trim().toLowerCase();
                if (w.isEmpty() || w.startsWith("#")) continue;
                bannedWords.add(w);
            }
            log.info("[ContentRisk] 敏感词库加载完成：{} 个词", bannedWords.size());
        } catch (Exception e) {
            // 词库缺失不阻断启动，但风控退化为仅联系方式识别——必须告警
            log.error("[ContentRisk] 敏感词库加载失败，违禁词拦截暂不可用：{}", e.getMessage());
        }
    }

    /**
     * 违禁词硬拦截：命中直接 400。
     * 扫描文本会先做「去空白 + 转小写」归一化，防"赌 博"这类空格绕过。
     */
    public void assertNoBannedWord(String... texts) {
        if (bannedWords.isEmpty()) return;
        for (String raw : texts) {
            if (raw == null || raw.isBlank()) continue;
            String normalized = raw.toLowerCase().replaceAll("[\\s\\p{Punct}·*_-]+", "");
            for (String word : bannedWords) {
                if (normalized.contains(word)) {
                    throw new BusinessException(400, "内容包含违禁词（" + mask(word) + "），请修改后再发布");
                }
            }
        }
    }

    /** 是否含站外联系方式（微信/QQ/群号/手机号形态）。 */
    public boolean hasContactInfo(String... texts) {
        for (String raw : texts) {
            if (raw == null || raw.isBlank()) continue;
            for (Pattern p : CONTACT_PATTERNS) {
                Matcher m = p.matcher(raw);
                if (m.find()) return true;
            }
        }
        return false;
    }

    /** 命中词打码（首尾保留，中间星号），避免把完整违禁词回显给前端 / 日志。 */
    private String mask(String word) {
        if (word.length() <= 2) return word.charAt(0) + "*";
        return word.charAt(0) + "*".repeat(word.length() - 2) + word.charAt(word.length() - 1);
    }
}
