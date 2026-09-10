package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 系统公告。
 * status：0=展示 1=隐藏
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("announcement")
public class Announcement extends BaseEntity {

    private String title;
    private String content;
    private Integer status;
    /** 是否置顶：0=否 1=是（v1.2 起替代 sort 数字权重） */
    private Integer isTop;
    /** 已弃用：保留字段不再使用 */
    private Integer sort;
    private Long createdBy;
}