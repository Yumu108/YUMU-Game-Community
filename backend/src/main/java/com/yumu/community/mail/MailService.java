package com.yumu.community.mail;

import com.yumu.community.common.BusinessException;
import jakarta.annotation.PostConstruct;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Properties;

/**
 * 验证码邮件发送。
 *
 * <p><b>双模式</b>（9-15）：</p>
 * <ul>
 *   <li><b>真实发送</b>：{@code MAIL_ENABLED=true} 且填了 {@code MAIL_USERNAME} + {@code MAIL_PASSWORD}
 *       （QQ 邮箱需用 SMTP <b>授权码</b>，不是登录密码）。</li>
 *   <li><b>日志降级</b>：未启用时验证码直接打印到后端日志 —— 本地开发、自动化测试都靠这个模式跑通全流程，
 *       不需要真的收到邮件。</li>
 * </ul>
 *
 * <p>🚨 <b>安全护栏</b>：日志降级<b>只在非生产环境</b>允许。prod profile 下一旦未配置 SMTP，
 * 发码接口直接报错，绝不让验证码落进服务器日志文件（那等于把验证码公开给任何能看日志的人）。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailService {

    private final MailProperties props;

    /** 当前激活的 profile（逗号分隔），用于区分「本机开发」与「生产」。 */
    @Value("${spring.profiles.active:}")
    private String activeProfiles;

    /** null 表示未启用真实发送（走日志降级）。 */
    private JavaMailSenderImpl sender;

    @PostConstruct
    void init() {
        if (!props.isEnabled()) {
            if (isProd()) {
                log.error("[mail] ⚠️ 生产环境未启用 SMTP（MAIL_ENABLED 未设为 true）："
                        + "邮箱验证码功能将不可用，发码接口会直接返回错误。"
                        + "请配置 MAIL_ENABLED / MAIL_USERNAME / MAIL_PASSWORD 后重启。");
            } else {
                log.warn("[mail] 未启用 SMTP —— 验证码不会真的发出，只打印在本日志里（本地开发模式）。");
            }
            return;
        }
        if (!StringUtils.hasText(props.getUsername()) || !StringUtils.hasText(props.getPassword())) {
            log.warn("[mail] MAIL_ENABLED=true 但缺少 MAIL_USERNAME / MAIL_PASSWORD（QQ 邮箱需 SMTP 授权码），按未启用处理。");
            return;
        }
        JavaMailSenderImpl s = new JavaMailSenderImpl();
        s.setHost(props.getHost());
        s.setPort(props.getPort());
        s.setUsername(props.getUsername());
        s.setPassword(props.getPassword());
        s.setDefaultEncoding("UTF-8");
        s.setProtocol("smtp");
        Properties p = s.getJavaMailProperties();
        p.put("mail.smtp.auth", "true");
        p.put("mail.smtp.timeout", "10000");
        p.put("mail.smtp.connectiontimeout", "10000");
        p.put("mail.smtp.writetimeout", "10000");
        if (props.isSsl()) {
            p.put("mail.smtp.ssl.enable", "true");
            p.put("mail.smtp.socketFactory.class", "javax.net.ssl.SSLSocketFactory");
            p.put("mail.smtp.socketFactory.fallback", "false");
        }
        this.sender = s;
        log.info("[mail] SMTP 已启用：host={}, port={}, ssl={}, from={}",
                props.getHost(), props.getPort(), props.isSsl(), fromAddress());
    }

    /** 当前是否真实发送邮件（false = 日志降级）。 */
    public boolean isRealSend() {
        return sender != null;
    }

    /**
     * 发送验证码邮件。
     *
     * @return true = 真的发出去了；false = 降级到日志（仅供本地开发/测试使用）
     */
    public boolean sendVerificationCode(String to, String code, EmailScene scene) {
        if (sender == null) {
            if (isProd()) {
                // 生产环境绝不把验证码写进日志
                log.error("[mail] 拒绝降级发码：生产环境未配置 SMTP，to={}, scene={}", mask(to), scene.code());
                throw new BusinessException(500, "邮箱服务尚未配置，请联系管理员");
            }
            log.warn("""

                    [mail-mock] SMTP 未启用，验证码只打印在日志里（本地开发 / 自动化测试模式）
                                收件人 : {}
                                场景   : {}
                                验证码 : {}   （{} 秒内有效）
                    """, mask(to), scene.label(), code, props.getCodeTtlSeconds());
            return false;
        }
        try {
            MimeMessage msg = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, false, "UTF-8");
            helper.setFrom(new InternetAddress(fromAddress(), props.getFromName(), "UTF-8"));
            helper.setTo(to);
            helper.setSubject("【YUMU 游戏社区】邮箱验证码：" + code);
            helper.setText(buildHtml(code, scene.label()), true);
            sender.send(msg);
            log.info("[mail] 验证码已发送 to={}, scene={}", mask(to), scene.code());
            return true;
        } catch (Exception e) {
            log.error("[mail] 验证码发送失败 to={}, scene={}, err={}", mask(to), scene.code(), e.getMessage());
            throw new BusinessException(500, "验证码邮件发送失败，请稍后重试");
        }
    }

    /** 发件人地址：MAIL_FROM 优先，留空则用发件邮箱本身。 */
    private String fromAddress() {
        return StringUtils.hasText(props.getFrom()) ? props.getFrom() : props.getUsername();
    }

    private boolean isProd() {
        return activeProfiles != null && activeProfiles.toLowerCase().contains("prod");
    }

    /**
     * 邮箱脱敏，用于日志与前端展示：{@code yumu@qq.com → yu***@qq.com}。
     *
     * <p>🚨 日志里一律用脱敏后的形式，避免把用户真实邮箱写进落盘的日志文件。</p>
     */
    public static String mask(String email) {
        if (email == null || email.isBlank()) {
            return "—";
        }
        int at = email.indexOf('@');
        if (at <= 0) {
            return email.length() <= 2 ? "***" : email.substring(0, 2) + "***";
        }
        String local = email.substring(0, at);
        String domain = email.substring(at);
        String head = local.length() <= 2 ? local.substring(0, Math.min(1, local.length())) : local.substring(0, 2);
        return head + "***" + domain;
    }

    /** 邮件正文（内联样式的 HTML —— 邮件客户端对外链 CSS 支持极差，只能用内联）。 */
    private String buildHtml(String code, String label) {
        return """
                <div style="max-width:520px;margin:0 auto;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;">
                  <div style="background:linear-gradient(135deg,#7c5cff,#19e3c2);padding:18px 22px;border-radius:12px 12px 0 0;">
                    <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.5px;">YUMU 游戏社区</span>
                  </div>
                  <div style="background:#ffffff;border:1px solid #e8eaef;border-top:0;padding:22px;border-radius:0 0 12px 12px;color:#3a3e4a;font-size:14px;line-height:1.8;">
                    <p style="margin:0 0 14px;">你好！</p>
                    <p style="margin:0 0 4px;">你正在<b>__LABEL__</b>，验证码是：</p>
                    <div style="margin:18px 0;text-align:center;">
                      <span style="display:inline-block;padding:12px 26px;background:#f0edff;border:1px dashed #b8a6ff;border-radius:10px;color:#5b3fd6;font-family:Consolas,Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:7px;">__CODE__</span>
                    </div>
                    <p style="margin:0 0 6px;">验证码 <b>__MINUTES__ 分钟</b>内有效，请勿转告他人。</p>
                    <p style="margin:0;color:#8b90a0;font-size:12.5px;">若非本人操作，忽略本邮件即可，你的账号不会受影响。</p>
                  </div>
                  <p style="text-align:center;color:#8b90a0;font-size:11.5px;margin-top:14px;">
                    本邮件由 YUMU 游戏社区自动发送，请勿回复。<br>YUMU 游戏社区 · 年轻人的热门游戏讨论站
                  </p>
                </div>
                """
                .replace("__LABEL__", label)
                .replace("__CODE__", code)
                .replace("__MINUTES__", String.valueOf(Math.max(1, props.getCodeTtlSeconds() / 60)));
    }
}
