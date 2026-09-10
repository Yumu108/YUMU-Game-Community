package com.yumu.community;

import com.yumu.community.tools.AdminPasswordTool;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// D1（9-10）：随 Spring Boot 4 升级，原先 exclude 的
// org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration
// 已随自动配置模块化重构而迁移/移除。本项目不使用 Spring Data Redis Repository（只用 CacheService），
// 故直接去掉该 exclude；如未来启动时出现 Redis repository 扫描相关报错，再按 Boot 4 的新包名排除。
@SpringBootApplication
@MapperScan("com.yumu.community.mapper")
public class YumuCommunityApplication {

    public static void main(String[] args) {
        // D2（9-10）：运维子命令（--gen-password / --gen-password-hash=xxx）
        // 命中则打印口令哈希后直接退出，不启动 Web 容器。
        if (AdminPasswordTool.tryRun(args)) {
            return;
        }
        SpringApplication.run(YumuCommunityApplication.class, args);
    }
}
