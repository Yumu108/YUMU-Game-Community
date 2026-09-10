package com.yumu.community.controller;

import com.yumu.community.common.BusinessException;
import com.yumu.community.dto.AiChatRequest;
import com.yumu.community.security.RateLimiter;
import com.yumu.community.service.impl.AiAssistantService;
import com.yumu.community.utils.RequestUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.concurrent.CompletableFuture;

/**
 * 社区智能助手入口：前端以 fetch 流式 POST 到本端点，后端代理扣子并以 SSE 把增量回复推回。
 * 无需登录（游客也可用）；userId 由前端传入，未传则生成匿名 ID 维持多轮。
 *
 * 成本控制（B5 后续补充）：本端点 permitAll 且每次调用都会消耗扣子 token，
 * 因此必须限频 + 限制单条输入长度，否则任何人写个脚本就能刷爆账单。
 * 限频在返回 SseEmitter 之前同步执行（此时仍在请求线程内，能拿到 IP）；
 * 超限抛 BusinessException → 全局处理器返回 HTTP 200 + code=429 的 JSON，
 * 前端需识别非 SSE 响应并展示 message（见 AiAssistant.vue）。
 */
@RestController
@RequestMapping("/ai")
@RequiredArgsConstructor
public class AiAssistantController {

    private final AiAssistantService aiAssistantService;
    private final RateLimiter rateLimiter;

    /** 单个 IP 每分钟允许的提问次数（yumu.security.rate-limit.ai-per-minute 覆盖）。 */
    @Value("${yumu.security.rate-limit.ai-per-minute:20}")
    private int aiPerMinute;

    /** 单条问题最大字符数：既是输入校验，也是 token 成本上限。 */
    private static final int MAX_MESSAGE_LEN = 2000;

    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chat(@RequestBody AiChatRequest req) {
        // ---- 1) 输入校验（成本保护：超长问题直接拒绝，不进模型） ----
        String message = req == null ? null : req.getMessage();
        if (message == null || message.isBlank()) {
            throw new BusinessException(400, "问题不能为空");
        }
        if (message.length() > MAX_MESSAGE_LEN) {
            throw new BusinessException(400, "问题太长了（上限 " + MAX_MESSAGE_LEN + " 字），请精简后再问");
        }

        // ---- 2) 限频：按 IP 滑动窗口，超限直接 429 ----
        String ip = RequestUtils.clientIp();
        if (!rateLimiter.tryAcquire("ai:ip:" + ip, aiPerMinute, 60)) {
            throw new BusinessException(429,
                    "提问太频繁了，请稍后再试（每个 IP 每分钟 " + aiPerMinute + " 次）");
        }

        // ---- 3) 正常流式返回 ----
        SseEmitter emitter = new SseEmitter(300_000L);
        String userId = (req.getUserId() == null || req.getUserId().isBlank())
                ? AiAssistantService.randomUserId() : req.getUserId();
        CompletableFuture.runAsync(() ->
                aiAssistantService.streamChat(userId, req.getConversationId(), message, emitter));
        emitter.onTimeout(emitter::complete);
        emitter.onError(e -> emitter.complete());
        return emitter;
    }
}
