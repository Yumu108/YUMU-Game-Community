package com.yumu.community.dto;

import lombok.Data;

/**
 * 版主负责的一个游戏。1.2 起取消板块细分，版主按 gameId 授权（boardId 不再使用，
 * 后端统一置 NULL 表示「负责该游戏全部板块」）。同一游戏可配多名版主（上限见服务实现）。
 */
@Data
public class ModeratorBoardItem {

    /** 关联游戏 ID（必填） */
    private Long gameId;

    /** 已废弃：板块细分取消，始终为 NULL。保留字段仅为兼容历史 JSON。 */
    @Deprecated
    private Long boardId;
}
