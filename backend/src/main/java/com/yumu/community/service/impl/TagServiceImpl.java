package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.entity.Post;
import com.yumu.community.entity.PostTag;
import com.yumu.community.entity.Tag;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.mapper.PostTagMapper;
import com.yumu.community.mapper.TagMapper;
import com.yumu.community.service.TagService;
import com.yumu.community.vo.TagVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class TagServiceImpl implements TagService {

    private final TagMapper tagMapper;
    private final PostTagMapper postTagMapper;
    private final PostMapper postMapper;

    /** 单帖最多标签数 */
    private static final int MAX_TAGS = 5;
    /** 标签名最大长度（与 tag.name VARCHAR(30) 一致） */
    private static final int MAX_NAME_LEN = 30;

    @Override
    public List<TagVO> listTags() {
        List<Tag> tags = tagMapper.selectList(Wrappers.<Tag>lambdaQuery()
                .orderByDesc(Tag::getUseCount)
                .orderByAsc(Tag::getName));
        return tags.stream().map(this::toVO).toList();
    }

    @Override
    public List<TagVO> hotTags(int limit) {
        List<Tag> tags = tagMapper.selectList(Wrappers.<Tag>lambdaQuery()
                .gt(Tag::getUseCount, 0)
                .last("ORDER BY use_count DESC, name ASC LIMIT " + limit));
        return tags.stream().map(this::toVO).toList();
    }

    @Override
    public TagVO getTag(Long tagId) {
        Tag t = tagMapper.selectById(tagId);
        if (t == null) throw new BusinessException(404, "标签不存在");
        return toVO(t);
    }

    @Override
    public List<TagVO> getPostTags(Long postId) {
        List<Long> tagIds = postTagMapper.selectList(Wrappers.<PostTag>lambdaQuery()
                        .eq(PostTag::getPostId, postId))
                .stream().map(PostTag::getTagId).toList();
        if (tagIds.isEmpty()) return List.of();
        return tagMapper.selectBatchIds(tagIds).stream().map(this::toVO).toList();
    }

    @Override
    @Transactional
    public void setPostTags(Long postId, Long operatorUserId, List<String> tagNames) {
        Post post = postMapper.selectById(postId);
        if (post == null) throw new BusinessException(404, "帖子不存在");
        if (!post.getUserId().equals(operatorUserId)) {
            throw new BusinessException(403, "只能给自己的帖子设置标签");
        }
        // 1) 移除旧关联，并把被移除标签的 useCount 回退（不低于 0）
        List<PostTag> old = postTagMapper.selectList(Wrappers.<PostTag>lambdaQuery()
                .eq(PostTag::getPostId, postId));
        for (PostTag pt : old) {
            Tag t = tagMapper.selectById(pt.getTagId());
            if (t != null && t.getUseCount() != null && t.getUseCount() > 0) {
                t.setUseCount(t.getUseCount() - 1);
                tagMapper.updateById(t);
            }
        }
        postTagMapper.delete(Wrappers.<PostTag>lambdaQuery().eq(PostTag::getPostId, postId));

        if (tagNames == null) return;
        // 2) 写入新标签（去重、限长、上限 5）
        Set<String> seen = new HashSet<>();
        int added = 0;
        for (String raw : tagNames) {
            if (added >= MAX_TAGS) break;
            String name = raw == null ? null : raw.trim();
            if (name == null || name.isEmpty() || name.length() > MAX_NAME_LEN) continue;
            if (!seen.add(name)) continue;
            Tag t = tagMapper.selectOne(Wrappers.<Tag>lambdaQuery().eq(Tag::getName, name));
            if (t == null) {
                t = new Tag();
                t.setName(name);
                t.setUseCount(0);
                tagMapper.insert(t);
            }
            PostTag pt = new PostTag();
            pt.setPostId(postId);
            pt.setTagId(t.getId());
            postTagMapper.insert(pt);
            t.setUseCount(t.getUseCount() == null ? 1 : t.getUseCount() + 1);
            tagMapper.updateById(t);
            added++;
        }
    }

    private TagVO toVO(Tag t) {
        TagVO vo = new TagVO();
        vo.setId(t.getId());
        vo.setName(t.getName());
        vo.setUseCount(t.getUseCount() == null ? 0 : t.getUseCount());
        return vo;
    }
}
