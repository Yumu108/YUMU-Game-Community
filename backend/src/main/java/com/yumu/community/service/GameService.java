package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.entity.Game;

import java.util.List;

public interface GameService {

    PageResult<Game> pageGames(String keyword, String platform, String genre, long current, long size);

    Game getById(Long id);

    Long createGame(Game game);

    void updateGame(Long id, Game game);

    void deleteGame(Long id);

    void toggleStatus(Long id);

    List<Game> listHotGames(int limit);

    /** 后台管理：返回全部游戏（含已禁用），按 sort/创建时间倒序。 */
    List<Game> listAllGames();

    /**
     * 根据 ID 列表解析为精简 VO（仅展示用字段）。
     * 仅返回 status=0 且 deleted=0 的游戏；按 is_hot DESC, sort ASC, id ASC 排序。
     * 输入 null/空集合时返回空列表；不存在的 ID 会被忽略。
     */
    java.util.List<com.yumu.community.vo.GameMiniVO> resolveGamesByIds(java.util.List<Long> ids);

    void syncPostCount(Long gameId);
}
