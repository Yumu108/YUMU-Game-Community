package com.yumu.community.vo;

import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.List;

/**
 * 后台管理系统用户详情（含版主负责的 (游戏, 板块) 授权）。
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class AdminUserDetailVO extends AdminUserVO {

    private String email;
    private String bio;
    private Integer gender;
    private List<ModeratorAssignmentVO> moderatorAssignments;
}
