package com.yumu.community.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * JWT 工具：签发与解析 token。
 *
 * 关键设计（9-09 安全加固 A3）：
 *  - token 带 jti（UUID），作为该次登录的唯一标识；退出登录时把 jti 入 Redis 黑名单，
 *    过滤器阶段比对黑名单 → 即使 token 没过 expiresBefore 也立即作废（防止旧 token 盗用）。
 *  - access token 短期：默认 2h（原 24h），让"退出即失效"的用户感知与时间窗口更贴合；
 *    若上线后希望保留长会话，后续可加 refresh token 机制（不在本期内做）。
 */
@Component
public class JwtUtil {

    @Value("${jwt.secret}")
    private String secret;

    /** access token 有效期（毫秒）；默认 2h，可由配置覆盖。 */
    @Value("${jwt.expiration:7200000}")
    private long expiration;

    private SecretKey key() {
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 签发 token：subject=username，claim uid=userId，jti=UUID（退出黑名单的 key）。
     */
    public String generateToken(String username, Long userId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(username)
                .claim("uid", userId)
                .id(UUID.randomUUID().toString())
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expiration))
                .signWith(key())
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(key())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public String getUsername(String token) {
        return parse(token).getSubject();
    }

    public Long getUserId(String token) {
        return parse(token).get("uid", Long.class);
    }

    /** jti（退出黑名单维度）。 */
    public String getJti(String token) {
        return parse(token).getId();
    }

    /** 过期时间（用于退出时算黑名单 TTL）。 */
    public Date getExpiration(String token) {
        return parse(token).getExpiration();
    }

    public boolean validate(String token) {
        try {
            parse(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 配置中的有效期（毫秒），供业务层日志 / 文档读取。 */
    public long getExpirationMs() {
        return expiration;
    }
}