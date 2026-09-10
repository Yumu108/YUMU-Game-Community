package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.DailyPickService;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/picks")
@RequiredArgsConstructor
public class DailyPickController {

    private final DailyPickService dailyPickService;

    @GetMapping("/daily")
    public Result<List<PostVO>> daily(
            @RequestParam(required = false) LocalDate date,
            @AuthenticationPrincipal CustomUserDetails details) {
        LocalDate d = date == null ? LocalDate.now() : date;
        return Result.success(dailyPickService.listPicks(1, d, details != null ? details.getUserId() : null));
    }

    @GetMapping("/weekly")
    public Result<List<PostVO>> weekly(
            @RequestParam(required = false) LocalDate date,
            @AuthenticationPrincipal CustomUserDetails details) {
        LocalDate d = date == null ? LocalDate.now().with(java.time.DayOfWeek.MONDAY) : date;
        return Result.success(dailyPickService.listPicks(2, d, details != null ? details.getUserId() : null));
    }
}
