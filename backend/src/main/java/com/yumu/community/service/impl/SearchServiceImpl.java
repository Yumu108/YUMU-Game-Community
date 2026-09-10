package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.PageResult;
import com.yumu.community.entity.Board;
import com.yumu.community.entity.Game;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.BoardMapper;
import com.yumu.community.mapper.GameMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.PostService;
import com.yumu.community.service.SearchService;
import com.yumu.community.vo.FollowUserVO;
import com.yumu.community.vo.PostVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class SearchServiceImpl implements SearchService {

    private final PostService postService;
    private final BoardMapper boardMapper;
    private final UserMapper userMapper;
    private final GameMapper gameMapper;

    private static final int PREVIEW_LIMIT = 8;

    @Override
    public Map<String, Object> searchAll(String keyword, Long userId) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("posts", postService.searchPosts(keyword, 1, PREVIEW_LIMIT, userId));
        map.put("boards", searchBoards(keyword));
        map.put("users", searchUsers(keyword));
        map.put("games", searchGames(keyword));
        return map;
    }

    @Override
    public PageResult<PostVO> searchPosts(String keyword, long current, long size, Long userId) {
        return postService.searchPosts(keyword, current, size, userId);
    }

    @Override
    public List<Board> searchBoards(String keyword) {
        if (keyword == null || keyword.trim().isEmpty()) return List.of();
        return boardMapper.selectList(Wrappers.<Board>lambdaQuery()
                .like(Board::getName, keyword)
                .or()
                .like(Board::getDescription, keyword))
                .stream().limit(PREVIEW_LIMIT).toList();
    }

    @Override
    public List<FollowUserVO> searchUsers(String keyword) {
        if (keyword == null || keyword.trim().isEmpty()) return List.of();
        List<User> users = userMapper.selectList(Wrappers.<User>lambdaQuery()
                        .like(User::getNickname, keyword)
                        .or()
                        .like(User::getUsername, keyword))
                .stream().limit(PREVIEW_LIMIT).toList();
        return users.stream().map(u -> {
            FollowUserVO vo = new FollowUserVO();
            vo.setId(u.getId());
            vo.setNickname(u.getNickname());
            vo.setAvatar(u.getAvatar());
            vo.setBio(u.getBio());
            return vo;
        }).toList();
    }

    @Override
    public List<Game> searchGames(String keyword) {
        if (keyword == null || keyword.trim().isEmpty()) return List.of();
        // 名称/平台/类型/发行商 命中任一即可，且只展示前台可见的（status=0）；排序与 /games 一致
        return gameMapper.selectList(Wrappers.<Game>lambdaQuery()
                .and(w -> w.like(Game::getName, keyword)
                        .or().like(Game::getPlatform, keyword)
                        .or().like(Game::getGenre, keyword)
                        .or().like(Game::getPublisher, keyword))
                .eq(Game::getStatus, 0)
                .orderByDesc(Game::getIsHot)
                .orderByDesc(Game::getId)
                .last("LIMIT " + PREVIEW_LIMIT));
    }
}
