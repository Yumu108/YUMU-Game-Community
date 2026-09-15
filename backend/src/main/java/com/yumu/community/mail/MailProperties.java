package com.yumu.community.mail;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 邮件与验证码配置（前缀 {@code yumu.mail}，对应环境变量 {@code MAIL_*}）。
 *
 * <p>密钥（QQ 邮箱 SMTP 授权码）只走环境变量 / {@code .env}，绝不写进仓库 ——
 * 延续项目 B4「密钥外置」的做法。</p>
 */
@Data
@Component
@ConfigurationProperties(prefix = "yumu.mail")
public class MailProperties {

    /**
     * 总开关。默认 false —— 此时**不会**连接任何 SMTP，
     * 验证码只打印到后端日志（本地开发与自动化测试正是靠这个模式）。
     */
    private boolean enabled = false;

    /** SMTP 服务器。QQ 邮箱为 smtp.qq.com。 */
    private String host = "smtp.qq.com";

    /** SMTP 端口。QQ 邮箱 SSL 为 465。 */
    private int port = 465;

    /** 发件邮箱地址。 */
    private String username = "";

    /** SMTP 授权码（**不是**邮箱登录密码）。 */
    private String password = "";

    /** 发件人展示地址；留空则用 username。 */
    private String from = "";

    /** 发件人显示名。 */
    private String fromName = "YUMU 游戏社区";

    /** 是否使用 SSL（465 端口需要）。 */
    private boolean ssl = true;

    /** 验证码有效期（秒）。 */
    private int codeTtlSeconds = 300;

    /** 同一邮箱两次发送之间的最小间隔（秒），防连点。 */
    private int codeCooldownSeconds = 60;

    /** 同一 IP 每小时最多请求多少个验证码（防换邮箱刷）。 */
    private int codeIpPerHour = 10;

    /** 同一验证码最多允许输错几次，超过即作废并需重新获取。 */
    private int codeMaxFail = 5;

    /**
     * 自动化测试用的「万能验证码」。
     *
     * <p>⚠️ <b>只在非生产环境且显式配置时生效</b>。开启后：① 固定码可当作任意场景的「正确码」
     * （<b>但仍要求该场景已下发过一枚码</b>，见 {@code EmailCodeServiceImpl#verifyAndConsume}，
     * 目的是不让万能码架空「一次性消费 / 过期」这两条生产语义）；② 注册接口允许不带邮箱
     * （回到 9-15 之前的旧式注册）。前者让测试脚本不必真去收邮件，后者保护既有的
     * 28 个接口测试脚本（全部走 {@code /auth/register} 且不带邮箱）不必整批重写。</p>
     *
     * <p>prod profile 下该配置被<b>完全忽略</b>，与「生产禁止把验证码写进日志」是同一道护栏。</p>
     */
    private String testCode = "";
}
