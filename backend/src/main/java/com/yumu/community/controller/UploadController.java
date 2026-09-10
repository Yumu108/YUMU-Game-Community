package com.yumu.community.controller;

import com.yumu.community.common.BusinessException;
import com.yumu.community.common.Result;
import com.yumu.community.security.ImageMagicByteValidator;
import com.yumu.community.utils.ImageOptimizer;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

/**
 * 图片上传：接收 multipart 图片 → 魔数校验 → 落盘到 yumu.upload.dir → 返回可访问的 URL（/api/files/{filename}）。
 *
 * 9-09 A4 加固：
 *  - 扩展名白名单（拒绝可执行后缀 .jsp/.php/.exe/.sh/.svg 等）
 *  - Content-Type 必须以 image/ 开头（防止伪装）
 *  - 文件大小上限 10MB
 *  - 真实文件头（magic bytes）必须与扩展名一致（防 .jpg 实际是 PHP）
 *  - SVG 显式拒绝（图片格式但允许 <script>，是 XSS 通道）
 *  - 上传必须登录（防止未登录滥用带宽 / 灌脏文件）
 *  - 落盘目录优先用 yumu.upload.dir（绝对路径推荐 /data/uploads），不存在则回退 ./uploads；目录路径 resolve 后必须仍位于配置的根目录内（防目录穿越）
 *  - 防伪文件名：仅使用服务端 UUID 命名，原始文件名丢弃（避免路径注入与超长文件名）
 */
@RestController
@RequestMapping("/upload")
@RequiredArgsConstructor
@Slf4j
public class UploadController {

    private static final long MAX_SIZE = 10L * 1024 * 1024; // 10MB
    private final ImageMagicByteValidator magicByteValidator;
    private final ImageOptimizer imageOptimizer;

    @Value("${yumu.upload.dir:./uploads}")
    private String uploadDir;

    @Value("${yumu.upload.url-prefix:/api/files}")
    private String urlPrefix;

    @PostMapping
    public Result<String> upload(@RequestParam("file") MultipartFile file,
                                 HttpServletRequest request) {
        // A4：上传必须登录（防止未登录滥用带宽 / 灌脏文件）
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            throw new BusinessException(401, "请先登录后再上传图片");
        }

        if (file == null || file.isEmpty()) {
            throw new BusinessException(400, "文件为空");
        }
        if (file.getSize() > MAX_SIZE) {
            throw new BusinessException(400, "图片过大（上限 10MB）");
        }
        // 1) 扩展名白名单
        String original = file.getOriginalFilename();
        String ext = (original != null && original.contains("."))
                ? original.substring(original.lastIndexOf('.') + 1).toLowerCase()
                : "jpg";
        if (!ImageMagicByteValidator.ALLOWED_EXTS.contains(ext)) {
            throw new BusinessException(400, "不支持的图片格式：" + ext);
        }
        // 2) 拒绝 SVG（图片格式但可内嵌脚本，是 XSS 通道）
        if ("svg".equals(ext) || "svgz".equals(ext)) {
            throw new BusinessException(400, "为安全考虑不支持 SVG，请改用 PNG / JPG / WEBP");
        }
        // 3) Content-Type 必须以 image/ 开头
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            throw new BusinessException(400, "仅支持图片文件");
        }
        // 4) 真实文件头 magic bytes 校验（防 .jpg 实际是 PHP/JSP/EXE）
        byte[] head;
        try (InputStream in = file.getInputStream()) {
            head = in.readNBytes(16);
        } catch (IOException e) {
            throw new BusinessException(400, "无法读取文件内容");
        }
        if (!magicByteValidator.matches(ext, head)) {
            throw new BusinessException(400, "文件内容与扩展名不符，请确认是真实图片");
        }

        // 5) 落盘（仅用服务端 UUID 命名，杜绝路径注入）+ 压缩与缩略图生成
        //    9-10：原图直出改为「限长边压缩 + 生成 _t 缩略图」，列表页封面走缩略图，省流量省首屏
        String baseName = UUID.randomUUID().toString().replace("-", "");
        ImageOptimizer.Result optimized;
        try {
            Path dir = Paths.get(uploadDir).toAbsolutePath().normalize();
            Files.createDirectories(dir);
            // 防目录穿越：解析后必须仍位于上传目录内
            Path target = dir.resolve(baseName).normalize();
            if (!target.startsWith(dir)) {
                throw new BusinessException(400, "非法文件名");
            }
            // 原始文件先落到临时名，再由优化器决定最终文件名与格式
            Path tmp = dir.resolve(baseName + ".upload.tmp");
            file.transferTo(tmp.toFile());
            try {
                optimized = imageOptimizer.optimize(tmp, ext, dir, baseName);
            } finally {
                Files.deleteIfExists(tmp);
            }
        } catch (IOException e) {
            throw new BusinessException(500, "文件保存失败：" + e.getMessage());
        }

        log.info("[upload] 图片处理完成 原={}KB 存={}KB 主图={} 缩略图={}",
                optimized.originalBytes() / 1024, optimized.storedBytes() / 1024,
                optimized.mainFilename(), optimized.hasThumb() ? optimized.thumbFilename() : "无");

        String url = urlPrefix + "/" + optimized.mainFilename();
        return Result.success(url);
    }
}