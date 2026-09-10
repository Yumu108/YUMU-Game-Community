package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.entity.Board;
import com.yumu.community.entity.Game;
import com.yumu.community.vo.FollowUserVO;
import com.yumu.community.vo.PostVO;

import java.util.List;
import java.util.Map;

public interface SearchService {

    /** 综合搜索：帖子(分页) + 板块 + 用户 + 游戏 */
    Map<String, Object> searchAll(String keyword, Long userId);

    /** 仅搜帖子（分页） */
    PageResult<PostVO> searchPosts(String keyword, long current, long size, Long userId);

    /** 仅搜板块 */
    List<Board> searchBoards(String keyword);

    /** 仅搜用户 */
    List<FollowUserVO> searchUsers(String keyword);

    /** 仅搜游戏（按 name/platform/platform LIKE） */
    List<Game> searchGames(String keyword);
}
