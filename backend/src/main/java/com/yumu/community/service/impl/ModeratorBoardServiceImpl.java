package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.dto.ModeratorBoardItem;
import com.yumu.community.entity.Board;
import com.yumu.community.entity.Game;
import com.yumu.community.entity.ModeratorBoard;
import com.yumu.community.mapper.BoardMapper;
import com.yumu.community.mapper.GameMapper;
import com.yumu.community.mapper.ModeratorBoardMapper;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.vo.ModeratorAssignmentVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ModeratorBoardServiceImpl implements ModeratorBoardService {

    private final ModeratorBoardMapper moderatorBoardMapper;
    private final BoardMapper boardMapper;
    private final GameMapper gameMapper;

    @Override
    public List<Long> listBoardIdsByUserId(Long userId) {
        return moderatorBoardMapper.selectList(
                        Wrappers.<ModeratorBoard>lambdaQuery()
                                .eq(ModeratorBoard::getUserId, userId)
                                .eq(ModeratorBoard::getDeleted, 0))
                .stream()
                .map(ModeratorBoard::getBoardId)
                .distinct()
                .sorted()
                .collect(Collectors.toList());
    }

    @Override
    public List<String> listBoardNamesByUserId(Long userId) {
        List<Long> ids = listBoardIdsByUserId(userId);
        if (ids.isEmpty()) return List.of();
        return boardMapper.selectBatchIds(ids).stream()
                .map(Board::getName)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());
    }

    @Override
    public List<Long> listGameIdsByUserId(Long userId) {
        return moderatorBoardMapper.selectList(
                        Wrappers.<ModeratorBoard>lambdaQuery()
                                .select(ModeratorBoard::getGameId)
                                .eq(ModeratorBoard::getUserId, userId)
                                .eq(ModeratorBoard::getDeleted, 0)
                                .isNotNull(ModeratorBoard::getGameId))
                .stream()
                .map(ModeratorBoard::getGameId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
    }

    @Override
    public List<String> listGameNamesByUserId(Long userId) {
        List<Long> gameIds = listGameIdsByUserId(userId);
        if (gameIds.isEmpty()) return List.of();
        return gameMapper.selectBatchIds(gameIds).stream()
                .filter(java.util.Objects::nonNull)
                // 热门 (is_hot=1) 排前，再按 sort ASC、id ASC 兜底；保持视觉一致性
                .sorted((a, b) -> {
                    int ha = a.getIsHot() == null ? 0 : a.getIsHot();
                    int hb = b.getIsHot() == null ? 0 : b.getIsHot();
                    if (ha != hb) return Integer.compare(hb, ha);     // 热门在前
                    int sa = a.getSort() == null ? Integer.MAX_VALUE : a.getSort();
                    int sb = b.getSort() == null ? Integer.MAX_VALUE : b.getSort();
                    if (sa != sb) return Integer.compare(sa, sb);       // sort 小者在前
                    return Long.compare(a.getId(), b.getId());
                })
                .map(Game::getName)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());
    }

    @Override
    public List<ModeratorBoard> listAssignments(Long userId) {
        return moderatorBoardMapper.selectList(
                Wrappers.<ModeratorBoard>lambdaQuery()
                        .eq(ModeratorBoard::getUserId, userId)
                        .eq(ModeratorBoard::getDeleted, 0));
    }

    @Override
    public boolean covers(Long userId, Long gameId, Long boardId) {
        if (gameId == null) return false;
        // 1) 游戏级授权：board_id IS NULL 表示负责该游戏全部板块（忽略 boardId 参数）
        long gameLevel = moderatorBoardMapper.selectCount(Wrappers.<ModeratorBoard>lambdaQuery()
                .eq(ModeratorBoard::getUserId, userId)
                .eq(ModeratorBoard::getGameId, gameId)
                .isNull(ModeratorBoard::getBoardId)
                .eq(ModeratorBoard::getDeleted, 0));
        if (gameLevel > 0) return true;
        // 2) 历史精确 (游戏, 板块) 授权（兼容迁移前的细分数据）
        if (boardId != null) {
            long exact = moderatorBoardMapper.selectCount(Wrappers.<ModeratorBoard>lambdaQuery()
                    .eq(ModeratorBoard::getUserId, userId)
                    .eq(ModeratorBoard::getBoardId, boardId)
                    .and(w -> w.eq(ModeratorBoard::getGameId, gameId)
                            .or().isNull(ModeratorBoard::getGameId))
                    .eq(ModeratorBoard::getDeleted, 0));
            if (exact > 0) return true;
        }
        // 3) 历史全游戏授权：game_id IS NULL 兜底（兼容存量）
        long legacy = moderatorBoardMapper.selectCount(Wrappers.<ModeratorBoard>lambdaQuery()
                .eq(ModeratorBoard::getUserId, userId)
                .isNull(ModeratorBoard::getGameId)
                .eq(ModeratorBoard::getDeleted, 0));
        return legacy > 0;
    }

    @Override
    public List<ModeratorAssignmentVO> listAssignmentsVO(Long userId) {
        List<ModeratorBoard> rows = listAssignments(userId);
        if (rows.isEmpty()) return List.of();
        List<Long> boardIds = rows.stream().map(ModeratorBoard::getBoardId)
                .filter(java.util.Objects::nonNull).toList();
        List<Long> gameIds = rows.stream().map(ModeratorBoard::getGameId)
                .filter(java.util.Objects::nonNull).toList();
        Map<Long, Board> boardMap = boardIds.isEmpty() ? new LinkedHashMap<>()
                : boardMapper.selectBatchIds(boardIds).stream()
                .collect(Collectors.toMap(Board::getId, b -> b, (a, b) -> a));
        Map<Long, Game> gameMap = gameIds.isEmpty() ? new LinkedHashMap<>()
                : gameMapper.selectBatchIds(gameIds).stream()
                .collect(Collectors.toMap(Game::getId, g -> g, (a, b) -> a));
        List<ModeratorAssignmentVO> vos = new java.util.ArrayList<>(rows.size());
        for (ModeratorBoard mb : rows) {
            ModeratorAssignmentVO vo = new ModeratorAssignmentVO();
            vo.setGameId(mb.getGameId());
            vo.setBoardId(mb.getBoardId());
            Board b = boardMap.get(mb.getBoardId());
            vo.setBoardName(b != null ? b.getName()
                    : (mb.getBoardId() == null ? "全部板块" : "未知板块"));
            Game g = mb.getGameId() != null ? gameMap.get(mb.getGameId()) : null;
            vo.setGameName(g != null ? g.getName() : "全部游戏");
            vos.add(vo);
        }
        return vos;
    }

    /** 单游戏版主数量上限（同一游戏最多可配置的版主人数）。 */
    private static final int MAX_MODS_PER_GAME = 5;

    /** 单个用户最多担任版主的游戏数（一名版主只能负责一个游戏）。 */
    private static final int MAX_GAMES_PER_MOD = 1;

    @Override
    @Transactional
    public void setModeratorBoards(Long userId, List<ModeratorBoardItem> items) {
        // 取消板块细分：仅按游戏授权，收集该用户将要负责的游戏（去重）
        Set<Long> newGames = new LinkedHashSet<>();
        if (items != null) {
            for (ModeratorBoardItem it : items) {
                if (it != null && it.getGameId() != null) newGames.add(it.getGameId());
            }
        }
        // 一名版主只能担任一个游戏的版主（setModeratorBoards 为全量替换，
        // 换任时只提交目标游戏即可，历史授权会被下方物理删除清掉）
        if (newGames.size() > MAX_GAMES_PER_MOD) {
            throw new BusinessException(400,
                    "一名版主只能担任一个游戏的版主（最多 " + MAX_GAMES_PER_MOD + " 个），请只选择目标游戏");
        }
        // 逐个游戏校验版主数量上限（以现有版主集合 ∪ 本用户 计算，避免重复计数）
        for (Long gameId : newGames) {
            List<Long> currentMods = moderatorBoardMapper.selectList(Wrappers.<ModeratorBoard>lambdaQuery()
                            .select(ModeratorBoard::getUserId)
                            .eq(ModeratorBoard::getGameId, gameId)
                            .isNull(ModeratorBoard::getBoardId)
                            .eq(ModeratorBoard::getDeleted, 0))
                    .stream().map(ModeratorBoard::getUserId).distinct().toList();
            Set<Long> willBe = new LinkedHashSet<>(currentMods);
            willBe.add(userId);
            if (willBe.size() > MAX_MODS_PER_GAME) {
                throw new BusinessException(400,
                        "游戏 #" + gameId + " 的版主数量已达上限（" + MAX_MODS_PER_GAME + " 位），无法再添加");
            }
        }
        // 物理删除旧授权后全量插入新集合（board_id 统一置 NULL 表示游戏级负责）
        moderatorBoardMapper.physicalDeleteByUserId(userId);
        for (Long gameId : newGames) {
            ModeratorBoard mb = new ModeratorBoard();
            mb.setUserId(userId);
            mb.setGameId(gameId);
            mb.setBoardId(null);
            mb.setDeleted(0);
            moderatorBoardMapper.insert(mb);
        }
    }
}
