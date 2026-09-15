package com.yumu.community.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 用户自助「忘记密码」→ 用邮箱验证码重置密码（9-15）。
 *
 * <p>⚠️ 注意与本包下的 {@link ResetPasswordRequest} 区分：那个是<b>后台管理员</b>
 * 重置指定用户密码用的（只需 newPassword）；本类走的是<b>用户自助</b>通道，
 * 必须同时提供邮箱 + 验证码才能改密。</p>
 *
 * <p>本接口不返回任何账号信息、也不自动登录 —— 重置完必须自己用新密码登一次，
 * 避免「拿到邮箱验证码就等于拿到登录态」。</p>
 */
@Data
public class PasswordResetRequest {

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    @Size(max = 100, message = "邮箱过长")
    private String email;

    @NotBlank(message = "邮箱验证码不能为空")
    @Pattern(regexp = "^\\d{6}$", message = "邮箱验证码为 6 位数字")
    private String emailCode;

    @NotBlank(message = "新密码不能为空")
    @Size(min = 6, max = 32, message = "密码长度 6-32")
    private String newPassword;
}
