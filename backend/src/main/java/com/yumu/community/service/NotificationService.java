package com.yumu.community.service;

import com.yumu.community.vo.NotificationVO;

import java.util.List;

public interface NotificationService {

    /** 我的通知列表（含系统公告），按时间倒序 */
    List<NotificationVO> list(Long userId);

    /** 未读数量 */
    long unreadCount(Long userId);

    /** 标记已读：id 为空则全部已读 */
    void markRead(Long userId, Long id);

    /** 清空已读：删除当前用户 is_read=1 的通知；types 为空则不限类型（全部），否则只删指定类型 */
    void clearRead(Long userId, List<Integer> types);
}
