package com.yumu.community.service.impl;

import com.yumu.community.cache.CacheService;
import com.yumu.community.common.BusinessException;
import com.yumu.community.mail.EmailScene;
import com.yumu.community.mail.MailProperties;
import com.yumu.community.mail.MailService;
import com.yumu.community.security.RateLimiter;
import com.yumu.community.service.EmailCodeService;
import com.yumu.community.utils.RequestUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Locale;

/**
 * 邮箱验证码实现（9-15）。
 *
 * <h3>Redis key 设计</h3>
 * <ul>
 *   <li>{@code email:code:<scene>:<邮箱>} —— 验证码本体，TTL = 300s（CacheService）</li>
 *   <li>{@code emailcode:email:<邮箱>} —— 同邮箱发送冷却（RateLimiter 滑动窗口，1 次 / 60s）。
 *       ⚠️ 刻意<b>不带 scene</b>：同一个邮箱不论走注册、找回密码还是换绑，60 秒内总共只能收到一封。
 *       场景化会让「一次连点 + 换场景重试」绕过冷却，把同一地址刷成垃圾邮件目标；
 *       跨场景稍微多等一会儿是无害的代价。</li>
 *   <li>{@code emailcode:ip:<ip>} —— 同 IP 每小时发码上限（默认 10）</li>
 *   <li>{@code emailcode:fail:<scene>:<邮箱>} —— 错误次数（RateLimiter，窗口 = 码的有效期）</li>
 * </ul>
 * 注意两组 key 前缀不同（{@code email:} vs {@code emailcode:}）：前者存值、后者是计数，
 * 且 RateLimiter 内部还会再加 {@code rl:} 前缀，不会互相踩。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailCodeServiceImpl implements EmailCodeService {

    private final CacheService cache;
    private final RateLimiter rateLimiter;
    private final MailService mailService;
    private final MailProperties props;

    /**
     * 当前激活的 profile（逗号分隔）。与 {@link MailService} 里同名字段一个用途：
     * 判断是不是生产环境 —— 万能测试码绝不允许在生产生效。
     */
    @Value("${spring.profiles.active:}")
    private String activeProfiles;

    /** 自动化测试用的万能验证码（{@code MAIL_TEST_CODE}），空 = 未启用。 */
    @Value("${yumu.mail.test-code:}")
    private String testCode;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String CODE_PATTERN = "\\d{6}";

    @Override
    public void send(String rawEmail, EmailScene scene) {
        String email = normalize(rawEmail);

        // ① 同邮箱冷却：窗口内只允许 1 次（防连点刷邮件）
        if (!rateLimiter.tryAcquire("emailcode:email:" + email, 1, props.getCodeCooldownSeconds())) {
            throw new BusinessException(429, "验证码已发送，请 " + props.getCodeCooldownSeconds() + " 秒后再试");
        }
        // ② 同 IP 上限：防止换着邮箱刷（邮件配额是有限的，QQ 个人邮箱每天只有几十封）
        if (!rateLimiter.tryAcquire("emailcode:ip:" + RequestUtils.clientIp(), props.getCodeIpPerHour(), 3600)) {
            throw new BusinessException(429, "当前网络请求验证码过于频繁，请稍后再试");
        }

        String code = randomCode();
        cache.put(codeKey(email, scene), code, Duration.ofSeconds(props.getCodeTtlSeconds()));
        // 换新码就清掉旧码的错误计数，否则上一次的输错会「继承」过来
        cache.delete(failKey(email, scene));

        mailService.sendVerificationCode(email, code, scene);
        log.info("[emailcode] 已下发 scene={}, to={}", scene.code(), MailService.mask(email));
    }

    @Override
    public void verifyAndConsume(String rawEmail, EmailScene scene, String code) {
        String email = normalize(rawEmail);
        if (code == null || !code.trim().matches(CODE_PATTERN)) {
            throw new BusinessException(400, "请输入 6 位数字验证码");
        }
        String input = code.trim();
        String key = codeKey(email, scene);
        String saved = cache.get(key, String.class);

        // 自动化测试通道：输入码等于 MAIL_TEST_CODE 时放行（仅非 prod 生效）。
        // ⚠️ 仍然要求**存在一枚已下发的码**（saved != null）—— 这是刻意的：
        //   若允许「凭万能码凭空通过」，就等于把「一次性消费 / 过期」这两条生产语义
        //   彻底架空，自动化测试再也发现不了这类回归（9-15 实测踩到过：改密接口
        //   用万能码可以无限次重放）。要求码存在后，测试脚本走的就是与生产完全相同的
        //   校验路径，只是「什么码算对」被放宽而已。
        if (testChannelEnabled() && input.equals(testCode.trim()) && saved != null) {
            cache.delete(key);
            cache.delete(failKey(email, scene));
            log.info("[emailcode] 命中测试通道万能码，已放行并消费 scene={}, to={}", scene.code(), MailService.mask(email));
            return;
        }

        if (saved == null) {
            throw new BusinessException(400, "验证码已过期，请重新获取");
        }
        if (!saved.equals(input)) {
            // 用滑动窗口当计数器：窗口内允许 codeMaxFail 次，超出即作废该码
            if (!rateLimiter.tryAcquire(failKey(email, scene), props.getCodeMaxFail(), props.getCodeTtlSeconds())) {
                cache.delete(key);
                log.warn("[emailcode] 错误次数超限，验证码已作废 scene={}, to={}", scene.code(), MailService.mask(email));
                throw new BusinessException(400, "验证码错误次数过多，请重新获取");
            }
            throw new BusinessException(400, "验证码不正确");
        }
        // 一次性消费：校验通过立刻删除，杜绝同一个码重复使用（重放）
        cache.delete(key);
        cache.delete(failKey(email, scene));
    }

    @Override
    public String normalize(String rawEmail) {
        if (!StringUtils.hasText(rawEmail)) {
            throw new BusinessException(400, "邮箱不能为空");
        }
        return rawEmail.trim().toLowerCase(Locale.ROOT);
    }

    @Override
    public boolean testChannelEnabled() {
        // 生产环境恒为 false：profile 里带 prod 就一票否决，改配置也绕不过去
        return !isProd() && testCode != null && !testCode.isBlank();
    }

    private boolean isProd() {
        return activeProfiles != null && activeProfiles.toLowerCase(Locale.ROOT).contains("prod");
    }

    private String codeKey(String email, EmailScene scene) {
        return "email:code:" + scene.code() + ":" + email;
    }

    private String failKey(String email, EmailScene scene) {
        return "emailcode:fail:" + scene.code() + ":" + email;
    }

    private String randomCode() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }
}
