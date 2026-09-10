package com.yumu.community.vo;

import lombok.Data;

import java.util.List;

/**
 * 板块视图对象（含子板块）。
 */
@Data
public class BoardVO {

    private Long id;
    private String name;
    private String description;
    private String icon;
    private Long parentId;
    private Integer postCount;
    private Integer sort;
    private List<BoardVO> children;
}
