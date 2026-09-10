package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 后台管理系统用户列表项。
 */
@Data
public class AdminUserVO {

    private Long id;
    private String username;
    private String nickname;
    private String avatar;
    private Integer status;
    private List<String> roles;
    private LocalDateTime createdAt;
    /** 9-07：版主负责 (游戏, 板块) 授权列表；非版主为空。前端按游戏筛版主 + 列表展示负责游戏名。 */
    private List<ModeratorAssignmentVO> moderatorAssignments;
}
