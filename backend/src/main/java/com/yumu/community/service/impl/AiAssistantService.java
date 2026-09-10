package com.yumu.community.service.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yumu.community.cache.CacheService;
import com.yumu.community.config.AiAssistantProperties;
import com.yumu.community.dto.AiChatMessage;
import com.yumu.community.entity.Game;
import com.yumu.community.service.DailyPickService;
import com.yumu.community.service.GameService;
import com.yumu.community.service.NoticeService;
import com.yumu.community.service.PostService;
import com.yumu.community.vo.AnnouncementVO;
import com.yumu.community.vo.PostVO;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 社区智能助手：后端代理大模型（OpenAI 兼容协议，默认 DeepSeek），把回复以 SSE 增量推给前端面板。
 *
 * <p>架构（2026-09-10 由扣子 Coze 改为直连 LLM）：
 * <pre>
 * 前端 fetch POST /api/ai/chat  →  本服务  →  POST {LLM_BASE_URL}/chat/completions (stream)
 * </pre>
 *
 * <p>设计要点：
 * <ul>
 *   <li><b>密钥只在服务端</b>：API Key 走环境变量 {@code LLM_API_KEY}，前端永远拿不到 —— 无泄露、无 CORS 问题。</li>
 *   <li><b>知识库自持</b>：{@code ai/assistant-prompt.md}（人设+边界+输出规范）与 {@code ai/community-knowledge.md}
 *       （社区规则知识库）打包装进 jar，作为 system 的静态前缀一次性装载，无需向量库 / RAG，也无需第三方平台托管。</li>
 *   <li><b>实时数据注入</b>：每轮把「热门帖/热门游戏/公告/精选」快照拼在 system 末尾，让助手能答社区现状类问题。</li>
 *   <li><b>多轮记忆</b>：按 conversationId 在 {@code CacheService} 里存最近 N 轮（Redis 可用走 Redis，否则进程内），
 *       原先由扣子平台托管历史，现在自持。</li>
 *   <li><b>协议无关</b>：任何 OpenAI 兼容服务（DeepSeek / SiliconFlow / 本地 Ollama）改两个环境变量即可切换。</li>
 *   <li><b>mock 兜底</b>：未配 key 时用同一套实时数据聚合逻辑生成演示回答，便于无 key 也能看 UI。</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiAssistantService {

    private final AiAssistantProperties props;
    private final PostService postService;
    private final GameService gameService;
    private final NoticeService noticeService;
    private final DailyPickService dailyPickService;
    private final CacheService cacheService;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 会话历史在缓存里的 key 前缀 */
    private static final String HISTORY_KEY_PREFIX = "ai:hist:";

    /** 会话历史存活时间：超过这个时间没有新消息就自动清理，避免 Redis 长期堆积 */
    private static final Duration HISTORY_TTL = Duration.ofMinutes(30);

    /** conversationId 允许的最大长度（同时也是 key 注入防护的一部分） */
    private static final int MAX_CONV_ID_LEN = 64;

    /** 资源缺失时的兜底人设，保证助手不会「无人设裸奔」 */
    private static final String DEFAULT_PROMPT =
            "你是「YUMU 游戏社区」的官方专属 AI 助手，负责解答游戏机制与社区玩法问题、引导玩家使用社区功能。"
                    + "社区规则类问题以知识库为准，知识库与实时快照都没有的信息不要编造。语气热情友好，适度用游戏圈用语。";

    /**
     * system 提示的静态部分（人设 + 知识库），启动时装载一次。
     * 放在 system 最前且内容恒定，可命中服务端的 prompt 缓存，降低每轮成本。
     */
    private String staticSystemPrompt = "";

    @PostConstruct
    public void loadStaticPrompt() {
        String prompt = readClasspath("ai/assistant-prompt.md");
        String knowledge = readClasspath("ai/community-knowledge.md");
        StringBuilder sb = new StringBuilder(prompt.isBlank() ? DEFAULT_PROMPT : prompt.trim());
        if (!knowledge.isBlank()) {
            sb.append("\n\n---\n\n# 附录：YUMU 社区知识库（回答社区规则/流程/权限类问题的唯一依据）\n\n")
              .append(knowledge.trim());
        }
        staticSystemPrompt = sb.toString();
        log.info("AI 助手静态提示装载完成：总计 {} 字符（其中知识库 {} 字符）",
                staticSystemPrompt.length(), knowledge.length());
    }

    /** 对话入口：根据配置决定走真实大模型还是本地 mock。 */
    public void streamChat(String userId, String conversationId, String userMessage, SseEmitter emitter) {
        // 会话 ID：前端首轮为空 -> 后端生成并下发；非法值（防缓存 key 注入）一律重新生成
        String convId = sanitizeConvId(conversationId);
        if (convId == null) {
            convId = "c" + UUID.randomUUID().toString().replace("-", "").substring(0, 24);
        }
        // 先下发权威会话 ID：即使后续上游出错，前端也能记住它并继续这段会话
        sendConv(emitter, convId);

        List<AiChatMessage> history = loadHistory(convId);
        boolean useMock = props.isMock() || !props.isEnabled()
                || props.getApiKey() == null || props.getApiKey().isBlank();

        try {
            String answer = useMock
                    ? streamMock(userMessage, emitter)
                    : streamOpenAi(userId, userMessage, history, emitter);
            if (answer != null) {
                if (!answer.isBlank()) {
                    appendHistory(convId, history, userMessage, answer);
                }
                sendDone(emitter);
            }
        } catch (Exception e) {
            log.warn("AI 助手对话异常：conv={}, err={}", convId, e.getMessage());
            sendError(emitter, "助手暂时不可用：" + e.getMessage());
        } finally {
            emitter.complete();
        }
    }

    // ============================================================
    // 真实大模型流式代理（OpenAI 兼容 /chat/completions）
    // ============================================================

    /**
     * 调用 OpenAI 兼容的流式接口。
     *
     * @return 完整回复文本；上游出错时已推送 error 事件并返回 {@code null}
     */
    private String streamOpenAi(String userId, String userMessage,
                                List<AiChatMessage> history, SseEmitter emitter) {
        List<Map<String, Object>> messages = new ArrayList<>();
        // system = 静态前缀（人设+知识库） + 本轮实时快照。静态部分在最前，利于 prompt 缓存。
        messages.add(Map.of("role", "system", "content",
                staticSystemPrompt + "\n\n---\n\n" + buildCommunityContext()));
        for (AiChatMessage h : history) {
            if (h.getRole() == null || h.getContent() == null) continue;
            messages.add(Map.of("role", h.getRole(), "content", h.getContent()));
        }
        messages.add(Map.of("role", "user", "content", userMessage));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", props.getModel());
        body.put("messages", messages);
        body.put("stream", true);
        body.put("temperature", props.getTemperature());
        body.put("max_tokens", props.getMaxTokens());

        String jsonBody;
        try {
            jsonBody = MAPPER.writeValueAsString(body);
        } catch (Exception e) {
            sendError(emitter, "请求序列化失败：" + e.getMessage());
            return null;
        }

        String url = chatCompletionsUrl();
        // HttpClient 按需创建即可：流式调用是长连接，连接池复用意义有限，且配置随环境变量变化。
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(props.getConnectTimeoutSeconds()))
                .build();
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Authorization", "Bearer " + props.getApiKey())
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .timeout(Duration.ofSeconds(props.getReadTimeoutSeconds()))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                .build();

        log.debug("AI 调用上游：url={}, model={}, user={}, messages={}",
                url, props.getModel(), userId, messages.size());

        try {
            HttpResponse<InputStream> resp = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (resp.statusCode() != 200) {
                String err = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
                log.warn("AI 上游返回 {}：{}", resp.statusCode(), truncate(err, 500));
                sendError(emitter, upstreamErrorMessage(resp.statusCode(), err));
                return null;
            }

            StringBuilder full = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    // SSE 规范：只看 data: 行；event:/id:/空行忽略
                    if (line.isEmpty() || !line.startsWith("data:")) continue;
                    String data = line.substring(5).strip();
                    if (data.isEmpty()) continue;
                    if ("[DONE]".equals(data)) break;
                    try {
                        JsonNode node = MAPPER.readTree(data);
                        String text = extractDeltaText(node);
                        if (!text.isEmpty()) {
                            full.append(text);
                            sendDelta(emitter, text);
                        }
                    } catch (Exception ignore) {
                        // 单条事件解析失败不影响整体流
                    }
                }
            }
            return full.toString();
        } catch (IOException e) {
            log.warn("与 AI 上游通信失败：{}", e.getMessage());
            sendError(emitter, "与助手服务通信失败：" + e.getMessage());
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            sendError(emitter, "对话被中断");
            return null;
        }
    }

    /**
     * 从 OpenAI 兼容的流式分片中取出增量文本：{@code choices[0].delta.content}。
     * 说明：思考型模型（如 deepseek-reasoner）会先推 {@code delta.reasoning_content} 思维链，
     * 这里刻意不取 —— 前端面板只展示最终回答。
     */
    private String extractDeltaText(JsonNode node) {
        JsonNode choices = node.get("choices");
        if (choices == null || !choices.isArray() || choices.isEmpty()) return "";
        JsonNode delta = choices.get(0).get("delta");
        if (delta == null || delta.isNull()) return "";
        JsonNode content = delta.get("content");
        return content == null || content.isNull() ? "" : content.asText("");
    }

    /** 把上游的报错翻译成用户能看懂的一句话，避免把整段 JSON 糊到面板上。 */
    private String upstreamErrorMessage(int status, String raw) {
        String hint;
        if (status == 401 || status == 403) {
            hint = "API Key 无效或已过期，请检查 LLM_API_KEY";
        } else if (status == 402) {
            hint = "账户余额不足，请到模型平台充值";
        } else if (status == 429) {
            hint = "上游模型限流，请稍后再试";
        } else if (status >= 500) {
            hint = "上游模型服务异常";
        } else {
            hint = "上游返回异常";
        }
        return "助手服务出错（" + hint + "）：" + truncate(raw, 200);
    }

    /** 拼接 chat/completions 地址；允许 LLM_BASE_URL 直接配成完整端点。 */
    private String chatCompletionsUrl() {
        String base = props.getBaseUrl() == null ? "" : props.getBaseUrl().trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        if (base.isEmpty()) base = "https://api.deepseek.com/v1";
        return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
    }

    // ============================================================
    // 会话历史（自持，替代扣子的 auto_save_history）
    // ============================================================
    private List<AiChatMessage> loadHistory(String convId) {
        try {
            List<AiChatMessage> cached = cacheService.getList(HISTORY_KEY_PREFIX + convId, AiChatMessage.class);
            if (cached != null && !cached.isEmpty()) return new ArrayList<>(cached);
        } catch (Exception e) {
            log.debug("读取会话历史失败（忽略，按新会话处理）：{}", e.getMessage());
        }
        return new ArrayList<>();
    }

    private void appendHistory(String convId, List<AiChatMessage> history, String userMessage, String answer) {
        try {
            List<AiChatMessage> next = new ArrayList<>(history);
            next.add(new AiChatMessage("user", userMessage));
            next.add(new AiChatMessage("assistant", answer));
            // 只保留最近 maxHistoryTurns 轮（1 轮 = 一问一答）
            int maxMessages = Math.max(2, props.getMaxHistoryTurns() * 2);
            if (next.size() > maxMessages) {
                next = new ArrayList<>(next.subList(next.size() - maxMessages, next.size()));
            }
            cacheService.put(HISTORY_KEY_PREFIX + convId, next, HISTORY_TTL);
        } catch (Exception e) {
            log.debug("写入会话历史失败（不影响本轮回答）：{}", e.getMessage());
        }
    }

    /** conversationId 白名单校验：只接受长度 1~64 的 [A-Za-z0-9_-]，非法值返回 null 由调用方重生成。 */
    private String sanitizeConvId(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty() || s.length() > MAX_CONV_ID_LEN) return null;
        return s.matches("[A-Za-z0-9_-]+") ? s : null;
    }

    // ============================================================
    // 本地 mock 模式（无 key 也能演示）
    // ============================================================
    private String streamMock(String userMessage, SseEmitter emitter) {
        String answer = buildMockAnswer(userMessage);
        try {
            int i = 0;
            while (i < answer.length()) {
                int end = Math.min(answer.length(), i + 3);
                sendDelta(emitter, answer.substring(i, end));
                i = end;
                Thread.sleep(12);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return answer;
    }

    // ============================================================
    // 社区实时数据快照（拼进 system，mock 复用）
    // ============================================================
    public String buildCommunityContext() {
        StringBuilder sb = new StringBuilder();
        sb.append("【社区实时数据快照】（每轮动态注入，仅用于回答「社区现状」类问题；")
          .append("可适当引用但不要整段复述，且严禁编造快照之外的任何统计数据）\n");

        try {
            List<PostVO> hot = postService.listHotPosts(5);
            if (hot != null && !hot.isEmpty()) {
                sb.append("【热门帖子】\n");
                for (PostVO p : hot) {
                    sb.append("- 《").append(p.getTitle()).append("》")
                      .append(p.getGameName() != null ? "（" + p.getGameName() + "）" : "")
                      .append(" 赞").append(p.getLikeCount()).append(" 回").append(p.getReplyCount()).append("\n");
                }
            }
        } catch (Exception ignore) {}

        try {
            List<Game> games = gameService.listHotGames(8);
            if (games != null && !games.isEmpty()) {
                sb.append("\n【热门游戏】\n");
                for (Game g : games) sb.append("- ").append(g.getName()).append("\n");
            }
        } catch (Exception ignore) {}

        try {
            List<AnnouncementVO> anns = noticeService.listActive(5);
            if (anns != null && !anns.isEmpty()) {
                sb.append("\n【最新公告】\n");
                for (AnnouncementVO a : anns) sb.append("- ").append(a.getTitle()).append("\n");
            }
        } catch (Exception ignore) {}

        try {
            List<PostVO> daily = dailyPickService.listPicks(1, LocalDate.now(), null);
            if (daily != null && !daily.isEmpty()) {
                sb.append("\n【今日精选】\n");
                for (PostVO p : daily) sb.append("- 《").append(p.getTitle()).append("》\n");
            }
        } catch (Exception ignore) {}

        return sb.toString();
    }

    private String buildMockAnswer(String userMessage) {
        StringBuilder sb = new StringBuilder();
        sb.append("## 你好，我是 YUMU 游戏社区智能助手 🤖\n\n");
        sb.append("我可以帮你解答 **社区玩法**（怎么发帖 / 怎么当版主 / 签到积分规则 / 举报与审核等）")
          .append("以及 **游戏咨询**。你刚才问的是：\n\n> ").append(userMessage).append("\n\n");
        sb.append("**📊 社区实时动态（来自数据库）**\n\n");

        try {
            List<PostVO> hot = postService.listHotPosts(5);
            if (hot != null && !hot.isEmpty()) {
                sb.append("**热门帖子**\n");
                for (int i = 0; i < hot.size(); i++) {
                    PostVO p = hot.get(i);
                    sb.append("- 《").append(p.getTitle()).append("》")
                      .append(p.getGameName() != null ? "（" + p.getGameName() + "）" : "").append("\n");
                }
                sb.append("\n");
            }
            List<Game> games = gameService.listHotGames(6);
            if (games != null && !games.isEmpty()) {
                sb.append("**热门游戏**：");
                for (int i = 0; i < games.size(); i++) {
                    sb.append(games.get(i).getName()).append(i < games.size() - 1 ? "、" : "");
                }
                sb.append("\n\n");
            }
            List<AnnouncementVO> anns = noticeService.listActive(3);
            if (anns != null && !anns.isEmpty()) {
                sb.append("**最新公告**\n");
                for (AnnouncementVO a : anns) sb.append("- ").append(a.getTitle()).append("\n");
                sb.append("\n");
            }
        } catch (Exception ignore) {}

        sb.append("> 💡 当前为 **本地模拟模式**（未配置大模型 API Key）。设置环境变量 ")
          .append("`LLM_API_KEY`（可选 `LLM_BASE_URL` / `LLM_MODEL`）后重启后端，")
          .append("我会切换为真实大模型回答，并结合知识库与实时快照作答。\n");
        return sb.toString();
    }

    // ============================================================
    // SSE 发送辅助
    // ============================================================
    private void sendDelta(SseEmitter e, String content) {
        send(e, Map.of("type", "delta", "content", content));
    }

    private void sendConv(SseEmitter e, String conversationId) {
        send(e, Map.of("type", "conv", "conversationId", conversationId));
    }

    private void sendDone(SseEmitter e) {
        send(e, Map.of("type", "done"));
    }

    private void sendError(SseEmitter e, String message) {
        send(e, Map.of("type", "error", "message", message));
    }

    private void send(SseEmitter e, Object obj) {
        try {
            e.send(SseEmitter.event().data(obj));
        } catch (IOException | IllegalStateException ignore) {
            // 客户端已断开，静默忽略
        }
    }

    private String truncate(String s, int max) {
        return s == null ? "" : (s.length() <= max ? s : s.substring(0, max) + "…");
    }

    /** 读取 classpath 文本资源；失败返回空串（由调用方兜底），不阻断应用启动。 */
    private String readClasspath(String path) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("读取 AI 资源失败：{}（{}）", path, e.getMessage());
            return "";
        }
    }

    /** 生成一个稳定的匿名用户 ID（前端未登录时使用）。 */
    public static String randomUserId() {
        return "anon-" + ThreadLocalRandom.current().nextLong(100000, 999999);
    }
}
