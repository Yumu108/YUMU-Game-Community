package com.yumu.community.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 处理举报请求（管理员）：status=1 标记违规并处理，status=2 驳回。
 */
@Data
public class HandleReportRequest {

    /** 1已处理(违规) 2已驳回 */
    @NotNull(message = "处理结果不能为空")
    private Integer status;

    /** 处理备注（可选） */
    private String handleNote;
}
