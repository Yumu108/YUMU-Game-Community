package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 修改登录账号（用户名）。
 * 账号长度 3-20，仅允许字母 / 数字 / 下划线；每年仅可修改一次（由后端按 last_username_change_at 校验）。
 */
@Data
public class UpdateUsernameRequest {

    @NotBlank(message = "账号不能为空")
    @Size(min = 3, max = 20, message = "账号长度需 3-20 位")
    private String username;
}
