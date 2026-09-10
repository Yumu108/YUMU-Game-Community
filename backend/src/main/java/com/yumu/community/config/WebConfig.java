package com.yumu.community.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 静态资源：把上传的图片映射到 /files/**（在 context-path /api 下即 /api/files/**）。
 * 上传接口返回 /api/files/{filename} 即可被前端直接引用。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${yumu.upload.dir:./uploads}")
    private String uploadDir;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path dir = Paths.get(uploadDir).toAbsolutePath().normalize();
        registry.addResourceHandler("/files/**")
                .addResourceLocations("file:" + dir.toString() + "/")
                .setCachePeriod(3600);
    }
}
