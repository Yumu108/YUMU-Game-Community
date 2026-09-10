package com.yumu.community.controller;

import com.yumu.community.common.PageResult;
import com.yumu.community.common.Result;
import com.yumu.community.entity.Game;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.GameService;
import com.yumu.community.service.PostService;
import com.yumu.community.vo.ActiveUserVO;
import com.yumu.community.vo.GameModeratorVO;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/games")
@RequiredArgsConstructor
public class GameController {

    private final GameService gameService;
    private final PostService postService;
    private final UserMapper userMapper;

    @GetMapping
    public Result<PageResult<Game>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String platform,
            @RequestParam(required = false) String genre,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "12") long size) {
        return Result.success(gameService.pageGames(keyword, platform, genre, current, size));
    }

    @GetMapping("/{id}")
    public Result<Game> detail(@PathVariable Long id) {
        return Result.success(gameService.getById(id));
    }

    @GetMapping("/hot")
    public Result<List<Game>> hot(@RequestParam(defaultValue = "8") int limit) {
        return Result.success(gameService.listHotGames(limit));
    }

    @GetMapping("/{id}/posts")
    public Result<PageResult<PostVO>> posts(
            @PathVariable Long id,
            @RequestParam(defaultValue = "1") long current,
            @RequestParam(defaultValue = "10") long size,
            @AuthenticationPrincipal CustomUserDetails details) {
        gameService.getById(id); // 校验游戏可见（禁用/删除 → 404）
        Long uid = details != null ? details.getUserId() : null;
        return Result.success(postService.pagePostsByGame(id, current, size, uid));
    }

    /** 某游戏的活跃玩家：按在该游戏下的发帖数降序。公开接口（无需登录）。 */
    @GetMapping("/{id}/active-users")
    public Result<List<ActiveUserVO>> activeUsers(
            @PathVariable Long id,
            @RequestParam(defaultValue = "6") int limit) {
        gameService.getById(id); // 校验游戏可见（禁用/删除 → 404）
        List<ActiveUserVO> list = userMapper.selectActiveUsersByGame(id, limit);
        for (ActiveUserVO u : list) {
            if (u.getActivityLevel() == null) u.setActivityLevel(1);
            u.setActivityTitle(levelTitle(u.getActivityLevel()));
        }
        return Result.success(list);
    }

    /** 某游戏的版主列表：公开接口（无需登录）。boardNames 为逗号串，拆成 boards 列表。 */
    @GetMapping("/{id}/moderators")
    public Result<List<GameModeratorVO>> moderators(@PathVariable Long id) {
        gameService.getById(id); // 校验游戏可见（禁用/删除 → 404）
        List<GameModeratorVO> list = userMapper.selectModeratorsByGame(id);
        for (GameModeratorVO m : list) {
            if (m.getActivityLevel() == null) m.setActivityLevel(1);
            m.setActivityTitle(levelTitle(m.getActivityLevel()));
            if (m.getPostCount() == null) m.setPostCount(0L);
            String bn = m.getBoardNames();
            if (bn == null || bn.isEmpty()) {
                m.setBoards(Collections.emptyList());
            } else {
                m.setBoards(new ArrayList<>(Arrays.asList(bn.split(","))));
            }
            m.setBoardNames(null); //  不下发原始串
        }
        return Result.success(list);
    }

    private static String levelTitle(int level) {
        return switch (level) {
            case 5 -> "🔥传说玩家";
            case 4 -> "💎社区精英";
            case 3 -> "🏅资深玩家";
            case 2 -> "⚔️活跃玩家";
            default -> "🥉初出茅庐";
        };
    }
}
