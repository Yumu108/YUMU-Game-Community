package com.yumu.community.service.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yumu.community.config.AiAssistantProperties;
import com.yumu.community.entity.Game;
import com.yumu.community.service.DailyPickService;
import com.yumu.community.service.GameService;
import com.yumu.community.service.NoticeService;
import com.yumu.community.service.PostService;
import com.yumu.community.vo.AnnouncementVO;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
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
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 社区智能助手：后端代理扣子（Coze）Bot API，把大模型回复以 SSE 增量推给前端自定义面板。
 *
 * <p>设计要点：
 * <ul>
 *   <li>token 仅在服务端持有，前端永远拿不到 —— 避免泄露 + CORS 问题。</li>
 *   <li>每轮对话前向扣子注入「社区实时数据快照」（热门帖/热门游戏/公告/精选），让助手能答社区现状类问题。</li>
 *   <li>未配置真实 token 时自动走 mock 模式：用同一套聚合逻辑生成一份带实时数据的演示回答，便于无 token 也能看 UI 效果。</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class AiAssistantService {

    private final AiAssistantProperties props;
    private final PostService postService;
    private final GameService gameService;
    private final NoticeService noticeService;
    private final DailyPickService dailyPickService;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 对话入口：根据配置决定走真实扣子还是本地 mock。 */
    public void streamChat(String userId, String conversationId, String userMessage, SseEmitter emitter) {
        boolean useMock = props.isMock() || !props.isEnabled()
                || props.getApiToken() == null || props.getApiToken().isBlank();
        if (useMock) {
            streamMock(userId, conversationId, userMessage, emitter);
        } else {
            streamCoze(userId, conversationId, userMessage, emitter);
        }
    }

    // ============================================================
    // 真实扣子流式代理
    // ============================================================
    private void streamCoze(String userId, String conversationId, String userMessage, SseEmitter emitter) {
        String grounding = buildCommunityContext();
        String content = grounding + "\n\n用户问题：" + userMessage;

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("bot_id", props.getBotId());
        body.put("user_id", userId);
        body.put("stream", true);
        body.put("auto_save_history", true);
        if (conversationId != null && !conversationId.isBlank()) {
            body.put("conversation_id", conversationId);
        }
        Map<String, String> msg = new LinkedHashMap<>();
        msg.put("role", "user");
        msg.put("content_type", "text");
        msg.put("content", content);
        body.put("additional_messages", List.of(msg));

        String jsonBody;
        try {
            jsonBody = MAPPER.writeValueAsString(body);
        } catch (Exception e) {
            sendError(emitter, "请求序列化失败：" + e.getMessage());
            return;
        }

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(props.getBaseUrl()))
                .header("Authorization", "Bearer " + props.getApiToken())
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                .build();

        try {
            HttpResponse<InputStream> resp = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (resp.statusCode() != 200) {
                String err = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
                sendError(emitter, "扣子接口返回 " + resp.statusCode() + "：" + truncate(err, 300));
                return;
            }

            String convId = (conversationId == null || conversationId.isBlank()) ? null : conversationId;
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (!line.startsWith("data:")) continue;
                    String data = line.substring(5).strip();
                    if (data.isEmpty()) continue;
                    try {
                        JsonNode node = MAPPER.readTree(data);
                        if (node.has("conversation_id") && (convId == null || convId.isBlank())) {
                            convId = node.get("conversation_id").asText();
                        }
                        String ev = node.has("event") ? node.get("event").asText("") : "";
                        boolean isDelta = ev.contains("delta")
                                || (ev.isEmpty() && node.has("delta"));
                        if (isDelta) {
                            String text = extractContent(node);
                            if (!text.isEmpty()) sendDelta(emitter, text);
                        }
                    } catch (Exception ignore) {
                        // 单条事件解析失败不影响整体流
                    }
                }
            }
            if (convId != null && !convId.isBlank()) sendConv(emitter, convId);
            sendDone(emitter);
        } catch (IOException e) {
            sendError(emitter, "与扣子服务通信失败：" + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            sendError(emitter, "对话被中断");
        } finally {
            emitter.complete();
        }
    }

    /** 从扣子事件节点中提取增量文本，兼容多种返回形态。 */
    private String extractContent(JsonNode node) {
        if (node.has("data") && node.get("data").has("content")) {
            return node.get("data").get("content").asText("");
        }
        if (node.has("content")) return node.get("content").asText("");
        if (node.has("delta") && node.get("delta").has("content")) {
            return node.get("delta").get("content").asText("");
        }
        return "";
    }

    // ============================================================
    // 本地 mock 模式（无 token 也能演示）
    // ============================================================
    private void streamMock(String userId, String conversationId, String userMessage, SseEmitter emitter) {
        String answer = buildMockAnswer(userMessage);
        try {
            int i = 0;
            while (i < answer.length()) {
                int end = Math.min(answer.length(), i + 3);
                sendDelta(emitter, answer.substring(i, end));
                i = end;
                Thread.sleep(12);
            }
            if (conversationId == null || conversationId.isBlank()) {
                sendConv(emitter, "mock-" + System.currentTimeMillis());
            }
            sendDone(emitter);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            emitter.complete();
        }
    }

    // ============================================================
    // 社区实时数据快照（注入给大模型 / mock 复用）
    // ============================================================
    public String buildCommunityContext() {
        StringBuilder sb = new StringBuilder();
        sb.append("你是 YUMU 游戏社区（一个面向年轻玩家的游戏讨论论坛）的智能助手。")
          .append("以下是社区当前的部分实时数据，仅用于回答用户关于社区现状的问题，")
          .append("不要原样复述，也不要编造超出这些范围的数据：\n\n");

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

        sb.append("\n如果用户问的是社区功能/玩法（如怎么发帖、怎么当版主、签到积分规则等），")
          .append("请基于你已配置的知识库作答；如果问的是上述实时数据，请基于以上快照作答。\n");
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
                    sb.append((i + 1)).append(". 《").append(p.getTitle()).append("》")
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

        sb.append("> 💡 当前为 **本地模拟模式**（未接入扣子 API）。在扣子后台创建智能体并配置 ")
          .append("`COZE_API_TOKEN` / `COZE_BOT_ID` 后，我会切换为真实大模型回答，")
          .append("并能结合你上传的知识库作答。\n");
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

    /** 生成一个稳定的匿名用户 ID（前端未登录时使用）。 */
    public static String randomUserId() {
        return "anon-" + ThreadLocalRandom.current().nextLong(100000, 999999);
    }
}
