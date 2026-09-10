package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.vo.ConversationVO;
import com.yumu.community.vo.MessageVO;

import java.util.List;

public interface MessageService {

    /** 当前用户的私信会话列表（按最近联系时间） */
    List<ConversationVO> listConversations(Long userId);

    /** 与某用户的对话记录（分页，倒序） */
    PageResult<MessageVO> listMessages(Long userId, Long otherId, long current, long size);

    /** 发送私信，返回消息 id */
    Long send(Long fromUserId, Long toUserId, String content);

    /** 把与某用户的对话标记为已读 */
    void markRead(Long userId, Long otherId);
}
