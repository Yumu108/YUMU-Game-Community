package com.yumu.community.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 注册请求。
 */
@Data
public class RegisterRequest {

    /**
     * 登录账号。
     * ⚠️ 字符集限制（2026-09-15 补）：此前这里**只有长度校验**，中文、空格、特殊符号都能注册成功；
     * 现收紧为「字母 / 数字 / 下划线」，与 {@code UserServiceImpl#updateUsername} 的既有规则
     * （{@code ^[a-zA-Z0-9_]+$}）保持一致 —— 否则会出现「注册时不能含下划线、注册后却能改成下划线」的矛盾。
     * 登录接口**不做**该限制：老账号与将来的邮箱登录都不该被字符集卡住。
     */
    @NotBlank(message = "用户名不能为空")
    @Size(min = 3, max = 20, message = "用户名长度 3-20")
    @Pattern(regexp = "^[A-Za-z0-9_]+$", message = "账号只能包含字母、数字和下划线")
    private String username;

    @NotBlank(message = "密码不能为空")
    @Size(min = 6, max = 32, message = "密码长度 6-32")
    private String password;

    /**
     * 注册邮箱。9-15 起**必填**（此前是可选的裸字段、连格式都不校验）。
     *
     * <p>为什么改成必填：邮箱是「忘记密码」唯一可自助的通道 —— 注册时不填，之后密码忘了
     * 就只能找管理员。所以把「邮箱 + 验证码」作为注册的前置条件。</p>
     *
     * <p>⚠️ 这里<b>故意不加 {@code @NotBlank}</b>：校验的「必填」判断放在
     * {@code AuthServiceImpl#register} 里做，因为自动化测试通道（{@code MAIL_TEST_CODE}，
     * 仅非生产）下允许不带邮箱 —— 注解式校验会在这之前就把请求打回去，服务层根本没机会判断。
     * 注意 {@code @Email} 对 {@code null} / 空串均放行，所以「不填」不会在这里被拦。</p>
     */
    @Email(message = "邮箱格式不正确")
    @Size(max = 100, message = "邮箱过长")
    private String email;

    /**
     * 邮箱验证码（6 位数字）。与 {@link #email} 一起提交，服务端校验通过才落库。
     *
     * <p>验证码存在 Redis 的 {@code email:code:register:<邮箱>}，有效期 300 秒，
     * <b>一次性消费</b>（校验通过立即删除）。</p>
     *
     * <p>同样故意不加 {@code @NotBlank}（理由见 {@link #email}），但保留格式正则的「空串放行」写法，
     * 让「该填不填」由服务层给出更准确的提示。</p>
     */
    @Pattern(regexp = "^$|^\\d{6}$", message = "邮箱验证码为 6 位数字")
    private String emailCode;

    /** 昵称，可空；为空时后端用账号名兜底。 */
    private String nickname;
}
