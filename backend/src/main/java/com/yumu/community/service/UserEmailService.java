package com.yumu.community.service;

import com.yumu.community.dto.EmailBindRequest;
import com.yumu.community.dto.UserEmailCodeRequest;
import com.yumu.community.vo.UserInfoVO;

/**
 * 账号设置里的邮箱绑定 / 更换（9-15）。
 *
 * <p>与免登录的 {@code /auth/email-code} 分开成两个入口，是为了让
 * {@code bind} / {@code unbind} 两个场景<b>必须登录才能触发</b> ——
 * 否则任何人都能给任意邮箱发「绑定」验证码。</p>
 */
public interface UserEmailService {

    /** 给「新邮箱」或「当前绑定邮箱」发验证码（需登录）。 */
    void sendCode(Long userId, UserEmailCodeRequest req);

    /**
     * 绑定 / 更换邮箱（需登录）。返回最新的用户信息，方便前端直接刷新 store。
     *
     * <p>已绑定的账号必须同时提供原邮箱码与新邮箱码，两个都通过才替换。</p>
     */
    UserInfoVO bind(Long userId, EmailBindRequest req);
}
