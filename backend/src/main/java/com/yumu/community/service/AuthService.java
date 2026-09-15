package com.yumu.community.service;

import com.yumu.community.dto.EmailCodeRequest;
import com.yumu.community.dto.LoginRequest;
import com.yumu.community.dto.PasswordResetRequest;
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
     *
     * <p>9-15 起：必须提供「邮箱 + 邮箱验证码」，校验通过才落库（邮箱注册）。</p>
     */
    Map<String, Object> register(RegisterRequest req);

    /**
     * 登录校验，返回 token 与用户信息。
     *
     * <p>9-15 起：登录标识（{@code username} 字段）同时接受<b>账号id</b>与<b>邮箱</b>。</p>
     */
    Map<String, Object> login(LoginRequest req);

    /**
     * 9-15：请求邮箱验证码（免登录场景 —— 注册 / 忘记密码）。
     *
     * <p>内含邮箱级冷却与 IP 级小时上限；reset 场景对未注册邮箱静默返回成功以防枚举。</p>
     */
    void sendEmailCode(EmailCodeRequest req);

    /**
     * 9-15：忘记密码 —— 用邮箱验证码重置密码。
     *
     * <p>只改密码：不返回账号信息、不自动登录、不影响账号禁用状态。</p>
     */
    void resetPassword(PasswordResetRequest req);

    /**
     * 当前登录用户信息。
     */
    UserInfoVO me(Long userId);

    /**
     * A3：退出登录 —— 把当前 token 的 jti 加入 Redis 黑名单（TTL 至 token 过期）。
     * 已过期的 jti 入黑名单是 no-op；jti 缺失（早期签发的 token）则直接放过。
     */
    void logout(String jti, Date expiration);

    /**
     * 9-10 滑动续签：用仍然有效的 token 换取一张新的短期 token（有效期重置）。
     *
     * 设计取舍：
     *  - 仍签发短期 token（默认 2h），不引入长期 refresh token —— 保持 A3 的安全水位，
     *    只解决"活跃用户每 2 小时被强制重登"的体验问题；
     *  - 旧 token 的 jti 立即入黑名单（**轮换**），防止旧 token 在自然过期前被继续使用；
     *  - 角色/权限每次从 DB 重载（与登录一致），改权限后不用等 token 过期。
     *
     * @param userId   当前 token 里的 uid
     * @param jti      当前 token 的 jti（将入黑名单）
     * @param currentExpiration 当前 token 的过期时间（算黑名单 TTL）
     * @return { token, expiresIn }
     */
    Map<String, Object> refresh(Long userId, String jti, Date currentExpiration);
}
