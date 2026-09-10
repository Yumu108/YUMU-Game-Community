package com.yumu.community.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A1 服务端 HTML 净化的单元测试。
 *
 * 为什么值得单测：净化是「存储型 XSS 的最后一道闸门」，一旦被改坏（例如有人给 Safelist
 * 放开 style/on* 属性）接口测试不会失败——只有真被攻击时才发现。这里用固定 payload 锁行为。
 */
class HtmlSanitizerTest {

    private final HtmlSanitizer sanitizer = new HtmlSanitizer();

    @Test
    @DisplayName("<script> 标签被整体剥离，正常文本保留")
    void stripsScriptTag() {
        String out = sanitizer.sanitize("<script>alert('xss')</script>你好");
        assertFalse(out.contains("<script"), "不应残留 script 标签：" + out);
        assertFalse(out.contains("alert"), "不应残留脚本内容：" + out);
        assertTrue(out.contains("你好"), "正常文本应保留：" + out);
    }

    @Test
    @DisplayName("事件属性（onclick）被剥离，而站内相对 href 必须保留")
    void stripsEventHandlersButKeepsInternalHref() {
        String out = sanitizer.sanitize("<a href=\"/user/1\" onclick=\"steal()\">点我</a>");
        assertFalse(out.toLowerCase().contains("onclick"), "不应残留 onclick：" + out);
        // 回归锁：曾经 addProtocols("a","href","/") 写法不生效，导致站内链接的 href 被整条剥掉
        assertTrue(out.contains("/user/1"), "合法站内 href 必须保留：" + out);
    }

    @Test
    @DisplayName("外链 http(s) 保留；javascript: / data: 协议的 href 被剥掉")
    void keepsSafeSchemesDropsDangerous() {
        String http = sanitizer.sanitize("<a href=\"https://example.com/a\">外链</a>");
        assertTrue(http.contains("https://example.com/a"), "https 外链应保留：" + http);

        for (String bad : new String[]{"javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)"}) {
            String out = sanitizer.sanitize("<a href=\"" + bad + "\">x</a>");
            assertFalse(out.contains(bad), "危险协议必须被剥掉：" + bad + " → " + out);
        }
    }

    @Test
    @DisplayName("img 标签被剥离（本项目图片走 /api/files，不允许内联 <img>）")
    void stripsImgTag() {
        String out = sanitizer.sanitize("<img src=x onerror=alert(1)>");
        assertFalse(out.contains("<img"), "不应残留 img：" + out);
        assertFalse(out.toLowerCase().contains("onerror"), "不应残留 onerror：" + out);
    }

    @Test
    @DisplayName("null / 空串安全返回空串（不抛异常）")
    void handlesNullAndEmpty() {
        assertEquals("", sanitizer.sanitize(null));
        assertEquals("", sanitizer.sanitize(""));
    }

    @Test
    @DisplayName("sanitizeHref：拒绝 javascript: / data: / vbscript: / file:")
    void rejectsDangerousSchemes() {
        assertNull(HtmlSanitizer.sanitizeHref("javascript:alert(1)"));
        assertNull(HtmlSanitizer.sanitizeHref("JavaScript:alert(1)"));
        assertNull(HtmlSanitizer.sanitizeHref("data:text/html;base64,PHNjcmlwdD4="));
        assertNull(HtmlSanitizer.sanitizeHref("vbscript:msgbox(1)"));
        assertNull(HtmlSanitizer.sanitizeHref("file:///etc/passwd"));
    }

    @Test
    @DisplayName("sanitizeHref：放行站内相对路径与 http(s)/mailto")
    void allowsSafeHrefs() {
        assertEquals("/user/123", HtmlSanitizer.sanitizeHref("/user/123"));
        assertEquals("/post/45?replyId=9", HtmlSanitizer.sanitizeHref("/post/45?replyId=9"));
        assertEquals("https://example.com/a.png", HtmlSanitizer.sanitizeHref("https://example.com/a.png"));
        assertEquals("mailto:a@b.com", HtmlSanitizer.sanitizeHref("mailto:a@b.com"));
    }

    @Test
    @DisplayName("sanitizeHref：协议相对地址 //evil.com 与含反斜杠的路径被拒")
    void rejectsProtocolRelativeAndBackslash() {
        assertNull(HtmlSanitizer.sanitizeHref("//evil.com/x"), "// 开头是协议相对地址，必须拒绝");
        assertNull(HtmlSanitizer.sanitizeHref("/user/1\\..\\..\\etc"), "含反斜杠一律拒绝");
    }

    @Test
    @DisplayName("safeHrefOf：非法 href 降级为 #")
    void safeHrefFallsBackToHash() {
        assertEquals("#", HtmlSanitizer.safeHrefOf(null));
        assertEquals("#", HtmlSanitizer.safeHrefOf(org.jsoup.Jsoup.parse("<a href='javascript:x'>a</a>").selectFirst("a")));
    }

    @Test
    @DisplayName("hadDangerousContent：识别常见危险特征")
    void detectsDangerousContent() {
        assertTrue(HtmlSanitizer.hadDangerousContent("<script>a</script>"));
        assertTrue(HtmlSanitizer.hadDangerousContent("<iframe src=x>"));
        assertTrue(HtmlSanitizer.hadDangerousContent("<img onerror=1>"));
        assertFalse(HtmlSanitizer.hadDangerousContent("<p>正常正文</p>"));
        assertFalse(HtmlSanitizer.hadDangerousContent(null));
    }
}
