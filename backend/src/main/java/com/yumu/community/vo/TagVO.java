package com.yumu.community.vo;

import lombok.Data;

/**
 * 标签视图对象。
 */
@Data
public class TagVO {

    private Long id;
    private String name;
    private Integer useCount;
}
