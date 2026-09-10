package com.yumu.community.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 智能助手（扣子 Coze）配置。
 * 密钥统一走环境变量（COZE_API_TOKEN / COZE_BOT_ID / COZE_BASE_URL），不进仓库，顺带完成 B4 密钥外置。
 */
@Data
@Component
@ConfigurationProperties(prefix = "coze")
public class AiAssistantProperties {

    /** 扣子对话接口地址；国际版用 https://api.coze.com/v3/chat */
    private String baseUrl = "https://api.coze.cn/v3/chat";

    /** 个人访问令牌（PAT），服务端持有，绝不暴露给前端 */
    private String apiToken = "";

    /** 智能体 ID */
    private String botId = "";

    /** 未配置真实 token 时启用本地模拟（便于无 token 也能演示 UI 与实时数据注入） */
    private boolean mock = true;

    /** 总开关 */
    private boolean enabled = true;
}
