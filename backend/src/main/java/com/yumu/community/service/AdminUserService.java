package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.dto.ResetPasswordRequest;
import com.yumu.community.dto.UpdateUserProfileRequest;
import com.yumu.community.vo.AdminUserDetailVO;
import com.yumu.community.vo.AdminUserVO;

import java.util.List;
import java.util.Map;

/**
 * 后台管理系统用户服务：仅管理员可调用。
 */
public interface AdminUserService {

    /**
     * 分页搜索用户。
     *
     * @param keyword 用户名/昵称模糊匹配（可空）
     * @param gameId  非空时仅返回「担任该游戏版主」的用户；用于后台按游戏筛版主
     */
    PageResult<AdminUserVO> listUsers(String keyword, Long gameId, long current, long size);

    /** 获取用户详情（含角色与版主负责板块）。 */
    AdminUserDetailVO getUserDetail(Long userId);

    /** 全量替换用户角色（角色 code 列表，如 ["USER","MODERATOR"]）。 */
    void updateUserRoles(Long userId, List<String> roleCodes);

    /** 封禁/解封用户（status 1=封禁 0=正常）。不能操作自己，以免误锁管理员。 */
    void setUserStatus(Long operatorId, Long userId, int status);

    /** 编辑用户基础资料（昵称/简介/邮箱/头像/性别）。 */
    void updateUserProfile(Long userId, UpdateUserProfileRequest req);

    /**
     * 管理员重置用户密码。返回生成的初始密码（若请求未指定）。
     */
    String resetPassword(Long userId, ResetPasswordRequest req);

    /** 删除用户（逻辑删除）。不能删除自己。 */
    void deleteUser(Long operatorId, Long userId);
}
