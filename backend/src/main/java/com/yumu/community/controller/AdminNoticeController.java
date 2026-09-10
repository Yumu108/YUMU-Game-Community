package com.yumu.community.controller;

import com.yumu.community.common.AuditActions;
import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.AnnouncementRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.AuditLogService;
import com.yumu.community.service.NoticeService;
import com.yumu.community.vo.AnnouncementVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 后台管理：公告 CRUD。仅 ADMIN 可访问。
 * 路径前缀 /admin/announcements。
 */
@RestController
@RequestMapping("/admin/announcements")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminNoticeController {

    private final NoticeService noticeService;
    /** 只读旁路：管理动作留痕，写失败不阻断业务。 */
    private final AuditLogService auditLogService;

    @GetMapping
    public Result<PageResult<AnnouncementVO>> list(
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size) {
        return Result.success(noticeService.pageAdmin(current, size));
    }

    @GetMapping("/{id}")
    public Result<AnnouncementVO> detail(@PathVariable Long id) {
        return Result.success(noticeService.getById(id));
    }

    @PostMapping
    public Result<Map<String, Object>> create(
            @Valid @RequestBody AnnouncementRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long id = noticeService.create(req, details.getUserId());
        auditLogService.record(AuditActions.ANNOUNCEMENT_CREATE, AuditActions.TARGET_ANNOUNCEMENT, id,
                "发布公告「" + req.getTitle() + "」");
        return Result.success(Map.of("id", id));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody AnnouncementRequest req) {
        noticeService.update(id, req);
        auditLogService.record(AuditActions.ANNOUNCEMENT_UPDATE, AuditActions.TARGET_ANNOUNCEMENT, id,
                "修改公告 #" + id + "「" + req.getTitle() + "」");
        return Result.success();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        noticeService.delete(id);
        auditLogService.record(AuditActions.ANNOUNCEMENT_DELETE, AuditActions.TARGET_ANNOUNCEMENT, id,
                "删除公告 #" + id);
        return Result.success();
    }

    /**
     * 置顶/取消置顶。
     * Body: { "isTop": true } 表示置顶，false 表示取消。
     * 新接口（v1.2），替代旧的「数字权重排序」体验。
     */
    @PutMapping("/{id}/pin")
    public Result<Void> pin(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        boolean isTop = false;
        if (body != null && body.get("isTop") instanceof Boolean) {
            isTop = (Boolean) body.get("isTop");
        } else if (body != null && body.get("isTop") != null) {
            // 兼容字符串 "true"/"false"
            isTop = Boolean.parseBoolean(String.valueOf(body.get("isTop")));
        }
        noticeService.setTop(id, isTop);
        auditLogService.record(AuditActions.ANNOUNCEMENT_PIN, AuditActions.TARGET_ANNOUNCEMENT, id,
                (isTop ? "置顶公告 #" : "取消置顶公告 #") + id);
        return Result.success();
    }
}