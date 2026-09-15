package com.yumu.community.dto;

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

    private String nickname;

    private String email;
}
