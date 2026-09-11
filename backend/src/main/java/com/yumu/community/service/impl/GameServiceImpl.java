package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.entity.Game;
import com.yumu.community.entity.Post;
import com.yumu.community.mapper.GameMapper;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.service.GameService;
import com.yumu.community.vo.GameMiniVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;

@Service
@RequiredArgsConstructor
public class GameServiceImpl implements GameService {

    private final GameMapper gameMapper;
    private final PostMapper postMapper;

    private static long clampCurrent(long current) { return Math.max(1, current); }
    private static long clampSize(long size) { return Math.min(100, Math.max(1, size)); }

    @Override
    public PageResult<Game> pageGames(String keyword, String platform, String genre, long current, long size) {
        Page<Game> page = new Page<>(clampCurrent(current), clampSize(size));
        var qw = Wrappers.<Game>lambdaQuery().eq(Game::getStatus, 0).eq(Game::getDeleted, 0);
        if (keyword != null && !keyword.trim().isEmpty()) {
            qw.and(w -> w.like(Game::getName, keyword.trim())
                    .or()
                    .like(Game::getDescription, keyword.trim()));
        }
        if (platform != null && !platform.isEmpty()) qw.eq(Game::getPlatform, platform);
        if (genre != null && !genre.isEmpty()) qw.eq(Game::getGenre, genre);
        // 9-11：游戏库默认按名称字母（拼音）序排列 —— 取代旧的「热门优先+id倒序」，人工 sort 字段不再参与排序
        qw.last("ORDER BY name COLLATE utf8mb4_zh_0900_as_cs ASC");
        Page<Game> res = gameMapper.selectPage(page, qw);
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), res.getRecords());
    }

    @Override
    public Game getById(Long id) {
        Game g = gameMapper.selectById(id);
        if (g == null || (g.getDeleted() != null && g.getDeleted() == 1)
                || (g.getStatus() != null && g.getStatus() == 1)) throw new BusinessException(404, "游戏不存在");
        return g;
    }

    @Override
    @Transactional
    public Long createGame(Game game) {
        game.setStatus(0);
        game.setPostCount(0);
        // 9-11：前台表单已去掉人工 sort 字段（排序统一走名称拼音序），这里兜底默认 0
        if (game.getSort() == null) game.setSort(0);
        gameMapper.insert(game);
        return game.getId();
    }

    @Override
    @Transactional
    public void updateGame(Long id, Game req) {
        Game g = gameMapper.selectById(id);
        if (g == null) throw new BusinessException(404, "游戏不存在");
        if (req.getName() != null) g.setName(req.getName());
        if (req.getCover() != null) g.setCover(req.getCover());
        if (req.getPlatform() != null) g.setPlatform(req.getPlatform());
        if (req.getGenre() != null) g.setGenre(req.getGenre());
        if (req.getDescription() != null) g.setDescription(req.getDescription());
        if (req.getDeveloper() != null) g.setDeveloper(req.getDeveloper());
        if (req.getPublisher() != null) g.setPublisher(req.getPublisher());
        if (req.getReleaseDate() != null) g.setReleaseDate(req.getReleaseDate());
        if (req.getSort() != null) g.setSort(req.getSort());
        gameMapper.updateById(g);
    }

    @Override
    @Transactional
    public void deleteGame(Long id) {
        Game g = gameMapper.selectById(id);
        if (g == null) return;
        // 有关联帖子则禁止删除
        long count = postMapper.selectCount(Wrappers.<Post>lambdaQuery().eq(Post::getGameId, id));
        if (count > 0) throw new BusinessException(400, "该游戏下存在帖子，无法删除");
        gameMapper.deleteById(id);
    }

    @Override
    @Transactional
    public void toggleStatus(Long id) {
        Game g = gameMapper.selectById(id);
        if (g == null) throw new BusinessException(404, "游戏不存在");
        int next = (g.getStatus() != null && g.getStatus() == 0) ? 1 : 0;
        g.setStatus(next);
        gameMapper.updateById(g);
    }

    @Override
    public List<Game> listHotGames(int limit) {
        // 9-11：热门游戏 = 标记 is_hot 的游戏，顺序与其他列表统一为名称拼音序（sort 字段不再参与）
        return gameMapper.selectList(Wrappers.<Game>lambdaQuery()
                .eq(Game::getStatus, 0)
                .eq(Game::getDeleted, 0)
                .eq(Game::getIsHot, 1)
                .last("ORDER BY name COLLATE utf8mb4_zh_0900_as_cs ASC LIMIT " + Math.max(1, limit)));
    }

    @Override
    public List<Game> listAllGames() {
        // 9-11：后台游戏管理列表同样按名称拼音序（与前台游戏库一致）
        return gameMapper.selectList(Wrappers.<Game>lambdaQuery()
                .eq(Game::getDeleted, 0)
                .last("ORDER BY name COLLATE utf8mb4_zh_0900_as_cs ASC"));
    }

    @Override
    public List<GameMiniVO> resolveGamesByIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        // 去重 + 过滤无效
        List<Long> uniq = ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (uniq.isEmpty()) return List.of();
        List<Game> games = gameMapper.selectBatchIds(uniq);
        return games.stream()
                // 仅展示可见游戏（status=0 且 deleted=0）
                .filter(g -> g.getStatus() == null || g.getStatus() == 0)
                .filter(g -> g.getDeleted() == null || g.getDeleted() == 0)
                // 热门优先 + sort 升序 + id 升序
                .sorted(
                        java.util.Comparator.comparing(Game::getIsHot,
                                Comparator.nullsLast(Comparator.reverseOrder()))
                        .thenComparing(Game::getSort,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(Game::getId,
                                Comparator.nullsLast(Comparator.naturalOrder())))
                .map(g -> {
                    GameMiniVO vo = new GameMiniVO();
                    vo.setId(g.getId());
                    vo.setName(g.getName());
                    vo.setCover(g.getCover());
                    vo.setPlatform(g.getPlatform());
                    vo.setGenre(g.getGenre());
                    return vo;
                })
                .toList();
    }

    @Override
    @Transactional
    public void syncPostCount(Long gameId) {
        if (gameId == null) return;
        long count = postMapper.selectCount(Wrappers.<Post>lambdaQuery()
                .eq(Post::getGameId, gameId)
                .eq(Post::getStatus, 0));
        gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                .eq(Game::getId, gameId)
                .set(Game::getPostCount, (int) count));
    }
}
