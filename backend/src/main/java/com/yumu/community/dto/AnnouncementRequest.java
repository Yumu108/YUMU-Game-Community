package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 后台管理：创建/更新公告请求。创建/更新共用同一 DTO。
 * - title 必填，≤100
 * - content 必填，≤5000
 * - status 默认 0（展示）
 * - sort 默认 0；越大越靠前
 */
@Data
public class AnnouncementRequest {

    @NotBlank(message = "公告标题不能为空")
    @Size(max = 100, message = "标题最长 100 字")
    private String title;

    @NotBlank(message = "公告内容不能为空")
    @Size(max = 5000, message = "内容过长（上限 5000 字）")
    private String content;

    /** 0=展示 1=隐藏，默认 0 */
    private Integer status;

    /** 排序权重，越大越靠前，默认 0 */
    private Integer sort;
}