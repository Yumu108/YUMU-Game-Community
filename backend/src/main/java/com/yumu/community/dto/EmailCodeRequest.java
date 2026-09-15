package com.yumu.community.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 请求邮箱验证码（9-15）。
 *
 * <p>只服务<b>免登录</b>的两个场景：{@code register}（注册）、{@code reset}（忘记密码）。
 * 换绑邮箱需要的 {@code bind} / {@code unbind} 走需登录的 {@code /user/email/code} ——
 * 否则任何人都能给任意邮箱发「绑定」验证码。</p>
 */
@Data
public class EmailCodeRequest {

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    @Size(max = 100, message = "邮箱过长")
    private String email;

    /** 场景：register / reset。 */
    @NotBlank(message = "场景不能为空")
    private String scene;
}
