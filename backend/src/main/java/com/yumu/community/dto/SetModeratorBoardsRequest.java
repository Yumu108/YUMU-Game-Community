package com.yumu.community.dto;

import lombok.Data;

import java.util.List;

@Data
public class SetModeratorBoardsRequest {

    /** 版主负责的 (游戏, 板块) 对列表（全量替换）。 */
    private List<ModeratorBoardItem> items;
}
