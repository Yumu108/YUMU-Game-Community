package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("points_log")
public class PointsLog extends BaseEntity {

    private Long userId;
    private Integer type;
    private Integer delta;
    private Integer balanceAfter;
    private String description;
    private Long relatedId;
}
