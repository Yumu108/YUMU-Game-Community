package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 订阅：板块订阅(sub_type=1, target_id=板块id) 与 关键词订阅(sub_type=2, keyword=关键词)。
 * 同一种订阅对同一用户唯一（uk_user_sub）。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("subscription")
public class Subscription extends BaseEntity {

    private Long userId;
    /** 1=板块订阅 2=关键词订阅 */
    private Integer subType;
    /** 板块订阅时的板块 id（关键词订阅为 null） */
    private Long targetId;
    /** 关键词订阅时的关键词（板块订阅为 null） */
    private String keyword;
}
