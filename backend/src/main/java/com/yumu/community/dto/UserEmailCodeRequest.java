package com.yumu.community.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 账号设置 → 给邮箱发验证码（9-15，需登录）。
 *
 * <p>两种场景：</p>
 * <ul>
 *   <li>{@code new} —— 给<b>新邮箱</b>发码（要换绑过去的目标邮箱，会先查重）；</li>
 *   <li>{@code old} —— 给<b>当前已绑定的邮箱</b>发码，用于证明「你是号主本人」。</li>
 * </ul>
 */
@Data
public class UserEmailCodeRequest {

    /** new = 给新邮箱发；old = 给当前绑定邮箱发。 */
    @NotBlank(message = "场景不能为空")
    private String scene;

    /** 新邮箱地址。scene=new 时必填；scene=old 时忽略（一律发到当前绑定邮箱）。 */
    @Email(message = "邮箱格式不正确")
    @Size(max = 100, message = "邮箱过长")
    private String email;
}
