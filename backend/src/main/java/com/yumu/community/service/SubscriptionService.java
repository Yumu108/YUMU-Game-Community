package com.yumu.community.service;

import java.util.List;
import java.util.Map;

public interface SubscriptionService {

    /** 切换板块订阅，返回当前是否已订阅。 */
    boolean toggleBoard(Long userId, Long boardId);

    /** 切换关键词订阅，返回当前是否已订阅。 */
    boolean toggleKeyword(Long userId, String keyword);

    /** 当前用户的所有订阅：{ boards:[{id,name,icon}], keywords:[字符串] }。 */
    Map<String, Object> listSubscriptions(Long userId);
}
