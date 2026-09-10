package com.yumu.community.service;

import com.yumu.community.dto.ModeratorBoardItem;
import com.yumu.community.vo.ModeratorAssignmentVO;

import java.util.List;

/**
 * 版主负责游戏（板块）管理。1.2 起取消板块细分：版主按「游戏」授权，
 * 一名版主负责某游戏即覆盖该游戏全部板块；同一游戏可配多名版主（上限见实现）。
 */
public interface ModeratorBoardService {

    /** 获取某版主负责的所有板块 ID（跨游戏去重，仅供徽章展示）。 */
    List<Long> listBoardIdsByUserId(Long userId);

    /** 获取某版主负责的所有板块名（前端展示用）。无负责板块时返回空列表。 */
    List<String> listBoardNamesByUserId(Long userId);

    /**
     * 获取某版主负责的所有游戏 ID（去重，排除 gameId=null 的"全游戏"历史项）。
     * 1.2 起版主按 (游戏, 板块) 授权，徽章展示需要这个集合来告诉用户他管的是哪个游戏。
     */
    List<Long> listGameIdsByUserId(Long userId);

    /**
     * 获取某版主负责的所有游戏名（去重 + 按 game.sort, game.id 排序）。
     * 用于作者徽章展示：「版主 · 三角洲行动」之类。
     */
    List<String> listGameNamesByUserId(Long userId);

    /** 获取某版主的全部 (游戏, 板块) 授权项。 */
    List<com.yumu.community.entity.ModeratorBoard> listAssignments(Long userId);

    /**
     * 判断某版主是否覆盖指定 (游戏, 板块)。
     * - 游戏级授权（board_id IS NULL）覆盖该游戏全部板块，忽略 boardId 参数；
     * - 历史精确 (游戏, 板块) 授权仍兼容；
     * - gameId 为 null 的历史授权视为覆盖所有游戏。
     */
    boolean covers(Long userId, Long gameId, Long boardId);

    /** 获取某版主授权项（含游戏名/板块名，供后台展示与编辑）。 */
    List<ModeratorAssignmentVO> listAssignmentsVO(Long userId);

    /**
     * 批量设置某版主负责的游戏（全量替换，取消板块细分）。
     * 一名版主只能担任一个游戏的版主（{@code MAX_GAMES_PER_MOD=1}），一次传入多个游戏会抛 BusinessException(400)；
     * 每个游戏最多 {@code MAX_MODS_PER_GAME} 位版主，超出同样抛 BusinessException(400)。
     * 调用者需自行校验当前用户是管理员。
     */
    void setModeratorBoards(Long userId, List<ModeratorBoardItem> items);
}
