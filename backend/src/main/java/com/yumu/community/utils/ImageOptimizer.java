package com.yumu.community.utils;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;

/**
 * 图片压缩 + 缩略图生成（纯 JDK ImageIO 实现，不引入额外依赖）。
 *
 * 背景（9-10 第二梯队·性能优化）：
 *  原实现"原图直出"——手机相册一张 4000×3000 的照片动辄 3~8MB，列表页封面直接加载原图，
 *  移动端流量和首屏速度都很吃亏。
 *
 * 策略：
 *  1) 主图：长边超过 maxWidth 时等比缩到 maxWidth；照片类（jpg/bmp）统一按 jpegQuality 重编码。
 *  2) 缩略图：长边缩到 thumbWidth，命名 {base}_t.{ext}，供列表页封面使用（前端按约定拼 URL）。
 *  3) 不处理的格式：GIF（动图重编码会丢帧）、WEBP（JDK 内置 ImageIO 不支持读取）→ 原样保存、不生成缩略图。
 *     BMP 体积巨大且无透明通道需求，主图统一转 JPG。
 *
 * 线程安全：无共享可变状态（配置项为 final 注入），可单例使用。
 */
@Component
public class ImageOptimizer {

    /** 长边上限（超过则等比缩小）。 */
    @Value("${yumu.upload.max-width:1920}")
    private int maxWidth;

    /** 缩略图长边。 */
    @Value("${yumu.upload.thumb-width:480}")
    private int thumbWidth;

    /** JPEG 编码质量（0~1）。 */
    @Value("${yumu.upload.jpeg-quality:0.85}")
    private float jpegQuality;

    /** 缩略图 JPEG 质量。 */
    @Value("${yumu.upload.thumb-quality:0.8}")
    private float thumbQuality;

    /** 主图直接保留原样（不重编码、不生成缩略图）的格式。 */
    private static final Set<String> PASSTHROUGH = Set.of("gif", "webp");
    /** 可读且可按 JPEG 重编码的格式。 */
    private static final Set<String> READABLE = Set.of("jpg", "jpeg", "png", "bmp");

    /** 处理结果：主图/缩略图文件名 + 体积统计（用于日志）。 */
    public record Result(String mainFilename, String thumbFilename, long originalBytes, long storedBytes) {
        /** 是否生成了缩略图。 */
        public boolean hasThumb() {
            return thumbFilename != null;
        }
    }

    /**
     * 优化并落盘。
     *
     * @param tmp      已落盘的原始上传文件（临时名）
     * @param ext      扩展名（小写，已通过白名单校验）
     * @param dir      上传根目录
     * @param baseName 服务端生成的 UUID（不含扩展名，防路径注入）
     * @return 处理结果；主图文件名与缩略图文件名（若无缩略图为 null）
     */
    public Result optimize(Path tmp, String ext, Path dir, String baseName) throws IOException {
        long originalBytes = Files.size(tmp);
        String lower = ext.toLowerCase(Locale.ROOT);

        // GIF / WEBP：不重编码（动图丢帧 / JDK 不支持读），原样保存
        if (PASSTHROUGH.contains(lower) || !READABLE.contains(lower)) {
            String name = baseName + "." + lower;
            moveAtomically(tmp, dir.resolve(name));
            return new Result(name, null, originalBytes, originalBytes);
        }

        BufferedImage src;
        try {
            src = ImageIO.read(tmp.toFile());
        } catch (IOException e) {
            src = null;
        }
        if (src == null) {
            // 读不出来（损坏 / 特殊编码）→ 保底原样保存，不让上传失败
            String name = baseName + "." + lower;
            moveAtomically(tmp, dir.resolve(name));
            return new Result(name, null, originalBytes, originalBytes);
        }

        boolean isPng = "png".equals(lower);
        // BMP 体积大且无透明诉求 → 主图转 JPG，压缩收益最大
        String mainExt = ("bmp".equals(lower)) ? "jpg" : ("jpeg".equals(lower) ? "jpg" : lower);
        String mainName = baseName + "." + mainExt;

        // 1) 主图：仅在超过长边上限时缩放
        BufferedImage mainImg = src;
        if (Math.max(src.getWidth(), src.getHeight()) > maxWidth) {
            mainImg = scaleToLongEdge(src, maxWidth);
        }
        Path mainTarget = dir.resolve(mainName);
        writeAtomically(mainImg, "png".equals(mainExt) ? "png" : "jpeg", mainTarget,
                "png".equals(mainExt) ? 1f : jpegQuality);

        // 2) 缩略图：PNG 保留透明（输出 PNG），其余输出 JPEG
        String thumbName = baseName + "_t." + (isPng ? "png" : "jpg");
        BufferedImage thumbImg = scaleToLongEdge(src, thumbWidth);
        writeAtomically(thumbImg, isPng ? "png" : "jpeg", dir.resolve(thumbName),
                isPng ? 1f : thumbQuality);

        long storedBytes = Files.size(mainTarget);
        return new Result(mainName, thumbName, originalBytes, storedBytes);
    }

    /**
     * 等比缩放到长边 = target。
     * 先用"逐级折半"逼近（避免一次性大幅缩放产生锯齿），再补一次最终缩放到精确尺寸。
     */
    private BufferedImage scaleToLongEdge(BufferedImage src, int target) {
        int w = src.getWidth();
        int h = src.getHeight();
        double ratio = (double) target / Math.max(w, h);
        if (ratio >= 1.0) {
            return src;
        }
        int dstW = Math.max(1, (int) Math.round(w * ratio));
        int dstH = Math.max(1, (int) Math.round(h * ratio));

        // 逐级折半到不小于目标尺寸，最后一步精确缩放
        BufferedImage current = src;
        while (current.getWidth() / 2 >= dstW && current.getHeight() / 2 >= dstH) {
            current = draw(current, Math.max(1, current.getWidth() / 2), Math.max(1, current.getHeight() / 2));
        }
        return draw(current, dstW, dstH);
    }

    private BufferedImage draw(BufferedImage src, int w, int h) {
        int type = src.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage dst = new BufferedImage(w, h, type);
        Graphics2D g = dst.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.drawImage(src, 0, 0, w, h, null);
        } finally {
            g.dispose();
        }
        return dst;
    }

    /** JPEG 不支持透明通道：有 alpha 时先铺白底再转 RGB。 */
    private BufferedImage toRgbIfNeeded(BufferedImage src) {
        if (!src.getColorModel().hasAlpha()) {
            return src;
        }
        BufferedImage rgb = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = rgb.createGraphics();
        try {
            g.setColor(java.awt.Color.WHITE);
            g.fillRect(0, 0, src.getWidth(), src.getHeight());
            g.drawImage(src, 0, 0, null);
        } finally {
            g.dispose();
        }
        return rgb;
    }

    /** 带质量参数的编码并原子落盘（先写 .tmp 再 move，避免半截文件被读到）。 */
    private void writeAtomically(BufferedImage img, String format, Path target, float quality) throws IOException {
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        if ("jpeg".equals(format)) {
            BufferedImage rgb = toRgbIfNeeded(img);
            Iterator<ImageWriter> it = ImageIO.getImageWritersByFormatName("jpeg");
            if (!it.hasNext()) {
                ImageIO.write(rgb, "jpg", tmp.toFile());
            } else {
                ImageWriter writer = it.next();
                ImageWriteParam param = writer.getDefaultWriteParam();
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                param.setCompressionQuality(quality);
                try (ImageOutputStream os = ImageIO.createImageOutputStream(tmp.toFile())) {
                    writer.setOutput(os);
                    writer.write(null, new IIOImage(rgb, null, null), param);
                } finally {
                    writer.dispose();
                }
            }
        } else {
            ImageIO.write(img, format, tmp.toFile());
        }
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private void moveAtomically(Path from, Path to) throws IOException {
        Files.move(from, to, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
}
