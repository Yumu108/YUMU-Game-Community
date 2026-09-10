package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.vo.AdminAuditLogVO;

/**
 * 管理员/版主操作审计。
 *
 * 设计原则：**审计写入绝不阻断业务**。审计是旁路能力，不能因为审计表异常
 * 让「封禁用户」这种核心操作失败（内部吞异常并记 error 日志）。
 */
public interface AuditLogService {

    /**
     * 记录一条审计日志。操作人与来源 IP 自动从当前请求上下文解析，无需调用方传入。
     *
     * @param action     动作码，取自 {@link com.yumu.community.common.AuditActions}
     * @param targetType 对象类型，取自 AuditActions.TARGET_*
     * @param targetId   对象 ID（可为 null）
     * @param detail     人类可读描述
     */
    void record(String action, String targetType, Long targetId, String detail);

    /**
     * 分页查询审计日志（时间倒序）。
     *
     * @param action      动作码精确筛选，空=不限
     * @param targetType  对象类型筛选，空=不限
     * @param operator    操作人筛选（昵称模糊 或 user_id 精确），空=不限
     * @param from        起始时间（yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss），空=不限
     * @param to          结束时间，空=不限
     */
    PageResult<AdminAuditLogVO> page(String action, String targetType, String operator,
                                     String from, String to, long current, long size);
}
