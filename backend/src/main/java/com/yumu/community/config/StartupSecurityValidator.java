package com.yumu.community.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * D4（9-10）：启动期安全自检 —— 把「静默降级」变成「启动即失败」（fail-fast）。
 *
 * <p>背景：application.yml 为照顾本地开发，给 DB_PASSWORD / JWT_SECRET 保留了弱默认值。
 * 这在本地是便利，在生产是隐患——忘了注入环境变量时应用照常启动、悄悄用弱口令与默认密钥运行，
 * 而且没有任何告警。本类在启动时集中体检这几项「配错了也能跑」的高危配置。
 *
 * <p>策略：
 * <ul>
 *   <li>prod profile（{@code SPRING_PROFILES_ACTIVE=prod}）：任一项不合格 → 抛异常，中断启动；</li>
 *   <li>其他 profile（本机开发 / 测试）：仅打 WARN，不打扰本地零配置直跑。</li>
 * </ul>
 *
 * <p>与 application-prod.yml 的关系：那里负责「变量根本没设」的场景（占位符解析失败），
 * 这里负责「变量设了但值是弱口令」的场景，两者互补。
 */
@Component
public class StartupSecurityValidator implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(StartupSecurityValidator.class);

    /** application.yml 中 JWT_SECRET 的仓库内置默认值（一旦命中即视为未替换）。 */
    private static final String DEFAULT_JWT_SECRET = "yumu-community-secret-key-change-me-please";

    /** HS256 密钥最低强度要求（字节）。 */
    private static final int MIN_JWT_SECRET_BYTES = 32;

    /** 常见弱口令 / 模板占位值。 */
    private static final Set<String> WEAK_PASSWORDS = Set.of(
            "123456", "12345678", "password", "root", "mysql", "admin",
            "change-me-strong-password", "change-me", "test");

    private final Environment env;

    public StartupSecurityValidator(Environment env) {
        this.env = env;
    }

    @Override
    public void afterPropertiesSet() {
        boolean prod = isProdProfile();
        List<String> problems = new ArrayList<>();

        // ① JWT 签名密钥：默认值 / 长度不足
        String jwtSecret = env.getProperty("jwt.secret", "");
        if (DEFAULT_JWT_SECRET.equals(jwtSecret)) {
            problems.add("JWT_SECRET 仍是仓库内置默认值 —— 必须替换为 >=32 字节随机串（openssl rand -base64 48）");
        } else if (jwtSecret.length() < MIN_JWT_SECRET_BYTES) {
            problems.add("JWT_SECRET 仅 " + jwtSecret.length() + " 字节，低于要求的 " + MIN_JWT_SECRET_BYTES + " 字节");
        }

        // ② 数据库口令：空 / 弱口令
        String dbPassword = env.getProperty("spring.datasource.password", "");
        if (dbPassword.isBlank()) {
            problems.add("DB_PASSWORD 为空 —— 必须注入真实数据库口令");
        } else if (WEAK_PASSWORDS.contains(dbPassword)) {
            problems.add("DB_PASSWORD 是弱口令或模板占位值（当前值：" + dbPassword + "）—— 请换成强口令");
        }

        // ③ 限频总开关：生产关掉等于把接口敞开（含 /ai/chat 这种直接烧 token 的公开接口）
        if (!env.getProperty("yumu.security.rate-limit.enabled", Boolean.class, true)) {
            problems.add("RATE_LIMIT_ENABLED=false —— 生产环境关闭了全部接口限频");
        }

        // ④ 助手配置自相矛盾：明确要求真实模型，却没给 key
        boolean llmMock = env.getProperty("llm.mock", Boolean.class, true);
        String llmKey = env.getProperty("llm.api-key", "");
        if (!llmMock && llmKey.isBlank()) {
            problems.add("LLM_MOCK=false 但 LLM_API_KEY 为空 —— 助手每次提问都会失败");
        }

        // ⑤ 跨域仍指向本地（不致命，但生产一定是配错或没配）
        String cors = env.getProperty("yumu.cors.allowed-origins", "");
        if (cors.contains("localhost") || cors.contains("127.0.0.1")) {
            problems.add("CORS_ALLOWED_ORIGINS 仍包含 localhost —— 生产请改成真实域名");
        }

        if (problems.isEmpty()) {
            log.info("[安全自检] 通过（profiles={}）", String.join(",", env.getActiveProfiles()));
            return;
        }

        if (prod) {
            throw new IllegalStateException(
                    System.lineSeparator()
                    + "================ 生产环境安全自检未通过，已拒绝启动（fail-fast） ================"
                    + System.lineSeparator() + "  - "
                    + String.join(System.lineSeparator() + "  - ", problems)
                    + System.lineSeparator()
                    + "--------------------------------------------------------------------------"
                    + System.lineSeparator()
                    + " 修复：编辑项目根 .env（或注入同名环境变量）后重启服务。"
                    + System.lineSeparator()
                    + " 本地开发若要绕过：不要使用 prod profile（start.bat 默认即不使用）。"
                    + System.lineSeparator()
                    + "==========================================================================");
        }
        for (String p : problems) {
            log.warn("[安全自检] 非生产环境，仅提醒（不影响本次启动）：{}", p);
        }
    }

    private boolean isProdProfile() {
        for (String p : env.getActiveProfiles()) {
            if ("prod".equalsIgnoreCase(p)) {
                return true;
            }
        }
        return false;
    }
}
