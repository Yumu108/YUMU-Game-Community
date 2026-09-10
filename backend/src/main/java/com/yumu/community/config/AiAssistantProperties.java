package com.yumu.community.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 智能助手（大模型）配置 —— OpenAI 兼容协议，默认直连 DeepSeek。
 *
 * <p>密钥统一走环境变量（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL ...），不进仓库，延续 B4 密钥外置。
 * 任何提供 OpenAI 兼容 {@code /chat/completions} 的服务都可直接切换（SiliconFlow / 本地 Ollama / 通义等），
 * 只需改 {@code LLM_BASE_URL} + {@code LLM_MODEL}，无需改代码。
 */
@Data
@Component
@ConfigurationProperties(prefix = "llm")
public class AiAssistantProperties {

    /** OpenAI 兼容的 API 根地址（不含 /chat/completions）。DeepSeek: https://api.deepseek.com/v1 */
    private String baseUrl = "https://api.deepseek.com/v1";

    /** API Key（sk-xxx），服务端持有，绝不暴露给前端 */
    private String apiKey = "";

    /**
     * 模型名。DeepSeek 现行模型：{@code deepseek-flash}（高性价比，带思维链）/ {@code deepseek-v4-pro}（旗舰）。
     * 注意：flash 会返回 {@code reasoning_content}，其 token 计入 {@code max_tokens}，故上限需留余量。
     */
    private String model = "deepseek-flash";

    /** 未配置真实 key 时启用本地模拟（便于无 key 也能演示 UI 与实时数据注入） */
    private boolean mock = true;

    /** 总开关 */
    private boolean enabled = true;

    /** 采样温度（0~2）。知识库问答偏保守，默认 0.7 */
    private double temperature = 0.7;

    /** 单轮回复最大 token 数（成本护栏）。注意 flash 的思维链 token 也计入此处，故留足余量 */
    private int maxTokens = 2048;

    /**
     * 是否启用模型思考模式（思维链）。
     * <p>DeepSeek V4 系列（含 flash）<b>默认开启</b>思考模式：先产出一段思维链再出正文，
     * 反映到 SSE 上就是先推 {@code delta.reasoning_content}。社区客服式问答基本用不到深度推理，
     * 关掉可显著降低首字延迟、并省下思维链 token（计入费用与 {@code max_tokens}）。
     * 需要复杂推理（如结构化长文）时设为 {@code true} 即可。</p>
     */
    private boolean thinking = false;

    /** 保留的最大多轮记忆轮数（1 轮 = 一问一答），超出丢弃最旧的 */
    private int maxHistoryTurns = 6;

    /** 调用大模型的连接超时（秒） */
    private int connectTimeoutSeconds = 10;

    /** 调用大模型的读超时（秒）；流式场景按「两次数据间隔」计 */
    private int readTimeoutSeconds = 120;
}
