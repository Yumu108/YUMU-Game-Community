package com.yumu.community.service;

import com.yumu.community.dto.LoginRequest;
import com.yumu.community.dto.RegisterRequest;
import com.yumu.community.vo.UserInfoVO;

import java.util.Date;
import java.util.Map;

/**
 * 认证业务。
 */
public interface AuthService {

    /**
     * 注册新用户，自动分配 USER 角色，返回 token 与用户信息。
     */
    Map<String, Object> register(RegisterRequest req);

    /**
     * 登录校验，返回 token 与用户信息。
     */
    Map<String, Object> login(LoginRequest req);

    /**
     * 当前登录用户信息。
     */
    UserInfoVO me(Long userId);

    /**
     * A3：退出登录 —— 把当前 token 的 jti 加入 Redis 黑名单（TTL 至 token 过期）。
     * 已过期的 jti 入黑名单是 no-op；jti 缺失（早期签发的 token）则直接放过。
     */
    void logout(String jti, Date expiration);
}
