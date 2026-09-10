package com.yumu.community.service;

import com.yumu.community.dto.UpdatePasswordRequest;
import com.yumu.community.dto.UpdateProfileRequest;
import com.yumu.community.dto.UpdateUsernameRequest;
import com.yumu.community.vo.UserInfoVO;
import com.yumu.community.vo.UserProfileVO;

public interface UserService {

    /** 获取用户主页公开信息 + 帖子列表。viewerId 为当前访客（可空）。 */
    UserProfileVO getProfile(Long userId, Long viewerId);

    /** 修改当前登录用户资料（昵称/头像/签名/爱好/常看板块），返回最新用户信息 */
    UserInfoVO updateProfile(Long userId, UpdateProfileRequest req);

    /** 修改登录账号（用户名），每年仅可修改一次，返回最新用户信息 */
    UserInfoVO updateUsername(Long userId, UpdateUsernameRequest req);

    /** 修改密码（需校验原密码正确） */
    void updatePassword(Long userId, UpdatePasswordRequest req);
}
