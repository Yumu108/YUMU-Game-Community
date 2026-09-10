package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 举报记录：用户对帖子/回复/用户发起举报，由管理员在审核后台处理。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("report")
public class Report extends BaseEntity {

    /** 举报人 user.id */
    private Long reporterId;
    /** 1帖子 2回复 3用户 */
    private Integer targetType;
    /** 被举报对象 id */
    private Long targetId;
    /** 举报理由 */
    private String reason;
    /** 0待处理 1已处理(违规) 2已驳回 */
    private Integer status;
    /** 处理备注 */
    private String handleNote;
    /** 处理人(管理员) user.id */
    private Long handlerId;
}
