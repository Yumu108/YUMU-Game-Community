package com.yumu.community.vo;

import lombok.Data;

/**
 * 游戏精简信息（仅展示用字段）。
 * 用于「个人爱好 — 多选游戏」等场景，避免把 Game 实体的 status/postCount/sort/deleted 等内部字段暴露给前端。
 */
@Data
public class GameMiniVO {

    private Long id;
    private String name;
    private String cover;
    private String platform;
    private String genre;
}