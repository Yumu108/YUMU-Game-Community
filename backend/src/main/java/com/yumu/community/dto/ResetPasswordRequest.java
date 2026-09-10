package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 后台管理：管理员重置用户密码。
 * newPassword 必填且 ≥6 位，由管理员显式指定；不允许留空（不再生成随机初始密码）。
 */
@Data
public class ResetPasswordRequest {

    private String newPassword;
}
