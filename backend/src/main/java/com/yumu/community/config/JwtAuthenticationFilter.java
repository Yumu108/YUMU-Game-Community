package com.yumu.community.config;

import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.security.CustomUserDetailsService;
import com.yumu.community.security.TokenBlacklistService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * JWT 认证过滤器：从 Authorization 头解析 token，重建登录态写入 SecurityContext。
 *
 * 9-09 A3：解析后先查 jti 是否在 Redis 黑名单，若在列则等同未登录（401），
 * 防止「退出登录后旧 token 仍可用」造成账号冒用。
 */
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;
    private final CustomUserDetailsService userDetailsService;
    private final TokenBlacklistService tokenBlacklist;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            if (jwtUtil.validate(token) && SecurityContextHolder.getContext().getAuthentication() == null) {
                // A3：先比对 jti 是否已被登出拉黑
                String jti = jwtUtil.getJti(token);
                if (tokenBlacklist.isBlacklisted(jti)) {
                    // 不写 SecurityContext → SecurityConfig 的 EntryPoint 直接返 401
                    filterChain.doFilter(request, response);
                    return;
                }
                // 用 uid claim（不可变的用户 id）解析身份，而非 subject(登录账号)；
                // 这样用户修改登录账号后，旧 token 仍可按 id 命中用户，会话不失效。
                Long uid = jwtUtil.getUserId(token);
                if (uid != null) {
                    CustomUserDetails details = (CustomUserDetails) userDetailsService.loadUserById(uid);
                    // 被封禁（status=1）用户即使持有旧 token 也不放行：等同未登录（401），确保封禁即时生效
                    if (details.isEnabled()) {
                        UsernamePasswordAuthenticationToken auth =
                                new UsernamePasswordAuthenticationToken(details, null, details.getAuthorities());
                        auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }
                }
            }
        }
        filterChain.doFilter(request, response);
    }
}