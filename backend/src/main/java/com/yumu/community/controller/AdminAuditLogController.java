package com.yumu.community.controller;

import com.yumu.community.common.AuditActions;
import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.service.AuditLogService;
import com.yumu.community.vo.AdminAuditLogVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 管理员操作审计日志查询。**仅 ADMIN**（版主看不到全局审计，避免互相窥探同行操作）。
 */
@RestController
@RequestMapping("/admin/audit-logs")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminAuditLogController {

    private final AuditLogService auditLogService;

    @GetMapping
    public Result<PageResult<AdminAuditLogVO>> list(
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String targetType,
            @RequestParam(required = false) String operator,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size) {
        return Result.success(auditLogService.page(action, targetType, operator, from, to, current, size));
    }

    /**
     * 筛选下拉的选项字典（动作码 + 中文标签）。由后端下发，保证与写库的动作码永远一致。
     */
    @GetMapping("/actions")
    public Result<List<Map<String, String>>> actions() {
        List<Map<String, String>> list = AuditActions.all().stream().map(code -> {
            Map<String, String> m = new LinkedHashMap<>();
            m.put("code", code);
            m.put("label", AuditActions.label(code));
            return m;
        }).toList();
        return Result.success(list);
    }
}
