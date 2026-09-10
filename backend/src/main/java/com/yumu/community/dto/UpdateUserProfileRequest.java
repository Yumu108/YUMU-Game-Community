package com.yumu.community.dto;

import lombok.Data;

/**
 * 后台管理：编辑用户基础资料（昵称/简介/邮箱/头像/性别）。
 * 仅允许管理员修改，不涉及密码与角色。
 */
@Data
public class UpdateUserProfileRequest {

    private String nickname;

    private String bio;

    private String email;

    private String avatar;

    private Integer gender;
}
