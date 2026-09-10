package com.yumu.community.common;

import lombok.Data;

import java.util.List;

/**
 * 分页查询结果封装。
 */
@Data
public class PageResult<T> {

    private Long total;
    private Long pages;
    private Long current;
    private Long size;
    private List<T> records;

    public static <T> PageResult<T> of(long total, long pages, long current, long size, List<T> records) {
        PageResult<T> p = new PageResult<>();
        p.total = total;
        p.pages = pages;
        p.current = current;
        p.size = size;
        p.records = records;
        return p;
    }
}
