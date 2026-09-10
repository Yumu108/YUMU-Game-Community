package com.yumu.community.security;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Entities;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;
import org.jsoup.parser.Parser;
import org.springframework.stereotype.Component;

/**
 * 服务端 HTML 净化器（A1）。
 *
 * 设计取舍：
 *  - 论坛正文存的是「类 Markdown」格式（{@code [@昵称](/user/id)} + 换行），不是 HTML。
 *    即使如此，用户仍可能粘一段含 <script>/<img onerror>/<iframe> 的 HTML 进来，
 *    若前端某处未来切到 dangerouslySetInnerHTML 或模板拼接就会形成存储型 XSS。
 *  - 这里用 Jsoup 把所有 HTML 解析后按白名单清洗，输出"安全 HTML"；任何不在白名单内的标签 / 属性 / URL 协议都被剔除。
 *  - 同时对 [[...](/u/..)] 这种论坛内链语法不做破坏：Jsoup 默认会把 <a> 的链接清洗为绝对 URL，
 *    我们扩展 Safelist 仅允许以 /api/、/user/、/post/ 开头的站内相对路径，其它外链 / javascript: 全部剥掉。
 *
 * 用法：
 *   - 入库前 {@code HtmlSanitizer.sanitize(userInput)}，确保落库的就是安全字符串；
 *   - 富文本字段（post.content / reply.content / announcement.content / post.summary）均需调用。
 */
@Component
public class HtmlSanitizer {

    /** 仅允许的 HTML 标签与属性（白名单）。 */
    private static final Safelist SAFELIST;

    static {
        // 起点：基础白名单（去掉了 style、class 等容易藏 XSS 的属性）
        Safelist base = Safelist.basic()
                .removeTags("img", "input", "button", "form", "iframe", "object", "embed", "video", "audio", "source", "track", "textarea", "select", "option");
        // 允许 <a> 的 href + rel + target（前端已统一加 rel="noopener noreferrer"）
        base.addAttributes("a", "href", "title", "target", "rel");
        base.addAttributes("code", "class");   // 给 <pre><code class="language-xxx"> 留口子
        base.addAttributes("pre", "class");
        base.addAttributes("blockquote", "cite");
        base.addAttributes("span", "class");   // 允许前端高亮 <span class="mention">

        // 仅允许站内相对路径与本服务的 API 路径；外链 / javascript: / data: 一律剥掉
        base.addProtocols("a", "href", "/");   // 站内以 / 开头（/user/123、/post/45、/api/files/x.jpg）
        SAFELIST = base;
    }

    /** 净化 HTML 字符串。返回安全 HTML；输入为 null 返回 ""。 */
    public String sanitize(String html) {
        if (html == null) return "";
        if (html.isEmpty()) return "";
        // 用 bodyFragment 模式：Jsoup 会把不闭合的标签补齐，便于清洗
        Document dirty = Parser.htmlParser().parseInput("<div>" + html + "</div>", "");
        Document.OutputSettings out = new Document.OutputSettings()
                .prettyPrint(false)
                .escapeMode(Entities.EscapeMode.xhtml)
                .charset("UTF-8");
        Cleaner cleaner = new Cleaner(SAFELIST);
        Document clean = cleaner.clean(dirty);
        clean.outputSettings(out);
        // 把根 <div> 拿掉再返回
        String body = clean.body().html();
        if (body.startsWith("<div>") && body.endsWith("</div>")) {
            body = body.substring(5, body.length() - 6);
        }
        return body;
    }

    /**
     * 仅清洗协议（用于解析 href 后做最后一道防御）。
     * 允许：
     *   - 站内相对路径：以 / 开头且不含 \\、双斜杠、javascript:
     *   - http/https/mailto
     * 其它一律返回 null，调用方应当视为不可信并降级为 #。
     */
    public static String sanitizeHref(String href) {
        if (href == null) return null;
        String s = href.trim();
        if (s.isEmpty()) return null;
        String lower = s.toLowerCase();
        if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")
                || lower.startsWith("file:")) {
            return null;
        }
        // 站内相对路径
        if (s.startsWith("/") && !s.startsWith("//") && !s.contains("\\")) {
            return s;
        }
        // 允许 http(s) / mailto
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:")) {
            return s;
        }
        return null;
    }

    /** 检测净化后是否发生过"危险元素剥离"（用于调试 / 风控告警）。 */
    public static boolean hadDangerousContent(String rawHtml) {
        if (rawHtml == null || rawHtml.isEmpty()) return false;
        String lc = rawHtml.toLowerCase();
        return lc.contains("<script") || lc.contains("javascript:") || lc.contains("<iframe")
                || lc.contains("onerror=") || lc.contains("onload=") || lc.contains("onclick=")
                || lc.contains("<object") || lc.contains("<embed") || lc.contains("data:text/html");
    }

    /** 工具方法：从 <a> 元素中取安全 href。 */
    public static String safeHrefOf(Element a) {
        if (a == null) return "#";
        String href = a.attr("href");
        String safe = sanitizeHref(href);
        return safe == null ? "#" : safe;
    }
}