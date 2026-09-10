package com.yumu.community.dto;

import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;

@Data
public class UpdateUserRolesRequest {

    @NotEmpty(message = "角色列表不能为空")
    private List<String> roles;
}
