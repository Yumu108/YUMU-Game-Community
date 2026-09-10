package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDate;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("game")
public class Game extends BaseEntity {

    private String name;
    private String cover;
    private String platform;
    private String genre;
    private String description;
    private String developer;
    private String publisher;
    private LocalDate releaseDate;
    private Integer postCount;
    private Integer sort;
    private Integer status;
    private Integer isHot;
}
