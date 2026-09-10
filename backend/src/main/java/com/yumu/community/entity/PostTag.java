package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 帖子-标签关联（原型期先建表，暂不接业务功能）。
 * 采用单一自增主键 id，复合唯一约束在数据库层 (post_id, tag_id)。
 */
@Data
@TableName("post_tag")
public class PostTag {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long postId;

    private Long tagId;
}
