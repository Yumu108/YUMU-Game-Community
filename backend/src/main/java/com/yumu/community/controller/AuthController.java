package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.config.JwtUtil;
import com.yumu.community.dto.EmailCodeRequest;
import com.yumu.community.dto.LoginRequest;
import com.yumu.community.dto.PasswordResetRequest;
import com.yumu.community.dto.RegisterRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.AuthService;
import com.yumu.community.vo.UserInfoVO;
import io.jsonwebtoken.Claims;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final JwtUtil jwtUtil;

    /**
     * 注册（9-15 起为「邮箱注册」）。
     *
     * <p>请求体必须带 {@code email} + {@code emailCode}（6 位验证码，先调
     * {@code POST /auth/email-code} 拿）。服务端校验通过才落库，验证码一次性消费。</p>
     */
    @PostMapping("/register")
    public Result<Map<String, Object>> register(@Valid @RequestBody RegisterRequest req) {
        return Result.success(authService.register(req));
    }

    /**
     * 登录。
     *
     * <p>9-15 起 {@code username} 字段同时接受<b>账号id</b>与<b>邮箱</b>：
     * 先按账号id查，查不到再按邮箱查。</p>
     */
    @PostMapping("/login")
    public Result<Map<String, Object>> login(@Valid @RequestBody LoginRequest req) {
        return Result.success(authService.login(req));
    }

    /**
     * 9-15：请求邮箱验证码（免登录）。
     *
     * <p>scene 只允许 {@code register}（注册）与 {@code reset}（忘记密码）——
     * 换绑邮箱用的 bind / unbind 走需登录的 {@code POST /user/email/code}，
     * 否则任何人都能给任意邮箱发「绑定」验证码。</p>
     *
     * <p>防枚举：reset 场景若邮箱未注册，同样返回成功但不会真的发信。</p>
     */
    @PostMapping("/email-code")
    public Result<Void> emailCode(@Valid @RequestBody EmailCodeRequest req) {
        authService.sendEmailCode(req);
        return Result.success(null);
    }

    /**
     * 9-15：忘记密码 —— 邮箱验证码重置。
     *
     * <p>成功后<b>不自动登录</b>，用户需用新密码登一次。</p>
     */
    @PostMapping("/reset-password")
    public Result<Void> resetPassword(@Valid @RequestBody PasswordResetRequest req) {
        authService.resetPassword(req);
        return Result.success(null);
    }

    @GetMapping("/me")
    public Result<UserInfoVO> me(@AuthenticationPrincipal CustomUserDetails details) {
        if (details == null) {
            return Result.error(401, "未登录");
        }
        return Result.success(authService.me(details.getUserId()));
    }

    /**
     * 9-10 滑动续签：用仍然有效的 token 换取新 token（有效期重置为 2h），旧 token 立即作废。
     *
     * 需要鉴权（SecurityConfig 里 /auth/refresh 走 authenticated）：
     *  - 黑名单中的 token 在过滤器阶段就被拒，不会走到这里；
     *  - 前端在"临期（<30 分钟）/ 收到 401"时调用，活跃用户因此不会被强制重登。
     */
    @PostMapping("/refresh")
    public Result<Map<String, Object>> refresh(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return Result.error(401, "未登录");
        }
        try {
            Claims claims = jwtUtil.parse(authorization.substring(7));
            Long uid = claims.get("uid", Long.class);
            if (uid == null) {
                return Result.error(401, "token 缺少用户标识，请重新登录");
            }
            return Result.success(authService.refresh(uid, claims.getId(), claims.getExpiration()));
        } catch (Exception e) {
            return Result.error(401, "登录状态已失效，请重新登录");
        }
    }

    /**
     * A3：退出登录。把当前 Authorization 头里的 token 解析 jti + exp 后入黑名单。
     * 已过期的 token 也允许调用（no-op），便于前端"清残留"的兜底；
     * 即便用户未传 token 也直接返 200（不泄露"是否已登录"）。
     */
    @PostMapping("/logout")
    public Result<Void> logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        if (authorization != null && authorization.startsWith("Bearer ")) {
            String token = authorization.substring(7);
            try {
                Claims claims = jwtUtil.parse(token);
                authService.logout(claims.getId(), claims.getExpiration());
            } catch (Exception ignored) {
                // 过期 / 无效 token 也走 logout，幂等返回 200
            }
        }
        return Result.success(null);
    }
}
