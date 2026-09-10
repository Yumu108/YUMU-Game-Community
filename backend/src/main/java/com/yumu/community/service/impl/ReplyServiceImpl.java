package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.dto.CreateReplyRequest;
import com.yumu.community.entity.Notification;
import com.yumu.community.entity.Post;
import com.yumu.community.entity.Reply;
import com.yumu.community.entity.Role;
import com.yumu.community.entity.User;
import com.yumu.community.entity.Likes;
import com.yumu.community.entity.UserRole;
import com.yumu.community.mapper.LikesMapper;
import com.yumu.community.mapper.NotificationMapper;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.mapper.ReplyMapper;
import com.yumu.community.mapper.RoleMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.mapper.UserRoleMapper;
import com.yumu.community.service.ActivityScoreService;
import com.yumu.community.service.BadgeService;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.service.PointsService;
import com.yumu.community.service.ReplyService;
import com.yumu.community.security.ContentRiskService;
import com.yumu.community.security.HtmlSanitizer;
import com.yumu.community.security.RateLimiter;
import com.yumu.community.vo.ReplyVO;
import com.yumu.community.vo.UserIdentity;
import com.yumu.community.websocket.NotificationPushService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ReplyServiceImpl implements ReplyService {

    private final ReplyMapper replyMapper;
    private final PostMapper postMapper;
    private final UserMapper userMapper;
    private final UserRoleMapper userRoleMapper;
    private final RoleMapper roleMapper;
    private final NotificationMapper notificationMapper;
    private final LikesMapper likesMapper;

    /** 点赞操作的并发锁池：按 userId+replyId 串行化同一用户对同一回复的点赞/取消。 */
    private final ConcurrentHashMap<String, Object> toggleLocks = new ConcurrentHashMap<>();
    private Object lockOf(Long userId, Long replyId) {
        return toggleLocks.computeIfAbsent(userId + ":" + replyId, k -> new Object());
    }
    /** likes.target_type = 2（回复） */
    private static final int TARGET_REPLY = 2;
    private final BadgeService badgeService;
    private final ModeratorBoardService moderatorBoardService;
    private final ActivityScoreService activityScoreService;
    private final PointsService pointsService;
    private final NotificationPushService pushService;
    private final com.yumu.community.utils.MentionNotifier mentionNotifier;
    /** A1：服务端 HTML 净化（Jsoup 白名单）—— 防存储型 XSS。 */
    private final HtmlSanitizer htmlSanitizer;
    /** A2：回复限频器（Redis 滑动窗口）。 */
    private final RateLimiter rateLimiter;
    /** C1：敏感词 + 站外联系方式风控。 */
    private final ContentRiskService contentRisk;

    @Override
    public List<ReplyVO> listByPost(Long postId) {
        List<Reply> replies = replyMapper.selectList(
                Wrappers.<Reply>lambdaQuery()
                        .eq(Reply::getPostId, postId)
                        .eq(Reply::getStatus, 0)
                        .orderByAsc(Reply::getFloor));
        return toVO(replies);
    }

    @Override
    public List<ReplyVO> listAdminByPost(Long postId) {
        List<Reply> replies = replyMapper.selectList(
                Wrappers.<Reply>lambdaQuery()
                        .eq(Reply::getPostId, postId)
                        .orderByAsc(Reply::getFloor));
        return toVO(replies);
    }

    /** 回复实体 -> VO（含作者与被回复者信息；管理端调用方自行读 status 判断隐藏） */
    private List<ReplyVO> toVO(List<Reply> replies) {
        List<Long> userIds = replies.stream()
                .map(Reply::getUserId).distinct().toList();
        Map<Long, User> userMap = userIds.isEmpty() ? Map.of()
                : userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        // 被回复者昵称：replyToId 指向「父回复」，先取父回复的 userId，
        // 再从作者批 userMap 拿昵称（修复：旧代码用 replyToId 直接查 user 表，恒为“未知用户”）
        Map<Long, Long> replyOwner = replies.stream()
                .filter(r -> r.getId() != null)
                .collect(Collectors.toMap(Reply::getId, Reply::getUserId, (a, b) -> a));
        Function<Long, String> nickOf = (Long uid) -> {
            User uu = userMap.get(uid);
            return uu != null ? (uu.getNickname() != null ? uu.getNickname() : uu.getUsername()) : null;
        };
        // 批量取作者角色 + 负责板块（一次性 DB，避免 N+1）
        Map<Long, List<String>> rolesMap = batchRoles(userIds);
        Map<Long, List<Long>> mbMap = new java.util.HashMap<>();
        for (Long uid : userIds) mbMap.put(uid, moderatorBoardService.listBoardIdsByUserId(uid));
        return replies.stream().map(r -> {
            ReplyVO vo = new ReplyVO();
            vo.setId(r.getId());
            vo.setPostId(r.getPostId());
            vo.setUserId(r.getUserId());
            vo.setContent(r.getContent());
            vo.setReplyToId(r.getReplyToId());
            vo.setFloor(r.getFloor());
            vo.setLikeCount(r.getLikeCount());
            vo.setStatus(r.getStatus() == null ? 0 : r.getStatus());
            vo.setCreatedAt(r.getCreatedAt());
            User u = userMap.get(r.getUserId());
            vo.setAuthorName(u != null ? (u.getNickname() != null ? u.getNickname() : u.getUsername()) : "未知用户");
            vo.setAuthorAvatar(u != null ? u.getAvatar() : null);
            // 父回复的作者昵称（父回复已软删除/不存在时返回 null，前端不加前缀）
            Long parentUserId = r.getReplyToId() != null ? replyOwner.get(r.getReplyToId()) : null;
            vo.setReplyToName(parentUserId != null ? nickOf.apply(parentUserId) : null);
            vo.setReplyToUserId(parentUserId); // 前端点击「回复 @昵称」前缀 → 被回复者个人主页
            // 身份徽章 + 活跃度等级
            if (u != null) {
                List<String> roles = rolesMap.getOrDefault(u.getId(), java.util.Collections.emptyList());
                List<Long> mbs = mbMap.getOrDefault(u.getId(), java.util.Collections.emptyList());
                UserIdentity id = badgeService.compute(u, roles, mbs);
                vo.setAuthorBadge(id.getBadge());
                vo.setAuthorBadgeColor(id.getBadgeColor());
                vo.setAuthorLevel(id.getLevel());
                vo.setAuthorLevelTitle(id.getLevelTitle());
            }
            return vo;
        }).toList();
    }

    /** 批量取用户角色 code 列表（一次 user_role + 一次 role selectBatchIds）。 */
    private Map<Long, List<String>> batchRoles(java.util.Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) return java.util.Collections.emptyMap();
        List<UserRole> urs = userRoleMapper.selectList(
                Wrappers.<UserRole>lambdaQuery().in(UserRole::getUserId, userIds));
        if (urs.isEmpty()) return java.util.Collections.emptyMap();
        java.util.Set<Long> roleIds = urs.stream().map(UserRole::getRoleId).collect(java.util.stream.Collectors.toSet());
        Map<Long, String> roleCodeMap = roleMapper.selectBatchIds(roleIds).stream()
                .collect(Collectors.toMap(Role::getId, Role::getCode));
        return urs.stream().collect(Collectors.groupingBy(
                UserRole::getUserId,
                Collectors.mapping(ur -> roleCodeMap.getOrDefault(ur.getRoleId(), "UNKNOWN"),
                        Collectors.toList())));
    }

    @Override
    @Transactional
    public Long createReply(CreateReplyRequest req, Long userId) {
        if (req.getPostId() == null) throw new BusinessException(400, "帖子 ID 不能为空");
        // A2：回复限频——单用户 1 分钟最多 10 条，防脚本灌楼
        if (!rateLimiter.tryAcquire("reply:user:" + userId, 10, 60)) {
            throw new BusinessException(429, "回复太频繁，请稍后再试");
        }
        Post post = postMapper.selectById(req.getPostId());
        // 帖子不存在 → 404；存在但未公开（待审核 2 / 隐藏·驳回 1）→ 403 并给出可读原因，
        // 避免用户看到莫名其妙的「帖子不存在」（2026-09-08 修复）。
        if (post == null) {
            throw new BusinessException(404, "帖子不存在");
        }
        if (post.getStatus() != null && post.getStatus() != 0) {
            throw new BusinessException(403,
                    post.getStatus() == 2 ? "帖子正在审核中，审核通过后才能评论" : "该帖已不可见，暂不支持评论");
        }
        long count = replyMapper.selectCount(
                Wrappers.<Reply>lambdaQuery().eq(Reply::getPostId, req.getPostId()));
        // C1：回复直接发布、没有预审环节 → 违禁词与站外联系方式一律硬拦截（400 可读提示）
        contentRisk.assertNoBannedWord(req.getContent());
        if (contentRisk.hasContactInfo(req.getContent())) {
            throw new BusinessException(400, "回复中请勿留微信、QQ 等站外联系方式，谨防诈骗；如需交流请在站内私信联系");
        }
        Reply reply = new Reply();
        reply.setPostId(req.getPostId());
        reply.setUserId(userId);
        // A1：先 Jsoup 剥 XSS 载荷，再 @ 规范化入库（在 mentionNotifier 内统一处理）
        reply.setContent(htmlSanitizer.sanitize(req.getContent()));
        reply.setReplyToId(req.getReplyToId());
        reply.setFloor((int) count + 1);
        reply.setStatus(0);
        reply.setLikeCount(0);
        replyMapper.insert(reply);
        postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                .eq(Post::getId, req.getPostId()).setSql("reply_count = reply_count + 1"));
        // 评论通知：通知帖子作者（不给自己发的帖子发）
        if (!userId.equals(post.getUserId())) {
            Notification n = new Notification();
            n.setUserId(post.getUserId());
            n.setType(2);
            n.setSenderId(userId);
            n.setTargetType(1);
            n.setTargetId(post.getId());
            n.setSourceId(reply.getId());
            n.setContent("回复了你的帖子");
            n.setIsRead(0);
            notificationMapper.insert(n);
            // 实时推送：在线作者红点立即亮起
            pushService.pushNotification(post.getUserId(), n.getId(), 2, "回复了你的帖子", userId, post.getId());
        }
        // 楼中楼：通知被回复者（区别于作者、且不是自己）。replyToId 指向被回复的回复，取其作者
        if (req.getReplyToId() != null) {
            Reply replied = replyMapper.selectById(req.getReplyToId());
            if (replied != null) {
                Long repliedUserId = replied.getUserId();
                if (!repliedUserId.equals(userId) && !repliedUserId.equals(post.getUserId())) {
                    Notification n2 = new Notification();
                    n2.setUserId(repliedUserId);
                    n2.setType(2);
                    n2.setSenderId(userId);
                    n2.setTargetType(1);
                    n2.setTargetId(post.getId());
                    n2.setSourceId(reply.getId());
                    n2.setContent("回复了你");
                    n2.setIsRead(0);
                    notificationMapper.insert(n2);
                    pushService.pushNotification(repliedUserId, n2.getId(), 2, "回复了你", userId, post.getId());
                }
            }
        }
        // 活跃度：回帖 +5；积分：回帖 +2
        activityScoreService.onReplyCreated(userId);
        pointsService.addPoints(userId, 3, 2, "回帖奖励", reply.getId());
        // @提及通知（type=6）：解析回帖正文里的 @昵称，向被 @ 用户发送「有人@你」
        mentionNotifier.notify(String.valueOf(reply.getPostId()), 2, reply.getId(),
                req.getContent(), userId);
        return reply.getId();
    }

    @Override
    @Transactional
    public Map<String, Object> setHidden(Long replyId, boolean hidden) {
        Reply r = replyMapper.selectById(replyId);
        if (r == null) throw new BusinessException(404, "回复不存在");
        int status = hidden ? 1 : 0;
        int oldStatus = r.getStatus() != null ? r.getStatus() : 0;
        if (oldStatus != status) {
            replyMapper.update(null, Wrappers.<Reply>lambdaUpdate()
                    .eq(Reply::getId, replyId).set(Reply::getStatus, status));
            // 同步帖子回复数：隐藏 -1，恢复 +1
            int delta = hidden ? -1 : 1;
            postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                    .eq(Post::getId, r.getPostId())
                    .setSql("reply_count = reply_count + " + delta));
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", status);
        return m;
    }

    @Override
    @Transactional
    public Map<String, Object> deleteOwnReply(Long replyId, Long operatorId) {
        Reply r = replyMapper.selectById(replyId);
        if (r == null) throw new BusinessException(404, "回复不存在");
        // 权限：仅回复作者本人或 ADMIN；版主无权（版主走 setHidden 隐藏接口）
        if (operatorId == null) throw new BusinessException(401, "请先登录");
        List<String> roles = batchRoles(java.util.Collections.singletonList(operatorId))
                .getOrDefault(operatorId, java.util.Collections.emptyList());
        boolean isAdmin = roles.contains("ADMIN");
        if (!isAdmin && !operatorId.equals(r.getUserId())) {
            throw new BusinessException(403, "只能删除自己的回复");
        }
        // 软删除（listByPost 的 status=0 过滤自动不再展示，MyBatis-Plus @TableLogic 也使查询不可见）
        replyMapper.deleteById(replyId);
        // 帖子回复数 -1（仅帖子可见时计数；隐藏帖 reply_count 已不包含此回帖）
        Post post = postMapper.selectById(r.getPostId());
        if (post != null && post.getStatus() != null && post.getStatus() == 0) {
            postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                    .eq(Post::getId, r.getPostId())
                    .setSql("reply_count = GREATEST(reply_count - 1, 0)"));
        }
        // 楼中楼场景：礼貌性通知被回复者「xxx 删除了对你的回复」
        // 仅在 replyToId 非空、被回复者存在且不是操作者本人时发
        //
        // 🚨 必须走 upsertByMergeKey，不能直接 insert：notification 的唯一键是
        //    uk_noti_merge(user_id, type, target_id, source_id)，而本通知与「回复了你」
        //    （同被回复者、type=2、同帖子、同回复 id）**用的是完全相同的组合键**。
        //    直接 insert 会 Duplicate entry → 整个删帖事务 500（删除楼中楼必然失败）。
        //    语义上也应复用同一条：该行本就代表"你与这条回复的交互"，覆盖文案即可。
        if (r.getReplyToId() != null) {
            Reply replied = replyMapper.selectById(r.getReplyToId());
            if (replied != null && !replied.getUserId().equals(operatorId)) {
                Notification n = new Notification();
                n.setUserId(replied.getUserId());
                n.setType(2);
                n.setSenderId(operatorId);
                n.setTargetType(1);
                n.setTargetId(r.getPostId());
                n.setSourceId(replyId);
                n.setContent("删除了对你的回复");
                notificationMapper.upsertByMergeKey(n);
                pushService.pushNotification(replied.getUserId(), n.getId(), 2, "删除了对你的回复", operatorId, r.getPostId());
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("deleted", true);
        return m;
    }

    @Override
    @Transactional
    public Map<String, Object> toggleLike(Long replyId, Long userId) {
        // 1.2：回复点赞。同一用户对同一回复的点赞操作串行化，避免唯一键冲突与计数漂移
        synchronized (lockOf(userId, replyId)) {
            Reply reply = replyMapper.selectById(replyId);
            if (reply == null) throw new BusinessException(404, "回复不存在");
            Long activeCount = likesMapper.selectCount(
                    Wrappers.<Likes>lambdaQuery()
                            .eq(Likes::getUserId, userId)
                            .eq(Likes::getTargetType, TARGET_REPLY)
                            .eq(Likes::getTargetId, replyId)
                            .eq(Likes::getDeleted, 0));
            boolean liked = activeCount != null && activeCount > 0;
            // 防御性物理清理（避免逻辑删除后唯一键冲突）
            likesMapper.physicalDeleteByTarget(userId, TARGET_REPLY, replyId);
            Map<String, Object> result = new LinkedHashMap<>();
            if (liked) {
                // 已点赞 → 取消
                replyMapper.update(null, Wrappers.<Reply>lambdaUpdate()
                        .eq(Reply::getId, replyId)
                        .setSql("like_count = GREATEST(like_count - 1, 0)"));
                result.put("liked", false);
            } else {
                // 未点赞 → 新增
                Likes like = new Likes();
                like.setUserId(userId);
                like.setTargetType(TARGET_REPLY);
                like.setTargetId(replyId);
                likesMapper.insert(like);
                replyMapper.update(null, Wrappers.<Reply>lambdaUpdate()
                        .eq(Reply::getId, replyId)
                        .setSql("like_count = like_count + 1"));
                result.put("liked", true);
                // 活跃度：被点赞 +2（被回复作者加分；自己赞自己不计）
                if (!userId.equals(reply.getUserId())) {
                    activityScoreService.onLiked(reply.getUserId());
                }
            }
            // 重新读最新计数（避免并发下读取陈旧值）
            Reply fresh = replyMapper.selectById(replyId);
            result.put("likeCount", fresh.getLikeCount() == null ? 0 : fresh.getLikeCount());
            return result;
        }
    }
}
