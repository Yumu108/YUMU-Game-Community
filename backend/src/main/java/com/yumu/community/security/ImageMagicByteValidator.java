package com.yumu.community.security;

import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * A4：图片魔数校验。
 *
 * 攻击者常把可执行文件（如 PHP/EXE/JSP）改名 jpg 绕过 ContentType / 扩展名检查。
 * 这里按文件头 magic bytes 做最终校验：
 *  - JPG : FF D8 FF
 *  - PNG : 89 50 4E 47 0D 0A 1A 0A
 *  - GIF : 47 49 46 38 (37/39 61)
 *  - WEBP: "RIFF" .... "WEBP"
 *  - BMP  : 42 4D
 *
 * 注意：SVG 虽然是图片格式，但允许 <script>，故显式拒绝。
 */
@Component
public class ImageMagicByteValidator {

    /** 允许的图片格式 → 魔数头检测器。 */
    private static final Map<String, MagicCheck> CHECKS = new HashMap<>();
    static {
        CHECKS.put("jpg", MagicCheck.of(new byte[]{(byte)0xFF, (byte)0xD8, (byte)0xFF}));
        CHECKS.put("jpeg", CHECKS.get("jpg"));
        CHECKS.put("png", MagicCheck.of(new byte[]{(byte)0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}));
        CHECKS.put("gif", MagicCheck.of(new byte[]{0x47, 0x49, 0x46, 0x38}));
        CHECKS.put("webp", new MagicCheck() {
            @Override public boolean matches(byte[] head) {
                if (head.length < 12) return false;
                // RIFF????WEBP
                return head[0]=='R' && head[1]=='I' && head[2]=='F' && head[3]=='F'
                        && head[8]=='W' && head[9]=='E' && head[10]=='B' && head[11]=='P';
            }
        });
        CHECKS.put("bmp", MagicCheck.of(new byte[]{0x42, 0x4D}));
    }

    /** 允许的文件扩展名集合（含 jpg/jpeg 别名）。 */
    public static final Set<String> ALLOWED_EXTS = Set.of("jpg", "jpeg", "png", "gif", "webp", "bmp");

    /**
     * 检测文件头的 magic bytes 是否与扩展名一致。
     * @param ext       小写、已通过 ALLOWED_EXTS 白名单（必须调用方先验）
     * @param fileHead  文件前 16 字节
     * @return true 表示通过；false 表示扩展名与内容不符（疑似伪造）
     */
    public boolean matches(String ext, byte[] fileHead) {
        if (ext == null || fileHead == null || fileHead.length < 4) return false;
        MagicCheck check = CHECKS.get(ext);
        return check != null && check.matches(fileHead);
    }

    /** 简单 magic bytes 检测器。 */
    private interface MagicCheck {
        boolean matches(byte[] head);
        static MagicCheck of(byte[] prefix) {
            return head -> {
                if (head.length < prefix.length) return false;
                for (int i = 0; i < prefix.length; i++) {
                    if (head[i] != prefix[i]) return false;
                }
                return true;
            };
        }
    }
}