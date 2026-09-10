package com.yumu.community;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration;

@SpringBootApplication(exclude = {RedisRepositoriesAutoConfiguration.class})
@MapperScan("com.yumu.community.mapper")
public class YumuCommunityApplication {

    public static void main(String[] args) {
        SpringApplication.run(YumuCommunityApplication.class, args);
    }
}
