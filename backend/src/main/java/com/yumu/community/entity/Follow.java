package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("follow")
public class Follow extends BaseEntity {

    private Long userId;
    private Integer followType;
    private Long followId;
}
