package com.yumu.community.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;

/**
 * 安全配置：无状态 JWT 认证。
 * 放行认证接口与公开只读接口；写操作（发帖/点赞/收藏/回复）需携带有效 JWT。
 */
@Configuration
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    @Value("${yumu.cors.allowed-origins:http://localhost:5173}")
    private String allowedOrigins;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(org.springframework.security.config.Customizer.withDefaults())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(unauthorizedEntryPoint())
                        .accessDeniedHandler(accessDeniedHandler()))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/auth/**").permitAll()
                        // WebSocket 握手：鉴权在 JwtHandshakeInterceptor 内做（校验 ?token=），
                        // 此处放行是因为握手阶段拿不到 Authorization 头（浏览器原生 WS 不能自定义头）
                        .requestMatchers("/ws/**", "/api/ws/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/boards/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/posts").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/posts/*").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/posts/*/replies").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/posts/*/tags").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/tags/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/stats/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/search").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/users/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/files/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/system/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/announcements/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/games/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/picks/**").permitAll()
                        // 社区智能助手：游客可用，无需登录（token 仅存服务端）
                        .requestMatchers("/ai/**").permitAll()
                        // B5：只放行 health 探活端点（供 Nginx / docker healthcheck / 探活脚本调用）。
                        // 其余 actuator 端点（env / heapdump / beans / configprops / mappings）一律不放行：
                        // 它们会把 JWT_SECRET、数据库密码、完整配置明文吐出来，与 B4「密钥外置」直接冲突。
                        // 双重保险：① Security 未放行 → 401/403；② management 未 expose → 404。
                        .requestMatchers(org.springframework.http.HttpMethod.GET,
                                "/actuator/health", "/api/actuator/health").permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOriginPatterns(List.of(allowedOrigins.split(",")));
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setAllowCredentials(true);
        cfg.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /** 未携带/无效 JWT 时返回 401 + 统一 JSON，便于前端识别并自动登出（而非默认 403 空 body）。 */
    private AuthenticationEntryPoint unauthorizedEntryPoint() {
        return (HttpServletRequest request, HttpServletResponse response, org.springframework.security.core.AuthenticationException authException) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            try {
                response.getWriter().write("{\"code\":401,\"message\":\"未登录或登录已过期\",\"data\":null}");
            } catch (IOException ignored) {
            }
        };
    }

    /**
     * 已登录但角色/权限不足时返回 403 + 统一 JSON（如普通用户访问 /admin/**）。
     * 与全局 Result 风格一致：HTTP 403 + {"code":403,...}，前端按 data.code 拦截。
     */
    private AccessDeniedHandler accessDeniedHandler() {
        return (HttpServletRequest request, HttpServletResponse response, AccessDeniedException accessDeniedException) -> {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json;charset=UTF-8");
            try {
                response.getWriter().write("{\"code\":403,\"message\":\"无权限（需要管理员角色）\",\"data\":null}");
            } catch (IOException ignored) {
            }
        };
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
