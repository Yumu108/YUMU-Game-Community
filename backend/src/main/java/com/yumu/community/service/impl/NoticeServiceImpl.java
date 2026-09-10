package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.dto.AnnouncementRequest;
import com.yumu.community.entity.Announcement;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.AnnouncementMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.security.HtmlSanitizer;
import com.yumu.community.service.NoticeService;
import com.yumu.community.vo.AnnouncementVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class NoticeServiceImpl implements NoticeService {

    private final AnnouncementMapper announcementMapper;
    private final UserMapper userMapper;
    /** A1：服务端 HTML 净化（Jsoup 白名单）—— 防存储型 XSS。 */
    private final HtmlSanitizer htmlSanitizer;

    @Override
    public List<AnnouncementVO> listActive(int size) {
        if (size <= 0) size = 5;
        if (size > 50) size = 50;
        // 公开列表：状态=展示，按「置顶优先 → 创建时间倒序」排
        List<Announcement> list = announcementMapper.selectList(
                Wrappers.<Announcement>lambdaQuery()
                        .eq(Announcement::getStatus, 0)
                        .orderByDesc(Announcement::getIsTop)
                        .orderByDesc(Announcement::getCreatedAt)
                        .orderByDesc(Announcement::getId)
                        .last("LIMIT " + size));
        return toVOList(list);
    }

    @Override
    public AnnouncementVO getById(Long id) {
        Announcement a = announcementMapper.selectById(id);
        if (a == null) throw new BusinessException(404, "公告不存在");
        return toVO(a);
    }

    @Override
    public PageResult<AnnouncementVO> pageAdmin(long current, long size) {
        Page<Announcement> page = new Page<>(Math.max(1, current), Math.min(100, Math.max(1, size)));
        // 管理端列表：全部状态，按「置顶优先 → 创建时间倒序」展示，避免按数字权重排序的体验痛点
        Page<Announcement> res = announcementMapper.selectPage(page,
                Wrappers.<Announcement>lambdaQuery()
                        .orderByDesc(Announcement::getIsTop)
                        .orderByDesc(Announcement::getCreatedAt)
                        .orderByDesc(Announcement::getId));
        List<AnnouncementVO> records = toVOList(res.getRecords());
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), records);
    }

    @Override
    @Transactional
    public Long create(AnnouncementRequest req, Long operatorId) {
        Announcement a = new Announcement();
        a.setTitle(req.getTitle().trim());
        // A1：管理员输入也走 Jsoup 白名单，防御性兜底（即便内部管理员被劫持也不致 XSS）
        a.setContent(htmlSanitizer.sanitize(req.getContent()));
        a.setStatus(req.getStatus() == null ? 0 : req.getStatus());
        // v1.2 起：sort 字段不再使用；新建默认为 0；置顶状态由独立的 pin 端点维护
        a.setSort(0);
        a.setCreatedBy(operatorId);
        announcementMapper.insert(a);
        return a.getId();
    }

    @Override
    @Transactional
    public void update(Long id, AnnouncementRequest req) {
        Announcement a = announcementMapper.selectById(id);
        if (a == null) throw new BusinessException(404, "公告不存在");
        a.setTitle(req.getTitle().trim());
        // A1：服务端 HTML 净化
        a.setContent(htmlSanitizer.sanitize(req.getContent()));
        if (req.getStatus() != null) a.setStatus(req.getStatus());
        // v1.2 起：sort 字段保留但不再生效；忽略前端传入的 sort
        announcementMapper.updateById(a);
    }

    @Override
    @Transactional
    public void delete(Long id) {
        if (announcementMapper.selectById(id) == null) throw new BusinessException(404, "公告不存在");
        announcementMapper.deleteById(id);
    }

    @Override
    @Transactional
    public void setTop(Long id, boolean isTop) {
        Announcement a = announcementMapper.selectById(id);
        if (a == null) throw new BusinessException(404, "公告不存在");
        a.setIsTop(isTop ? 1 : 0);
        announcementMapper.updateById(a);
    }

    // ---------------- helper ----------------
    private AnnouncementVO toVO(Announcement a) {
        AnnouncementVO vo = new AnnouncementVO();
        vo.setId(a.getId());
        vo.setTitle(a.getTitle());
        vo.setContent(a.getContent());
        vo.setStatus(a.getStatus() == null ? 0 : a.getStatus());
        vo.setIsTop(a.getIsTop() != null && a.getIsTop() == 1);
        // sort 字段不再输出，避免引起误解
        vo.setCreatedBy(a.getCreatedBy());
        vo.setCreatedAt(a.getCreatedAt());
        vo.setUpdatedAt(a.getUpdatedAt());
        return vo;
    }

    private List<AnnouncementVO> toVOList(List<Announcement> list) {
        if (list.isEmpty()) return Collections.emptyList();
        Set<Long> userIds = list.stream().map(Announcement::getCreatedBy).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        Map<Long, User> userMap = userIds.isEmpty() ? Map.of()
                : userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a, HashMap::new));
        return list.stream().map(a -> {
            AnnouncementVO vo = toVO(a);
            User u = a.getCreatedBy() == null ? null : userMap.get(a.getCreatedBy());
            if (u != null) vo.setCreatorName(u.getNickname() != null ? u.getNickname() : u.getUsername());
            return vo;
        }).collect(Collectors.toList());
    }
}