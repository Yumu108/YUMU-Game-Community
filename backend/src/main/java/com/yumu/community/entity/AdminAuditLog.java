package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理员/版主操作审计日志（只追加，不改写）。
 *
 * 与其它业务实体的差异：
 * - {@code operatorName} 是**操作当时的昵称快照**，即使用户后续改名也能还原历史责任人；
 * - {@code operatorId} 不加外键，用户被删除后审计记录必须保留（审计价值就在于此）；
 * - 正常业务不会 update/delete 本表，{@code deleted} 仅为对齐 BaseEntity 约定。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("admin_audit_log")
public class AdminAuditLog extends BaseEntity {

    private Long operatorId;
    private String operatorName;
    /** 动作码，取值见 {@link com.yumu.community.common.AuditActions}。 */
    private String action;
    /** POST / REPLY / USER / REPORT / ANNOUNCEMENT / GAME */
    private String targetType;
    private Long targetId;
    private String detail;
    private String ip;
}
