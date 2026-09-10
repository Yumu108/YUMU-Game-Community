package com.yumu.community.dto;

import lombok.Data;

import java.util.List;

/**
 * 设置帖子标签请求。
 */
@Data
public class SetPostTagsRequest {

    private List<String> tags;
}
