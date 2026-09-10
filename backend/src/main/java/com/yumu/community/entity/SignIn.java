package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDate;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sign_in")
public class SignIn extends BaseEntity {

    private Long userId;
    private LocalDate signDate;
    private Integer continuousDays;
    private Integer points;
}
