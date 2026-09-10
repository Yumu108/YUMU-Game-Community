package com.yumu.community.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 修改个人资料（昵称 / 头像 / 签名 / 爱好 / 常看板块）。
 * 全部可选，缺省字段不更新。
 */
@Data
public class UpdateProfileRequest {

    @Size(max = 50, message = "昵称过长")
    private String nickname;

    @Size(max = 255, message = "头像地址过长")
    private String avatar;

    @Size(max = 200, message = "个性签名过长")
    private String bio;

    @Size(max = 200, message = "爱好标签过长")
    private String hobbies;

    @Size(max = 500, message = "常看板块数据过长")
    private String favoriteBoardIds;

    /** 喜欢的游戏 ID，逗号分隔；从游戏库多选。1.2 起替代 hobbies 的"游戏类爱好"场景。 */
    @Size(max = 500, message = "游戏爱好数据过长")
    private String favoriteGameIds;
}
