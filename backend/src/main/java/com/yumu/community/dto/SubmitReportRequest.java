package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 提交举报请求：登录用户对任意帖子/回复/用户发起举报。
 */
@Data
public class SubmitReportRequest {

    /** 1帖子 2回复 3用户 */
    @NotNull(message = "举报类型不能为空")
    private Integer targetType;

    @NotNull(message = "举报对象不能为空")
    private Long targetId;

    @NotBlank(message = "请填写举报理由")
    @Size(max = 200, message = "举报理由最长 200 字")
    private String reason;
}
