package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.service.NoticeService;
import com.yumu.community.vo.AnnouncementVO;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 公告公开接口：所有人均可访问（无需登录）。
 * - GET /announcements        默认取展示中的最新 5 条
 * - GET /announcements/{id}   详情（含已隐藏的；公开访问不挡，便于内部 ID 直链）
 *
 * 创建/编辑/删除 在 AdminNoticeController（仅 ADMIN）。
 */
@RestController
@RequestMapping("/announcements")
@RequiredArgsConstructor
public class NoticeController {

    private final NoticeService noticeService;

    @GetMapping
    public Result<List<AnnouncementVO>> list(
            @RequestParam(defaultValue = "5") int size) {
        return Result.success(noticeService.listActive(size));
    }

    @GetMapping("/{id}")
    public Result<AnnouncementVO> detail(@PathVariable Long id) {
        return Result.success(noticeService.getById(id));
    }
}