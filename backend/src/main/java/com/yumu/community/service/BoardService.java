package com.yumu.community.service;

import com.yumu.community.vo.BoardVO;

import java.util.List;

public interface BoardService {

    /**
     * 板块列表（1.2 起固定六种分类，无父子层级）。
     * 返回 status=0 的全部板块，按 sort 升序。
     * @param gameId 可选；若传入则每个 board 的 postCount = 该游戏在该板块的可见帖数（status=0, deleted=0）；否则用 board.post_count 全站计数。
     */
    List<BoardVO> getTree(Long gameId);

    /**
     * 单个板块详情。
     */
    BoardVO getById(Long id);
}
