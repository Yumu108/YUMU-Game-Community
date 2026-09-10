package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.entity.Message;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.MessageMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.MessageService;
import com.yumu.community.vo.ConversationVO;
import com.yumu.community.vo.MessageVO;
import com.yumu.community.websocket.NotificationPushService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class MessageServiceImpl implements MessageService {

    private final MessageMapper messageMapper;
    private final UserMapper userMapper;
    private final NotificationPushService pushService;

    @Override
    public List<ConversationVO> listConversations(Long userId) {
        List<Message> list = messageMapper.selectList(Wrappers.<Message>lambdaQuery()
                .and(w -> w.eq(Message::getFromUserId, userId).or().eq(Message::getToUserId, userId))
                .orderByDesc(Message::getCreatedAt));
        // 按对方用户聚合，保留最近一条消息与未读数
        Map<Long, ConversationVO> map = new LinkedHashMap<>();
        for (Message m : list) {
            Long other = m.getFromUserId().equals(userId) ? m.getToUserId() : m.getFromUserId();
            ConversationVO c = map.get(other);
            if (c == null) {
                c = new ConversationVO();
                c.setUserId(other);
                User u = userMapper.selectById(other);
                c.setNickname(u != null ? (u.getNickname() != null ? u.getNickname() : u.getUsername()) : "未知用户");
                c.setAvatar(u != null ? u.getAvatar() : null);
                c.setUnread(0L);
                map.put(other, c);
            }
            c.setLastMessage(m.getContent());
            c.setLastTime(m.getCreatedAt());
            if (m.getToUserId().equals(userId) && (m.getIsRead() == null || m.getIsRead() == 0)) {
                c.setUnread(c.getUnread() + 1);
            }
        }
        return new ArrayList<>(map.values());
    }

    @Override
    public PageResult<MessageVO> listMessages(Long userId, Long otherId, long current, long size) {
        Page<Message> page = new Page<>(current, size);
        messageMapper.selectPage(page, Wrappers.<Message>lambdaQuery()
                .and(w -> w.and(i -> i.eq(Message::getFromUserId, userId).eq(Message::getToUserId, otherId))
                        .or(i -> i.eq(Message::getFromUserId, otherId).eq(Message::getToUserId, userId)))
                .orderByDesc(Message::getCreatedAt));
        List<MessageVO> vos = page.getRecords().stream().map(this::toVO).toList();
        return PageResult.of(page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(), vos);
    }

    @Override
    @Transactional
    public Long send(Long fromUserId, Long toUserId, String content) {
        if (fromUserId.equals(toUserId)) {
            throw new BusinessException(400, "不能给自己发送私信");
        }
        if (userMapper.selectById(toUserId) == null) {
            throw new BusinessException(404, "用户不存在");
        }
        Message m = new Message();
        m.setFromUserId(fromUserId);
        m.setToUserId(toUserId);
        m.setContent(content);
        m.setIsRead(0);
        messageMapper.insert(m);
        // 实时推送给接收者（在线则未读红点立即更新；离线时前端进页面主动拉取兜底）
        User from = userMapper.selectById(fromUserId);
        String fromName = from != null
                ? (from.getNickname() != null ? from.getNickname() : from.getUsername())
                : "某位玩家";
        pushService.pushMessage(toUserId, m.getId(), fromUserId, fromName, content);
        return m.getId();
    }

    @Override
    @Transactional
    public void markRead(Long userId, Long otherId) {
        messageMapper.update(null, Wrappers.<Message>lambdaUpdate()
                .eq(Message::getToUserId, userId)
                .eq(Message::getFromUserId, otherId)
                .set(Message::getIsRead, 1));
    }

    private MessageVO toVO(Message m) {
        MessageVO vo = new MessageVO();
        vo.setId(m.getId());
        vo.setFromUserId(m.getFromUserId());
        vo.setToUserId(m.getToUserId());
        vo.setContent(m.getContent());
        vo.setIsRead(m.getIsRead());
        vo.setCreatedAt(m.getCreatedAt());
        User u = userMapper.selectById(m.getFromUserId());
        vo.setFromNickname(u != null ? (u.getNickname() != null ? u.getNickname() : u.getUsername()) : "未知用户");
        return vo;
    }
}
