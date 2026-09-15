package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.dto.EmailBindRequest;
import com.yumu.community.dto.UserEmailCodeRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.UserEmailService;
import com.yumu.community.vo.UserInfoVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * 账号设置 → 邮箱绑定 / 更换（9-15）。
 *
 * <p>路径特意开在 {@code /user/email}（单数）而不是复用 {@code /users} —— 后者是
 * 「用户公开主页」的公开路由（GET 全放行），把自己账号的邮箱操作混进去语义不清，
 * 也容易被将来某条宽松的匹配规则误放行。</p>
 *
 * <p>本控制器全部接口<b>需要登录</b>（不在 SecurityConfig 的 permitAll 名单里）。</p>
 */
@RestController
@RequestMapping("/user/email")
@RequiredArgsConstructor
public class UserEmailController {

    private final UserEmailService userEmailService;

    /**
     * 请求邮箱验证码。
     *
     * <p>{@code scene=new} 发给请求体里的新邮箱（顺带查重）；{@code scene=old} 发给当前已绑定的邮箱。</p>
     */
    @PostMapping("/code")
    public Result<Void> sendCode(@AuthenticationPrincipal CustomUserDetails details,
                                 @Valid @RequestBody UserEmailCodeRequest req) {
        if (details == null) {
            return Result.error(401, "未登录");
        }
        userEmailService.sendCode(details.getUserId(), req);
        return Result.success(null);
    }

    /**
     * 绑定 / 更换邮箱。已绑定的账号必须同时带原邮箱码与新邮箱码。
     * 返回最新用户信息，前端可直接刷新 store。
     */
    @PostMapping("/bind")
    public Result<UserInfoVO> bind(@AuthenticationPrincipal CustomUserDetails details,
                                   @Valid @RequestBody EmailBindRequest req) {
        if (details == null) {
            return Result.error(401, "未登录");
        }
        return Result.success(userEmailService.bind(details.getUserId(), req));
    }
}
