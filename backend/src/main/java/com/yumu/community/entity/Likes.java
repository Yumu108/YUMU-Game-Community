package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("likes")
public class Likes extends BaseEntity {

    private Long userId;
    private Integer targetType;
    private Long targetId;
}
