package com.yumu.community.mail;

import java.util.Locale;

/**
 * 邮箱验证码的使用场景。
 *
 * <p>每个场景的验证码互相独立（Redis key 不同），互不干扰 ——
 * 例如「注册」的码不能拿去「重置密码」。</p>
 */
public enum EmailScene {

    /** 注册新账号：注册接口校验通过才落库。 */
    REGISTER("register", "注册账号"),

    /** 忘记密码 → 重置。 */
    RESET("reset", "重置密码"),

    /** 账号设置 → 绑定新邮箱（首次绑定，或更换时的新邮箱）。 */
    BIND("bind", "绑定新邮箱"),

    /** 账号设置 → 更换前验证「当前已绑定的邮箱」，证明是号主本人。 */
    UNBIND("unbind", "更换绑定邮箱");

    private final String code;
    private final String label;

    EmailScene(String code, String label) {
        this.code = code;
        this.label = label;
    }

    /** Redis key 中使用的场景标识（纯英文，小写）。 */
    public String code() {
        return code;
    }

    /** 邮件正文里给用户看的中文场景名。 */
    public String label() {
        return label;
    }

    /**
     * 从接口参数解析场景。
     *
     * <p>⚠️ 只允许公开的两种场景（REGISTER / RESET）由 {@code /auth/email-code} 使用；
     * BIND / UNBIND 走需登录的 {@code /user/email/code}，避免未登录就能给任意邮箱发「绑定」码。</p>
     */
    public static EmailScene of(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("scene 不能为空");
        }
        String v = value.trim().toLowerCase(Locale.ROOT);
        for (EmailScene e : values()) {
            if (e.code.equals(v)) {
                return e;
            }
        }
        throw new IllegalArgumentException("不支持的 scene：" + value);
    }
}
