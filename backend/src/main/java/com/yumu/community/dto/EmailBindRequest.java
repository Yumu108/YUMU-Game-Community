package com.yumu.community.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 账号设置 → 绑定 / 更换邮箱（9-15，需登录）。
 *
 * <p><b>只做更换，不做解绑</b>：不允许把邮箱清空成「无邮箱」状态 ——
 * 那会让账号彻底失去自助找回密码的能力。想换就换到另一个邮箱。</p>
 *
 * <p>两种情形：</p>
 * <ul>
 *   <li><b>已绑定邮箱</b>（换绑）：{@code emailCode} 与 {@code oldEmailCode} <b>都必须给</b>，
 *       两个码都校验通过才一次性替换 —— 不做「先解绑再绑定」，避免中间失败让账号裸奔。</li>
 *   <li><b>从未绑定邮箱</b>（85 个老账号首次绑定）：只需 {@code emailCode}。</li>
 * </ul>
 */
@Data
public class EmailBindRequest {

    @NotBlank(message = "新邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    @Size(max = 100, message = "邮箱过长")
    private String email;

    /** 发往「新邮箱」的验证码（scene=bind）。 */
    @NotBlank(message = "新邮箱验证码不能为空")
    @Pattern(regexp = "^\\d{6}$", message = "邮箱验证码为 6 位数字")
    private String emailCode;

    /**
     * 发往「当前已绑定邮箱」的验证码（scene=unbind）。
     *
     * <p>已绑定邮箱的账号必填；从未绑定过邮箱的老账号不需要传（此时为空串/ null 都可）。
     * 正则写成 {@code ^$|^\d{6}$} 就是为了让空串也合法。</p>
     */
    @Pattern(regexp = "^$|^\\d{6}$", message = "当前邮箱验证码为 6 位数字")
    private String oldEmailCode;
}
