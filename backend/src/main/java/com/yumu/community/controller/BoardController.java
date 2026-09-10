package com.yumu.community.controller;

import com.yumu.community.common.Result;
import com.yumu.community.service.BoardService;
import com.yumu.community.vo.BoardVO;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/boards")
@RequiredArgsConstructor
public class BoardController {

    private final BoardService boardService;

    @GetMapping
    public Result<List<BoardVO>> tree(@RequestParam(required = false) Long gameId) {
        return Result.success(boardService.getTree(gameId));
    }

    @GetMapping("/{id}")
    public Result<BoardVO> detail(@PathVariable Long id) {
        return Result.success(boardService.getById(id));
    }
}
