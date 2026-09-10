package com.yumu.community.service;

import com.yumu.community.vo.TagVO;

import java.util.List;

public interface TagService {

    /**
     * 全部标签（按 useCount 降序、name 升序）。
     */
    List<TagVO> listTags();

    /**
     * 热门标签（useCount > 0，取前 limit 个）。
     */
    List<TagVO> hotTags(int limit);

    /**
     * 单个标签详情（不存在抛 404）。
     */
    TagVO getTag(Long tagId);

    /**
     * 某帖子当前挂载的标签列表。
     */
    List<TagVO> getPostTags(Long postId);

    /**
     * 设置帖子标签：仅作者本人可操作；自动建不存在的标签；上限 5 个；
     * 替换旧关联并同步 useCount。
     */
    void setPostTags(Long postId, Long operatorUserId, List<String> tagNames);
}
