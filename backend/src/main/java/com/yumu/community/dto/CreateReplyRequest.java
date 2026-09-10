package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 发布回复请求（postId 由 URL 路径注入，非请求体字段；replyToId 不为空表示楼中楼回复）。
 */
@Data
public class CreateReplyRequest {

    /** 帖子 ID 由 URL 路径注入，不在请求体中，故不在此做 @NotNull 校验（改由 Service 校验）。 */
    private Long postId;

    @NotBlank(message = "回复内容不能为空")
    @Size(max = 10000, message = "回复内容过长（上限 10000 字）")
    private String content;

    private Long replyToId;
}
