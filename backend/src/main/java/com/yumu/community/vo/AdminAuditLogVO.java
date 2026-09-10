package com.yumu.community.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 审计日志视图对象（后台展示）。
 * {@code actionLabel} 由后端补全，前端无需维护一份动作码→中文的映射表。
 */
@Data
public class AdminAuditLogVO {

    private Long id;
    private Long operatorId;
    private String operatorName;
    private String action;
    /** 动作的中文标签，如 POST_HIDE → 隐藏帖子。 */
    private String actionLabel;
    private String targetType;
    private Long targetId;
    private String detail;
    private String ip;
    private LocalDateTime createdAt;
}
