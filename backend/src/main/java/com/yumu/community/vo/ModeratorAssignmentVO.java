package com.yumu.community.vo;

import lombok.Data;

/**
 * 版主 (游戏, 板块) 授权项（含名称，供后台展示）。
 */
@Data
public class ModeratorAssignmentVO {

    private Long gameId;
    private Long boardId;
    private String gameName;
    private String boardName;
}
