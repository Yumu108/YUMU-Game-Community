package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.entity.PointsLog;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.PointsService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/points")
@RequiredArgsConstructor
public class PointsController {

    private final PointsService pointsService;

    @PostMapping("/sign-in")
    public Result<Map<String, Object>> signIn(@AuthenticationPrincipal CustomUserDetails details) {
        return Result.success(pointsService.signIn(details.getUserId()));
    }

    @GetMapping("/status")
    public Result<Map<String, Object>> status(@AuthenticationPrincipal CustomUserDetails details) {
        int total = pointsService.getPoints(details.getUserId());
        boolean signed = pointsService.hasSignedToday(details.getUserId());
        return Result.success(Map.of("totalPoints", total, "signedToday", signed));
    }

    @GetMapping("/logs")
    public Result<PageResult<PointsLog>> logs(
            @AuthenticationPrincipal CustomUserDetails details,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "20") long size) {
        return Result.success(pointsService.listLogs(details.getUserId(), current, size));
    }
}
