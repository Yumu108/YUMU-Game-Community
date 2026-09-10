package com.yumu.community.vo;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 公告视图对象（公开/管理端共用）。
 */
@Data
public class AnnouncementVO {

    private Long id;
    private String title;
    private String content;
    private Integer status;        // 0=展示 1=隐藏
    private Boolean isTop;         // v1.2 起：true=置顶，false=普通
    /** @deprecated 已弃用：v1.2 起由 is_top 决定先后，sort 字段不再输出。 */
    @Deprecated
    @JsonIgnore
    private Integer sort;
    private Long createdBy;        // 发布管理员 ID
    private String creatorName;    // 发布人昵称/用户名（管理端 + 公开列表展示）
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}