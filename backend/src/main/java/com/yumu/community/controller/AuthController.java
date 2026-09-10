package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.config.JwtUtil;
import com.yumu.community.dto.LoginRequest;
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

    @PostMapping("/register")
    public Result<Map<String, Object>> register(@Valid @RequestBody RegisterRequest req) {
        return Result.success(authService.register(req));
    }

    @PostMapping("/login")
    public Result<Map<String, Object>> login(@Valid @RequestBody LoginRequest req) {
        return Result.success(authService.login(req));
    }

    @GetMapping("/me")
    public Result<UserInfoVO> me(@AuthenticationPrincipal CustomUserDetails details) {
        if (details == null) {
            return Result.error(401, "未登录");
        }
        return Result.success(authService.me(details.getUserId()));
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