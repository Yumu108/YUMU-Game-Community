package com.yumu.community.service;

import com.yumu.community.dto.CreateReplyRequest;
import com.yumu.community.vo.ReplyVO;

import java.util.List;
import java.util.Map;

public interface ReplyService {

    /**
     * 帖子下的回复列表（按楼层升序），含作者与被回复者信息。
     */
    List<ReplyVO> listByPost(Long postId);

    /**
     * 发布回复，返回新回复 id。
     */
    Long createReply(CreateReplyRequest req, Long userId);

    /**
     * 切换点赞状态（针对回复）。
     * 同一用户对同一回复的点赞操作串行化（按 userId+replyId 锁池），避免并发竞态。
     * 返回 { liked: boolean, likeCount: number }。
     */
    Map<String, Object> toggleLike(Long replyId, Long userId);

    /**
     * 隐藏/恢复回复（后台审核）：hidden=true → status=1（隐藏），false → status=0（可见）。
     * 返回 {status: 新状态}。仅管理员/版主（且负责对应板块）可用。
     */
    Map<String, Object> setHidden(Long replyId, boolean hidden);

    /**
     * 管理端查看某帖子全部回复（含隐藏），用于回帖审核与恢复。
     */
    List<ReplyVO> listAdminByPost(Long postId);

    /**
     * 作者本人 / ADMIN 删除自己的回帖（软删除 deleted=1）。
     * 权限校验：仅回帖作者本人或 ADMIN；版主无权（版主审核走 setHidden 隐藏接口）。
     * 副作用：
     *   - 帖子 reply_count -1（隐藏帖计数走 setHidden 路径；这里是物理移除计数）
     *   - 若该回帖为楼中楼（replyToId 非空），通知被回复者「xxx 删除了对你的回复」
     *   - 同步发通知给帖子作者（若非本人自删自帖）
     * 返回 {deleted: true}。
     */
    Map<String, Object> deleteOwnReply(Long replyId, Long operatorId);
}
