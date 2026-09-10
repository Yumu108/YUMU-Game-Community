package com.yumu.community.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class RejectPostRequest {
    /** 驳回理由（必填，1-500 字符） */
    @NotBlank(message = "驳回理由不能为空")
    @Size(max = 500, message = "驳回理由不超过 500 字")
    private String reason;
}
