package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.entity.Notification;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.NotificationMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.NotificationService;
import com.yumu.community.vo.NotificationVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class NotificationServiceImpl implements NotificationService {

    private final NotificationMapper notificationMapper;
    private final UserMapper userMapper;

    @Override
    public List<NotificationVO> list(Long userId) {
        List<Notification> list = notificationMapper.selectList(Wrappers.<Notification>lambdaQuery()
                .eq(Notification::getUserId, userId)
                .orderByDesc(Notification::getCreatedAt)
                .last("LIMIT 50"));
        return list.stream().map(this::toVO).toList();
    }

    @Override
    public long unreadCount(Long userId) {
        return notificationMapper.selectCount(Wrappers.<Notification>lambdaQuery()
                .eq(Notification::getUserId, userId)
                .eq(Notification::getIsRead, 0));
    }

    @Override
    @Transactional
    public void markRead(Long userId, Long id) {
        if (id != null && id > 0) {
            Notification n = notificationMapper.selectById(id);
            if (n != null && userId.equals(n.getUserId())) {
                n.setIsRead(1);
                notificationMapper.updateById(n);
            }
        } else {
            // 全部已读
            notificationMapper.update(null, Wrappers.<Notification>lambdaUpdate()
                    .eq(Notification::getUserId, userId)
                    .set(Notification::getIsRead, 1));
        }
    }

    @Override
    @Transactional
    public void clearRead(Long userId, List<Integer> types) {
        var w = Wrappers.<Notification>lambdaQuery()
                .eq(Notification::getUserId, userId)
                .eq(Notification::getIsRead, 1); // 只清已读，未读（红点）保留
        if (types != null && !types.isEmpty()) {
            w.in(Notification::getType, types);
        }
        notificationMapper.delete(w); // 逻辑删除（BaseEntity.deleted）
    }

    private NotificationVO toVO(Notification n) {
        NotificationVO vo = new NotificationVO();
        vo.setId(n.getId());
        vo.setType(n.getType());
        vo.setSenderId(n.getSenderId());
        vo.setTargetType(n.getTargetType());
        vo.setTargetId(n.getTargetId());
        vo.setSourceId(n.getSourceId());
        vo.setContent(n.getContent());
        vo.setIsRead(n.getIsRead());
        vo.setCreatedAt(n.getCreatedAt());
        if (n.getSenderId() != null) {
            User u = userMapper.selectById(n.getSenderId());
            vo.setSenderNickname(u != null
                    ? (u.getNickname() != null ? u.getNickname() : u.getUsername())
                    : null);
        }
        return vo;
    }
}
