package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.entity.Subscription;
import com.yumu.community.mapper.SubscriptionMapper;
import com.yumu.community.service.BoardService;
import com.yumu.community.service.SubscriptionService;
import com.yumu.community.vo.BoardVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SubscriptionServiceImpl implements SubscriptionService {

    private static final int SUB_BOARD = 1;
    private static final int SUB_KEYWORD = 2;

    private final SubscriptionMapper subscriptionMapper;
    private final BoardService boardService;

    @Override
    @Transactional
    public boolean toggleBoard(Long userId, Long boardId) {
        if (boardId == null) throw new BusinessException(400, "板块 id 不能为空");
        // 1. 状态判断：只看有效行（deleted=0）
        Long activeCount = subscriptionMapper.selectCount(Wrappers.<Subscription>lambdaQuery()
                .eq(Subscription::getUserId, userId)
                .eq(Subscription::getSubType, SUB_BOARD)
                .eq(Subscription::getTargetId, boardId)
                .eq(Subscription::getDeleted, 0));
        boolean subscribed = activeCount != null && activeCount > 0;
        // 2. 防御性物理清理：避免 uk_user_sub 唯一键冲突（含僵尸数据）
        subscriptionMapper.physicalDeleteBoard(userId, boardId);
        if (subscribed) {
            return false;
        }
        Subscription s = new Subscription();
        s.setUserId(userId);
        s.setSubType(SUB_BOARD);
        s.setTargetId(boardId);
        subscriptionMapper.insert(s);
        return true;
    }

    @Override
    @Transactional
    public boolean toggleKeyword(Long userId, String keyword) {
        String kw = keyword == null ? null : keyword.trim();
        if (kw == null || kw.isEmpty()) throw new BusinessException(400, "关键词不能为空");
        if (kw.length() > 50) kw = kw.substring(0, 50);
        // 1. 状态判断：只看有效行（deleted=0）
        Long activeCount = subscriptionMapper.selectCount(Wrappers.<Subscription>lambdaQuery()
                .eq(Subscription::getUserId, userId)
                .eq(Subscription::getSubType, SUB_KEYWORD)
                .eq(Subscription::getKeyword, kw)
                .eq(Subscription::getDeleted, 0));
        boolean subscribed = activeCount != null && activeCount > 0;
        // 2. 防御性物理清理：避免 uk_user_sub 唯一键冲突（含僵尸数据）
        subscriptionMapper.physicalDeleteKeyword(userId, kw);
        if (subscribed) {
            return false;
        }
        Subscription s = new Subscription();
        s.setUserId(userId);
        s.setSubType(SUB_KEYWORD);
        s.setKeyword(kw);
        subscriptionMapper.insert(s);
        return true;
    }

    @Override
    public Map<String, Object> listSubscriptions(Long userId) {
        List<Subscription> subs = subscriptionMapper.selectList(Wrappers.<Subscription>lambdaQuery()
                .eq(Subscription::getUserId, userId)
                .eq(Subscription::getDeleted, 0));

        List<Long> boardIds = subs.stream()
                .filter(s -> s.getSubType() == SUB_BOARD && s.getTargetId() != null)
                .map(Subscription::getTargetId)
                .collect(Collectors.toList());
        List<String> keywords = subs.stream()
                .filter(s -> s.getSubType() == SUB_KEYWORD && s.getKeyword() != null && !s.getKeyword().isBlank())
                .map(Subscription::getKeyword)
                .collect(Collectors.toList());

        // 板块 id -> 板块信息（一次树查询后建 map，避免 N 次 RPC）
        Map<Long, BoardVO> boardMap = new LinkedHashMap<>();
        try {
            for (BoardVO b : boardService.getTree(null)) {
                boardMap.put(b.getId(), b);
                if (b.getChildren() != null) {
                    for (BoardVO c : b.getChildren()) boardMap.put(c.getId(), c);
                }
            }
        } catch (Exception ignored) {
            // 板块服务不可用时退化为仅返回 id
        }

        List<Map<String, Object>> boards = boardIds.stream().map(id -> {
            BoardVO b = boardMap.get(id);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("name", b != null ? b.getName() : "未知板块");
            m.put("icon", b != null ? b.getIcon() : "📁");
            return m;
        }).collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("boards", boards);
        result.put("keywords", keywords);
        return result;
    }
}
