package com.yumu.community.config;

import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

/**
 * JWT 签发/解析的单元测试（用 ReflectionTestUtils 注入 @Value 字段，不启 Spring 容器）。
 *
 * 重点锁一个项目里踩过的坑（见 MEMORY）：鉴权过滤器必须用 token 的 **uid claim** 解析用户，
 * 而不是 subject(username) —— 用户改名后旧 token 会失效。这里把 uid 往返固化下来。
 */
class JwtUtilTest {

    private static final String SECRET = "unit-test-secret-key-at-least-32-bytes-long!!";
    private static final long TWO_HOURS = 7_200_000L;

    private JwtUtil jwtUtil;

    @BeforeEach
    void setUp() {
        jwtUtil = new JwtUtil();
        ReflectionTestUtils.setField(jwtUtil, "secret", SECRET);
        ReflectionTestUtils.setField(jwtUtil, "expiration", TWO_HOURS);
    }

    @Test
    @DisplayName("签发→解析：username、uid、jti 均正确往返")
    void roundTrip() {
        String token = jwtUtil.generateToken("alice", 42L);
        assertNotNull(token);

        Claims claims = jwtUtil.parse(token);
        assertEquals("alice", claims.getSubject());
        assertEquals(42, ((Number) claims.get("uid")).intValue(), "uid claim 必须存在且正确");
        assertNotNull(claims.getId(), "jti 必须存在（退出黑名单依赖它）");

        assertEquals("alice", jwtUtil.getUsername(token));
        assertEquals(42L, jwtUtil.getUserId(token));
        assertNotNull(jwtUtil.getJti(token));
        assertTrue(jwtUtil.validate(token));
    }

    @Test
    @DisplayName("每次签发的 jti 唯一（否则退出登录会把别人的 token 一起拉黑）")
    void jtiIsUniquePerToken() {
        String a = jwtUtil.generateToken("alice", 1L);
        String b = jwtUtil.generateToken("alice", 1L);
        assertNotEquals(jwtUtil.getJti(a), jwtUtil.getJti(b));
    }

    @Test
    @DisplayName("过期时间约等于配置值（2h）")
    void expirationMatchesConfig() {
        String token = jwtUtil.generateToken("alice", 1L);
        long expMs = jwtUtil.getExpiration(token).getTime();
        long now = System.currentTimeMillis();
        long delta = expMs - now;
        assertTrue(Math.abs(delta - TWO_HOURS) < 60_000, "有效期应约为 2h，实际 " + delta + "ms");
        assertEquals(TWO_HOURS, jwtUtil.getExpirationMs());
    }

    @Test
    @DisplayName("篡改 / 伪造 / 空 token 一律判为无效，不抛异常")
    void invalidTokensAreRejected() {
        String token = jwtUtil.generateToken("alice", 1L);
        assertFalse(jwtUtil.validate(token + "x"), "被追加字符的 token 必须无效");
        assertFalse(jwtUtil.validate("not.a.jwt"));
        assertFalse(jwtUtil.validate(""));
        assertFalse(jwtUtil.validate(null));
    }

    @Test
    @DisplayName("用不同密钥签发的 token 无法通过校验（防伪造）")
    void rejectsTokenSignedWithOtherSecret() {
        JwtUtil other = new JwtUtil();
        ReflectionTestUtils.setField(other, "secret", "a-totally-different-secret-key-32bytes!!!");
        ReflectionTestUtils.setField(other, "expiration", TWO_HOURS);

        String forged = other.generateToken("admin", 999L);
        assertFalse(jwtUtil.validate(forged), "换密钥签发的 token 必须校验失败");
    }

    @Test
    @DisplayName("已过期 token 校验失败")
    void rejectsExpiredToken() {
        JwtUtil expired = new JwtUtil();
        ReflectionTestUtils.setField(expired, "secret", SECRET);
        ReflectionTestUtils.setField(expired, "expiration", -1000L); // 签发即过期
        String token = expired.generateToken("alice", 1L);
        assertFalse(jwtUtil.validate(token), "过期 token 必须无效");
    }
}
