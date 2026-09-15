package com.yumu.community.service;

import com.yumu.community.mail.EmailScene;

/**
 * 邮箱验证码：下发、校验、一次性消费。
 *
 * <p>验证码存 Redis（{@code email:code:<scene>:<邮箱>}，TTL 默认 300 秒），
 * <b>不落库</b>—— 验证码是一次性短命凭据，没有持久化的必要，也避免留下可被拖库的痕迹。</p>
 */
public interface EmailCodeService {

    /**
     * 生成并下发验证码。
     *
     * <p>内含两道限频：同一邮箱 {@code codeCooldownSeconds} 秒冷却、同一 IP 每小时
     * {@code codeIpPerHour} 次上限（复用现成的滑动窗口限频器）。</p>
     *
     * @throws com.yumu.community.common.BusinessException 429 = 触发限频；500 = 邮件服务不可用
     */
    void send(String rawEmail, EmailScene scene);

    /**
     * 校验验证码；通过后<b>立即消费</b>（同一个码不能用第二次）。
     *
     * <p>连续输错超过 {@code codeMaxFail} 次会作废该码，必须重新获取。</p>
     *
     * @throws com.yumu.community.common.BusinessException 400 = 验证码错误 / 过期 / 次数超限
     */
    void verifyAndConsume(String rawEmail, EmailScene scene, String code);

    /** 邮箱归一化：去空格 + 统一小写（数据库唯一键 utf8mb4_0900_ai_ci 本就不区分大小写，归一化让行为一致）。 */
    String normalize(String rawEmail);

    /**
     * 是否启用「自动化测试通道」—— 非生产环境 且 配置了 {@code MAIL_TEST_CODE}。
     *
     * <p>开启后：① 固定码可作为任意场景的「正确码」（但<b>仍要求已下发过一枚码</b>，
     * 否则一次性消费 / 过期这两条语义会被架空）；② 注册接口允许不带邮箱。
     * 目的是让自动化测试不必真的去收邮件，同时走与生产完全相同的校验路径；
     * <b>prod profile 下恒为 false</b>。</p>
     */
    boolean testChannelEnabled();
}
