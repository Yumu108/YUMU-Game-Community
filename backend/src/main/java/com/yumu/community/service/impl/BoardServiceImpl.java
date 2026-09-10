package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.entity.Board;
import com.yumu.community.entity.Post;
import com.yumu.community.mapper.BoardMapper;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.service.BoardService;
import com.yumu.community.vo.BoardVO;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class BoardServiceImpl implements BoardService {

    private final BoardMapper boardMapper;
    private final PostMapper postMapper;

    @Override
    public List<BoardVO> getTree(Long gameId) {
        // 1.2 起：固定六种分类（攻略心得/游戏吐槽/教学讨论/资讯速递/二次创作/其他），无父子层级
        List<Board> all = boardMapper.selectList(
                Wrappers.<Board>lambdaQuery()
                        .eq(Board::getStatus, 0)
                        .orderByAsc(Board::getSort));
        // 1.2：选中游戏后，板块帖数按 (board, game) 实时统计；不传则用 board.post_count 全站计数
        boolean perGame = gameId != null;
        List<BoardVO> list = new ArrayList<>();
        for (Board b : all) {
            BoardVO vo = toVO(b);
            if (perGame) {
                int n = Math.toIntExact(postMapper.selectCount(Wrappers.<Post>lambdaQuery()
                        .eq(Post::getBoardId, b.getId())
                        .eq(Post::getGameId, gameId)
                        .eq(Post::getStatus, 0)
                        .eq(Post::getDeleted, 0)));
                vo.setPostCount(n);
            }
            list.add(vo);
        }
        return list;
    }

    @Override
    public BoardVO getById(Long id) {
        Board b = boardMapper.selectById(id);
        if (b == null) {
            throw new BusinessException(404, "板块不存在");
        }
        return toVO(b);
    }

    private BoardVO toVO(Board b) {
        BoardVO vo = new BoardVO();
        vo.setId(b.getId());
        vo.setName(b.getName());
        vo.setDescription(b.getDescription());
        vo.setIcon(b.getIcon());
        vo.setParentId(b.getParentId());
        vo.setPostCount(b.getPostCount());
        vo.setSort(b.getSort());
        return vo;
    }
}
