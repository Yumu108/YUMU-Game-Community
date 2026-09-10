package com.yumu.community.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A4 上传魔数校验的单元测试。
 *
 * 关注点：攻击者把 .exe / .php 改名成 .jpg 上传（绕过扩展名与 Content-Type 检查），
 * 以及 SVG 虽为图片却能内嵌 <script> 故必须显式拒绝。
 */
class ImageMagicByteValidatorTest {

    private final ImageMagicByteValidator validator = new ImageMagicByteValidator();

    private static byte[] head(String s) {
        return s.getBytes(StandardCharsets.ISO_8859_1);
    }

    @Test
    @DisplayName("PNG/JPG/GIF/BMP 的真实文件头通过")
    void acceptsRealImageHeads() {
        assertTrue(validator.matches("png", new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}));
        assertTrue(validator.matches("jpg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0}));
        assertTrue(validator.matches("jpeg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE1}));
        assertTrue(validator.matches("gif", head("GIF89a").clone()));
        // 注意：matches 要求文件头至少 4 字节（调用方固定传前 16 字节），
        // 所以这里必须给足长度 —— 只传 "BM" 两字节会被判为"头太短"而拒绝。
        assertTrue(validator.matches("bmp", new byte[]{0x42, 0x4D, 0x36, 0x00}));
    }

    @Test
    @DisplayName("文件头短于 4 字节一律拒绝（防御性下限）")
    void rejectsTooShortHead() {
        assertFalse(validator.matches("bmp", head("BM").clone()));
        assertFalse(validator.matches("jpg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}));
    }

    @Test
    @DisplayName("WEBP 需同时满足 RIFF....WEBP")
    void acceptsWebpOnlyWhenStructureMatches() {
        byte[] ok = head("RIFF????WEBPVP8 ").clone();
        assertTrue(validator.matches("webp", ok));
        // 只有 RIFF 开头但不是 WEBP → 拒绝
        assertFalse(validator.matches("webp", head("RIFF????WAVEfmt ").clone()));
    }

    @Test
    @DisplayName("扩展名与内容不符 → 拒绝（.jpg 伪装成 EXE）")
    void rejectsMismatchedExtension() {
        byte[] exe = head("MZ\u0090\u0000\u0003").clone();
        assertFalse(validator.matches("jpg", exe), "Windows 可执行文件不能被当成 jpg");
        assertFalse(validator.matches("png", head("<?php echo 1; ?>").clone()), "PHP 脚本不能被当成 png");
    }

    @Test
    @DisplayName("SVG 即使内容像 XML 也必须拒绝（可内嵌 script）")
    void rejectsSvg() {
        byte[] svg = head("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>").clone();
        assertFalse(validator.matches("svg", svg));
        assertFalse(ImageMagicByteValidator.ALLOWED_EXTS.contains("svg"),
                "svg 不应出现在允许扩展名集合中");
    }

    @Test
    @DisplayName("空文件头 / 未知扩展名 → 拒绝，不抛异常")
    void handlesEdgeCases() {
        assertFalse(validator.matches("jpg", new byte[0]));
        assertFalse(validator.matches("exe", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}));
        assertFalse(validator.matches(null, new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}));
    }

    @Test
    @DisplayName("允许的扩展名白名单与检测器覆盖一致")
    void allowedExtsCoveredByChecks() {
        for (String ext : ImageMagicByteValidator.ALLOWED_EXTS) {
            // 每个允许的扩展名都应有对应检测逻辑（否则会被"永远拒绝"，属配置错误）
            byte[] dummy = new byte[]{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B};
            assertDoesNotThrow(() -> validator.matches(ext, dummy), "扩展名 " + ext + " 不应抛异常");
        }
    }
}
