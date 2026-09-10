package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 版主负责板块关联表：一个版主可负责多个板块，一个板块也可有多个版主。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("moderator_board")
public class ModeratorBoard extends BaseEntity {

    private Long userId;
    private Long gameId;
    private Long boardId;
}
