package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.dto.SubmitReportRequest;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.ReportService;
import com.yumu.community.vo.ReportVO;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 举报接口：任意登录用户均可提交举报。
 */
@RestController
@RequestMapping("/reports")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;

    @PostMapping
    public Result<Map<String, Object>> submit(
            @Valid @RequestBody SubmitReportRequest req,
            @AuthenticationPrincipal CustomUserDetails details) {
        Long id = reportService.submit(req, details.getUserId());
        return Result.success(Map.of("id", id));
    }

    /**
     * C2：我的举报列表（举报闭环）—— 当前用户可查看自己举报的处理状态。
     * status：null 全部 / 0 待处理 / 1 已处理(违规) / 2 已驳回。
     */
    @GetMapping("/mine")
    public Result<PageResult<ReportVO>> mine(
            @RequestParam(required = false) Integer status,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(reportService.listMine(details.getUserId(), status, current, size));
    }
}
