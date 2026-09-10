package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * 发布 / 更新帖子请求（同一 DTO 同时用于创建与编辑场景）。
 * 创建与编辑时 title / boardId / content 均必填；编辑时仅作者本人/ADMIN 可调，
 * status / isTop / isEssence 等审核字段不在此传入，由后端保留原值。
 */
@Data
public class CreatePostRequest {

    @NotBlank(message = "标题不能为空")
    @Size(max = 100, message = "标题最长 100 字")
    private String title;

    @NotNull(message = "请选择所属板块")
    private Long boardId;

    /** 关联游戏ID（选填，P0 游戏库） */
    private Long gameId;

    @NotBlank(message = "正文不能为空")
    private String content;

    @Size(max = 200, message = "摘要最长 200 字")
    private String summary;
    private String cover;
    private Integer type;

    /** 话题标签（最多 5 个，可包含尚不存在的标签，后端自动创建） */
    private List<String> tags;
}
