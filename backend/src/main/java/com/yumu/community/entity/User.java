package com.yumu.community.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("`user`")
public class User extends BaseEntity {

    private String username;
    private String nickname;
    private String password;
    private String email;
    private String phone;
    private String avatar;
    private Integer gender;
    private String bio;
    private String hobbies;
    private String favoriteBoardIds;
    /** 喜欢的游戏 ID，逗号分隔；从游戏库多选。1.2 起替代 hobbies 的"游戏类爱好"场景。 */
    private String favoriteGameIds;
    private Integer status;
    private Integer points;
    /** 活跃度累计分（发帖×10 + 回帖×5 + 获赞×2 + 登录天数×3） */
    private Integer activityScore;
    /** 活跃度等级 1-5 */
    private Integer activityLevel;
    private LocalDateTime lastLoginAt;
    /** 上次修改登录账号(username)时间，用于「账号每隔一年可修改一次」限制；NULL 表示从未修改过 */
    private LocalDateTime lastUsernameChangeAt;
}
