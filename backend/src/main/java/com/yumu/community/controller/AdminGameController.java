package com.yumu.community.controller;

import com.yumu.community.common.AuditActions;
import com.yumu.community.common.Result;
import com.yumu.community.entity.Game;
import com.yumu.community.service.AuditLogService;
import com.yumu.community.service.GameService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/admin/games")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminGameController {

    private final GameService gameService;
    /** 只读旁路：管理动作留痕，写失败不阻断业务。 */
    private final AuditLogService auditLogService;

    /** 管理后台：列出全部游戏（含禁用），用于编辑/启停。 */
    @GetMapping
    public Result<Object> listAll() {
        return Result.success(gameService.listAllGames());
    }

    @PostMapping
    public Result<Object> create(@RequestBody Game game) {
        Long id = gameService.createGame(game);
        auditLogService.record(AuditActions.GAME_CREATE, AuditActions.TARGET_GAME, id,
                "新增游戏「" + game.getName() + "」");
        return Result.success(Map.of("id", id));
    }

    @PutMapping("/{id}")
    public Result<Object> update(@PathVariable Long id, @RequestBody Game game) {
        gameService.updateGame(id, game);
        auditLogService.record(AuditActions.GAME_UPDATE, AuditActions.TARGET_GAME, id,
                "修改游戏 #" + id + "「" + game.getName() + "」");
        return Result.success(Map.of("id", id));
    }

    @DeleteMapping("/{id}")
    public Result<Object> delete(@PathVariable Long id) {
        gameService.deleteGame(id);
        auditLogService.record(AuditActions.GAME_DELETE, AuditActions.TARGET_GAME, id, "删除游戏 #" + id);
        return Result.success(Map.of("id", id));
    }

    @PostMapping("/{id}/toggle-status")
    public Result<Object> toggleStatus(@PathVariable Long id) {
        gameService.toggleStatus(id);
        auditLogService.record(AuditActions.GAME_STATUS, AuditActions.TARGET_GAME, id,
                "切换游戏 #" + id + " 的启用状态");
        return Result.success(Map.of("id", id));
    }
}
