package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("board")
public class Board extends BaseEntity {

    private String name;
    private String description;
    private String icon;
    private Long parentId;
    private Integer sort;
    private Integer postCount;
    private Integer status;
}
