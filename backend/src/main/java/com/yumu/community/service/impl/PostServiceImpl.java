package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.cache.CacheService;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.dto.CreatePostRequest;
import com.yumu.community.entity.Board;
import com.yumu.community.entity.Favorite;
import com.yumu.community.entity.Game;
import com.yumu.community.entity.Likes;
import com.yumu.community.entity.ModeratorBoard;
import com.yumu.community.entity.Notification;
import com.yumu.community.entity.Post;
import com.yumu.community.entity.PostTag;
import com.yumu.community.entity.PointsLog;
import com.yumu.community.entity.Tag;
import com.yumu.community.entity.Role;
import com.yumu.community.entity.Subscription;
import com.yumu.community.entity.User;
import com.yumu.community.entity.UserRole;
import com.yumu.community.mapper.BoardMapper;
import com.yumu.community.mapper.FavoriteMapper;
import com.yumu.community.mapper.GameMapper;
import com.yumu.community.mapper.LikesMapper;
import com.yumu.community.mapper.NotificationMapper;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.mapper.PostTagMapper;
import com.yumu.community.mapper.PointsLogMapper;
import com.yumu.community.mapper.RoleMapper;
import com.yumu.community.mapper.SubscriptionMapper;
import com.yumu.community.mapper.TagMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.utils.MentionParser;
import com.yumu.community.mapper.UserRoleMapper;
import com.yumu.community.security.ContentRiskService;
import com.yumu.community.security.HtmlSanitizer;
import com.yumu.community.security.RateLimiter;
import com.yumu.community.service.ActivityScoreService;
import com.yumu.community.service.BadgeService;
import com.yumu.community.service.GameService;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.service.PointsService;
import com.yumu.community.service.PostService;
import com.yumu.community.service.TagService;
import com.yumu.community.vo.PostVO;
import com.yumu.community.vo.TagVO;
import com.yumu.community.websocket.NotificationPushService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class PostServiceImpl implements PostService {

    private final PostMapper postMapper;
    private final BoardMapper boardMapper;
    private final GameMapper gameMapper;
    private final UserMapper userMapper;
    private final UserRoleMapper userRoleMapper;
    private final RoleMapper roleMapper;
    private final LikesMapper likesMapper;
    private final FavoriteMapper favoriteMapper;
    private final NotificationMapper notificationMapper;
    private final TagService tagService;
    private final TagMapper tagMapper;
    private final PostTagMapper postTagMapper;
    private final CacheService cache;
    private final BadgeService badgeService;
    private final ModeratorBoardService moderatorBoardService;
    private final ActivityScoreService activityScoreService;
    private final PointsService pointsService;
    private final GameService gameService;
    private final SubscriptionMapper subscriptionMapper;
    private final com.yumu.community.utils.MentionNotifier mentionNotifier;
    private final com.yumu.community.mapper.FollowMapper followMapper;
    private final NotificationPushService pushService;
    private final PointsLogMapper pointsLogMapper;
    /** A1：服务端 HTML 净化（Jsoup 白名单）—— 防存储型 XSS。 */
    private final HtmlSanitizer htmlSanitizer;
    /** A2：发帖限频器（Redis 滑动窗口）。 */
    private final RateLimiter rateLimiter;

    /** C1：敏感词 + 站外联系方式风控。 */
    private final ContentRiskService contentRisk;

    /** 列表分页上限，防 size 过大导致慢查询（DoS 兜底）。 */
    private static final long MAX_PAGE_SIZE = 100;

    private static final int TARGET_POST = 1;

    /**
     * toggle 锁池：按 userId:targetId 加 JVM 级互斥，串行化同一用户对同一目标的点赞/收藏操作，
     * 避免并发下 SELECT→DELETE→INSERT 竞态导致的唯一键冲突/死锁。单实例部署足够；对象不清理（量级很小）。
     */
    private final ConcurrentHashMap<String, Object> toggleLocks = new ConcurrentHashMap<>();

    private Object lockOf(Long userId, Long targetId) {
        return toggleLocks.computeIfAbsent(userId + ":" + targetId, k -> new Object());
    }

    private static long clampCurrent(long current) { return Math.max(1, current); }
    private static long clampSize(long size) { return Math.min(MAX_PAGE_SIZE, Math.max(1, size)); }

    @Override
    public PageResult<PostVO> pagePosts(Long boardId, Long gameId, String sort, long current, long size, Long userId) {
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Post> qw = new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        if (boardId != null) {
            qw.eq("board_id", boardId);
        }
        if (gameId != null) {
            // 进入游戏库选中某游戏后，仅展示该游戏的帖子；不传 gameId 表示全部游戏
            qw.eq("game_id", gameId);
        }
        qw.eq("status", 0);
        String s = sort == null ? "latest" : sort;
        switch (s) {
            case "all":
                // 「全部」：不分页，一次性返回所有该游戏可见帖（置顶优先 + 时间倒序）
                qw.orderByDesc("is_top");
                qw.orderByDesc("created_at");
                qw.orderByDesc("id");
                List<PostVO> allVos = toVOList(postMapper.selectList(qw), userId);
                int an = allVos.size();
                return PageResult.of(an, 1, 1, Math.max(1, an), allVos);
            case "hot":
                // 「热门」：综合 = 浏览 + 点赞*2 + 评论*3 + 收藏（收藏用子查询统计）
                qw.last("ORDER BY (view_count + like_count * 2 + reply_count * 3 + "
                        + "(SELECT COUNT(*) FROM favorite f WHERE f.post_id = post.id AND f.deleted = 0)) "
                        + "DESC, created_at DESC, id DESC");
                break;
            case "essence":
                // 「精华」：不分页，返回所有被标为精华的帖子
                qw.eq("is_essence", 1);
                qw.orderByDesc("created_at");
                qw.orderByDesc("id");
                List<PostVO> essenceVos = toVOList(postMapper.selectList(qw), userId);
                int en = essenceVos.size();
                return PageResult.of(en, 1, 1, Math.max(1, en), essenceVos);
            case "reply":
                // 「最多回复」：评论数倒序
                qw.orderByDesc("reply_count");
                qw.orderByDesc("created_at");
                qw.orderByDesc("id");
                break;
            case "favorite":
                // 「最多收藏」：收藏数倒序（用子查询统计，post 表未冗余 favorite_count）
                qw.last("ORDER BY (SELECT COUNT(*) FROM favorite f WHERE f.post_id = post.id AND f.deleted = 0) "
                        + "DESC, created_at DESC, id DESC");
                break;
            case "latest":
            default:
                // 「最新」：置顶优先 + 时间倒序
                qw.orderByDesc("is_top");
                qw.orderByDesc("created_at");
                qw.orderByDesc("id");
        }
        Page<Post> res = postMapper.selectPage(page, qw);
        List<PostVO> vos = toVOList(res.getRecords(), userId);
        // 分页：透传真实 total（2026-09-10 放开）。
        // 历史坑：这里曾把 hot/reply/favorite/latest 的 total 截断到 pageSize 以「隐藏分页」，
        //   叠加前端把 `PAGE_SIZE` 误写成 `pageSize`（未定义），导致首页/板块页分页条从不出现，
        //   且 189 条帖只能靠「全部」tab 一次性看全。现统一改为真实分页。
        // 「全部 / 精华」仍是一次性返回全部、不分页（见上面 case 分支）。
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    @Override
    public PageResult<PostVO> postsByUser(Long userId, long current, long size, Long viewerId) {
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Post> qw = new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        qw.eq("user_id", userId);
        // 作者本人查看自己的帖子列表时包含隐藏/待审核（便于管理），其他人仅可见 status=0
        boolean selfView = viewerId != null && viewerId.equals(userId);
        if (!selfView) {
            qw.eq("status", 0);
        }
        // 置顶优先 + 时间倒序，与个人主页直观一致
        qw.orderByDesc("is_top");
        qw.orderByDesc("created_at");
        qw.orderByDesc("id");
        Page<Post> res = postMapper.selectPage(page, qw);
        List<PostVO> vos = toVOList(res.getRecords(), viewerId);
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    @Override
    public PageResult<PostVO> pagePostsByGame(Long gameId, long current, long size, Long viewerId) {
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Post> qw = new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        qw.eq("game_id", gameId);
        qw.eq("status", 0);
        qw.orderByDesc("is_top");
        qw.orderByDesc("created_at");
        qw.orderByDesc("id");
        Page<Post> res = postMapper.selectPage(page, qw);
        List<PostVO> vos = toVOList(res.getRecords(), viewerId);
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    @Override
    public PageResult<PostVO> pagePersonalizedFeed(Long userId, long current, long size) {
        List<Subscription> subs = subscriptionMapper.selectList(Wrappers.<Subscription>lambdaQuery()
                .eq(Subscription::getUserId, userId)
                .eq(Subscription::getDeleted, 0));
        List<Long> boardIds = subs.stream()
                .filter(s -> s.getSubType() != null && s.getSubType() == 1 && s.getTargetId() != null)
                .map(Subscription::getTargetId)
                .collect(Collectors.toList());
        List<String> keywords = subs.stream()
                .filter(s -> s.getSubType() != null && s.getSubType() == 2
                        && s.getKeyword() != null && !s.getKeyword().isBlank())
                .map(Subscription::getKeyword)
                .collect(Collectors.toList());
        if (boardIds.isEmpty() && keywords.isEmpty()) {
            return PageResult.of(0, 0, clampCurrent(current), clampSize(size), List.of());
        }
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Post> qw =
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        qw.eq("status", 0).eq("deleted", 0);
        qw.and(w -> {
            if (!boardIds.isEmpty()) w.in("board_id", boardIds);
            for (String kw : keywords) {
                w.or().like("title", kw).or().like("summary", kw);
            }
        });
        qw.orderByDesc("created_at");
        qw.orderByDesc("id");
        Page<Post> res = postMapper.selectPage(page, qw);
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(),
                toVOList(res.getRecords(), userId));
    }

    @Override
    public PageResult<PostVO> pageFollowingFeed(Long userId, String sort, long current, long size) {
        // 仅取「关注的人」（follow.follow_type=1）；关注的游戏不混入此处，避免新号因选了爱好游戏就看到满屏帖子。
        List<Long> followedUserIds = followMapper.selectList(
                Wrappers.<com.yumu.community.entity.Follow>lambdaQuery()
                        .eq(com.yumu.community.entity.Follow::getUserId, userId)
                        .eq(com.yumu.community.entity.Follow::getFollowType, 1)
                        .eq(com.yumu.community.entity.Follow::getDeleted, 0))
                .stream().map(com.yumu.community.entity.Follow::getFollowId).collect(Collectors.toList());
        if (followedUserIds.isEmpty()) {
            return PageResult.of(0, 0, clampCurrent(current), clampSize(size), List.of());
        }
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Post> qw =
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        qw.eq("status", 0).eq("deleted", 0);
        qw.in("user_id", followedUserIds);

        String s = sort == null ? "latest" : sort;
        switch (s) {
            case "all":
                // 「全部」：不分页，一次性返回所有关注人可见帖（置顶优先 + 时间倒序）
                qw.orderByDesc("is_top").orderByDesc("created_at");
                List<PostVO> allVos = toVOList(postMapper.selectList(qw), userId);
                int an = allVos.size();
                return PageResult.of(an, 1, 1, Math.max(1, an), allVos);
            case "hot":
                // 「热门」：综合 = 浏览 + 点赞*2 + 评论*3 + 收藏
                qw.last("ORDER BY (view_count + like_count * 2 + reply_count * 3 + "
                        + "(SELECT COUNT(*) FROM favorite f WHERE f.post_id = post.id AND f.deleted = 0)) "
                        + "DESC, created_at DESC, id DESC");
                break;
            case "essence":
                // 「精华」：仅被标为精华的帖子，不分页
                qw.eq("is_essence", 1);
                qw.orderByDesc("created_at");
                qw.orderByDesc("id");
                List<PostVO> essenceVos = toVOList(postMapper.selectList(qw), userId);
                int en = essenceVos.size();
                return PageResult.of(en, 1, 1, Math.max(1, en), essenceVos);
            case "reply":
                // 「最多回复」
                qw.orderByDesc("reply_count").orderByDesc("created_at");
                break;
            case "favorite":
                // 「最多收藏」
                qw.last("ORDER BY (SELECT COUNT(*) FROM favorite f WHERE f.post_id = post.id AND f.deleted = 0) "
                        + "DESC, created_at DESC, id DESC");
                break;
            case "latest":
            default:
                // 「最新」：置顶优先 + 时间倒序
                qw.orderByDesc("is_top").orderByDesc("created_at");
        }
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        Page<Post> res = postMapper.selectPage(page, qw);
        List<PostVO> vos = toVOList(res.getRecords(), userId);
        // 分页：与 pagePosts 一致，透传真实 total（不再截断，见 pagePosts 处的历史说明）
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    @Override
    public PostVO getDetail(Long id, Long userId) {
        Post p = postMapper.selectById(id);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        // 可见性矩阵：
        //   - status=0（正常）：所有人可见
        //   - status=1（隐藏/驳回）：作者本人可见（普通浏览） / 管理员全权预览 / 版主按 (游戏,板块) 覆盖预览 / 其他 404
        //   - status=2（待审核）：作者本人可见（方便管理自己发的待审帖），其余 404（管理员/版主走 /admin/posts/{id}/detail 审核接口）
        // 预览态（管理员/版主看隐藏帖）：previewOnly=true，不计入 view_count，避免污染真实浏览量
        boolean selfView = userId != null && userId.equals(p.getUserId());
        boolean previewOnly = false;
        if (p.getStatus() != null && p.getStatus() != 0) {
            if (selfView) {
                // 作者本人：走正常浏览
            } else if (userId != null && (p.getStatus() == 1 || p.getStatus() == 2)) {
                // 已隐藏帖(1) / 待审核帖(2)：仅管理员 / 负责该(游戏,板块)的版主可预览
                // 2026-09-08：待审帖此前对管理员也是 404，导致「举报队列 → 查看帖子」跳到待审帖时是死链
                List<String> roles = loadUserRoles(userId);
                if (roles.contains("ADMIN")) {
                    previewOnly = true;
                } else if (roles.contains("MODERATOR")
                        && moderatorBoardService.covers(userId, p.getGameId(), p.getBoardId())) {
                    previewOnly = true;
                } else {
                    throw new BusinessException(404, "帖子不存在");
                }
            } else {
                throw new BusinessException(404, "帖子不存在");
            }
        }
        // 浏览量 +1：仅「正常浏览」计入；预览态不计入，避免管理员反复审核把 view_count 撑大
        if (!previewOnly) {
            postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                    .eq(Post::getId, id)
                    .setSql("view_count = view_count + 1"));
            p.setViewCount(p.getViewCount() + 1);
        }
        PostVO vo = toVOList(List.of(p), userId).get(0);
        vo.setTags(tagService.getPostTags(id));
        vo.setPreviewOnly(previewOnly);
        return vo;
    }

    /**
     * 互动操作（点赞 / 收藏）的可见性闸门：只允许对「正常公开」帖子操作。
     * <p>
     * 规则（2026-09-08 收严）：
     * <ul>
     *   <li>status=0（正常）：所有人可操作</li>
     *   <li>status=1（隐藏/驳回）/ status=2（待审核）：一律 403，<b>作者本人也不再放行</b>——
     *       审核期间帖子应完全只读，互动权限随发布一起释放</li>
     * </ul>
     */
    private void assertInteractable(Post post, Long userId) {
        if (post == null) throw new BusinessException(404, "帖子不存在");
        Integer status = post.getStatus() == null ? 0 : post.getStatus();
        if (status == 0) return;
        throw new BusinessException(403,
                status == 2 ? "帖子正在审核中，暂不支持该操作" : "该帖不可见，无法操作");
    }

    @Override
    @Transactional
    public Long createPost(CreatePostRequest req, Long userId) {
        // A2：发帖限频——单用户 1 分钟最多 3 篇，防止灌水机刷帖
        if (!rateLimiter.tryAcquire("post:user:" + userId, 3, 60)) {
            throw new BusinessException(429, "发帖太频繁，请稍后再试");
        }
        Board board = boardMapper.selectById(req.getBoardId());
        if (board == null) {
            throw new BusinessException(400, "所属板块不存在");
        }
        // 校验关联游戏
        if (req.getGameId() != null) {
            Game g = gameMapper.selectById(req.getGameId());
            if (g == null || g.getDeleted() == 1 || g.getStatus() != 0) {
                throw new BusinessException(400, "关联游戏不存在或已下架");
            }
        }
        Post p = new Post();
        p.setUserId(userId);
        p.setBoardId(req.getBoardId());
        p.setGameId(req.getGameId());
        // C1：违禁词硬拦截（标题 + 正文一起扫）
        contentRisk.assertNoBannedWord(req.getTitle(), req.getContent());
        p.setTitle(req.getTitle());
        // 9-08：@提及规范化入库（显示名重写为真实昵称 / 目标不存在降级纯文本），防篡改误导
        // A1：先过 Jsoup 白名单剥掉 <script>/<iframe>/onerror= 等存储型 XSS 载荷，再做 @ 规范化
        p.setContent(canonicalizeMentions(htmlSanitizer.sanitize(req.getContent())));
        p.setSummary(req.getSummary() == null ? null : htmlSanitizer.sanitize(req.getSummary()));
        p.setCover(req.getCover());
        p.setType(req.getType() != null ? req.getType() : 0);
        // 按提交人身份决定初始 status（1.2 起角色统一为 ADMIN/MODERATOR/USER）：
        //   ADMIN → 直接发布 (0)
        //   MODERATOR / 普通用户 → 待审核 (2)，由负责该(游戏,板块)的版主或 ADMIN 处理
        p.setStatus(determineInitialPostStatus(userId));
        // C1：内容含站外联系方式（微信/QQ/群号）→ 强制转人工审核，ADMIN 直发权也不放行——
        // 组队大厅是广告/诈骗重灾区，引流内容必须经人审再曝光
        if (contentRisk.hasContactInfo(p.getTitle(), p.getContent())) {
            p.setStatus(2);
        }
        p.setIsTop(0);
        p.setIsEssence(0);
        p.setViewCount(0);
        p.setReplyCount(0);
        p.setLikeCount(0);
        postMapper.insert(p);
        // 板块帖子数 +1（仅直接发布的可见帖；待审帖由审核通过 setPostStatus(2→0) 时同步 +1，
        // 否则待审通过会双计 —— 2026-09-03 修复 post_count 漂移根因）
        if (p.getStatus() == 0) {
            boardMapper.update(null, Wrappers.<Board>lambdaUpdate()
                    .eq(Board::getId, board.getId())
                    .setSql("post_count = post_count + 1"));
        }
        // 游戏帖子数 +1（仅直接发布的可见帖；待审/隐藏由审核/恢复时同步）
        if (p.getGameId() != null && p.getStatus() == 0) {
            gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                    .eq(Game::getId, p.getGameId())
                    .setSql("post_count = post_count + 1"));
        }
        // 写标签（作者在建帖时指定的话题，最多 5 个）
        if (req.getTags() != null && !req.getTags().isEmpty()) {
            tagService.setPostTags(p.getId(), userId, req.getTags());
        }
        // 活跃度：发帖 +10；积分：发帖 +5
        activityScoreService.onPostCreated(userId);
        pointsService.addPoints(userId, 2, 5, "发布帖子奖励", p.getId());
        // 9-07：@提及通知（type=6）—— 必须等审核通过后再发；待审帖（status=2）暂不通知，
        // 否则被 @ 者会收到一条"提到了你"但帖子不可见，体验极差。
        // 管理员在 setPostStatus(2→0) 时统一补发；admin 直发的可见帖（status=0）立刻发。
        if (p.getStatus() != null && p.getStatus() == 0) {
            mentionNotifier.notify(String.valueOf(p.getId()), 1, null, p.getContent(), userId);
        }
        return p.getId();
    }

    @Override
    @Transactional
    public Map<String, Object> toggleLike(Long postId, Long userId) {
        // 同一用户对同一帖子的点赞操作串行化，杜绝并发竞态
        synchronized (lockOf(userId, postId)) {
            return toggleLikeInner(postId, userId);
        }
    }

    private Map<String, Object> toggleLikeInner(Long postId, Long userId) {
        Post post = postMapper.selectById(postId);
        assertInteractable(post, userId);
        // 1. 状态判断：只看有效行（deleted=0）
        Long activeCount = likesMapper.selectCount(Wrappers.<Likes>lambdaQuery()
                .eq(Likes::getUserId, userId)
                .eq(Likes::getTargetType, TARGET_POST)
                .eq(Likes::getTargetId, postId)
                .eq(Likes::getDeleted, 0));
        boolean liked = activeCount != null && activeCount > 0;
        // 2. 防御性物理清理：无论是什么状态先清掉所有相关行（含僵尸数据），避免唯一键冲突
        likesMapper.physicalDeleteByTarget(userId, TARGET_POST, postId);
        if (liked) {
            // 当前已点赞 → 取消
            postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                    .eq(Post::getId, postId).setSql("like_count = like_count - 1"));
            liked = false;
            // 9-09 方案A：取消赞时一并删除对应点赞通知，避免反复取消-点赞刷屏
            if (!userId.equals(post.getUserId())) {
                notificationMapper.delete(Wrappers.<Notification>lambdaQuery()
                        .eq(Notification::getUserId, post.getUserId())
                        .eq(Notification::getSenderId, userId)
                        .eq(Notification::getType, 1)
                        .eq(Notification::getTargetType, TARGET_POST)
                        .eq(Notification::getTargetId, postId));
            }
        } else {
            // 当前未点赞 → 新增
            Likes like = new Likes();
            like.setUserId(userId);
            like.setTargetType(TARGET_POST);
            like.setTargetId(postId);
            likesMapper.insert(like);
            postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                    .eq(Post::getId, postId).setSql("like_count = like_count + 1"));
            liked = true;
            // 点赞通知：通知帖子作者（不给自己发）
            // 9-09 方案A：同人同帖点赞通知合并为一条——已存在则复活(置未读+刷新内容)，不存在才新增，杜绝刷屏
            if (!userId.equals(post.getUserId())) {
                Notification existing = notificationMapper.selectOne(Wrappers.<Notification>lambdaQuery()
                        .eq(Notification::getUserId, post.getUserId())
                        .eq(Notification::getSenderId, userId)
                        .eq(Notification::getType, 1)
                        .eq(Notification::getTargetType, TARGET_POST)
                        .eq(Notification::getTargetId, postId)
                        .last("LIMIT 1"));
                Long notiId;
                if (existing != null) {
                    existing.setIsRead(0);
                    existing.setContent("赞了你的帖子");
                    notificationMapper.updateById(existing);
                    notiId = existing.getId();
                } else {
                    Notification n = new Notification();
                    n.setUserId(post.getUserId());
                    n.setType(1);
                    n.setSenderId(userId);
                    n.setTargetType(1);
                    n.setTargetId(postId);
                    n.setContent("赞了你的帖子");
                    n.setIsRead(0);
                    notificationMapper.insert(n);
                    notiId = n.getId();
                }
                // 实时推送：作者在线时通知红点立即 +1
                pushService.pushNotification(post.getUserId(), notiId, 1, "赞了你的帖子", userId, postId);
            }
            // 活跃度：被点赞 +2；积分：被点赞 +1（不给自己发点赞加分）
            if (!userId.equals(post.getUserId())) {
                activityScoreService.onLiked(post.getUserId());
                // 幂等判重：同一 (帖子, 点赞人) 终身只奖励一次，取消再赞不重复发分。
                // 以 points_log(type=4, related_id=postId, description 含点赞人 id) 判重，
                // 与加精奖励 setEssence 的判重方式同源（2026-09-03 修复重复加分）。
                String rewardDesc = "帖子获赞奖励(赞人:" + userId + ")";
                Long rewarded = pointsLogMapper.selectCount(Wrappers.<PointsLog>lambdaQuery()
                        .eq(PointsLog::getUserId, post.getUserId())
                        .eq(PointsLog::getType, 4)
                        .eq(PointsLog::getRelatedId, postId)
                        .eq(PointsLog::getDescription, rewardDesc));
                if (rewarded == null || rewarded == 0) {
                    pointsService.addPoints(post.getUserId(), 4, 1, rewardDesc, postId);
                }
            }
        }
        int likeCount = postMapper.selectById(postId).getLikeCount();
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("liked", liked);
        map.put("likeCount", likeCount);
        return map;
    }

    @Override
    @Transactional
    public Map<String, Object> toggleFavorite(Long postId, Long userId) {
        // 同一用户对同一帖子的收藏操作串行化，杜绝并发竞态
        synchronized (lockOf(userId, postId)) {
            return toggleFavoriteInner(postId, userId);
        }
    }

    private Map<String, Object> toggleFavoriteInner(Long postId, Long userId) {
        Post post = postMapper.selectById(postId);
        assertInteractable(post, userId);
        // 1. 状态判断：只看有效行（deleted=0）
        Long activeCount = favoriteMapper.selectCount(Wrappers.<Favorite>lambdaQuery()
                .eq(Favorite::getUserId, userId)
                .eq(Favorite::getPostId, postId)
                .eq(Favorite::getDeleted, 0));
        boolean favorited = activeCount != null && activeCount > 0;
        // 2. 防御性物理清理
        favoriteMapper.physicalDeleteByUserPost(userId, postId);
        if (!favorited) {
            Favorite f = new Favorite();
            f.setUserId(userId);
            f.setPostId(postId);
            favoriteMapper.insert(f);
            favorited = true;
        } else {
            favorited = false;
        }
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("favorited", favorited);
        return map;
    }

    @Override
    public PageResult<PostVO> searchPosts(String keyword, long current, long size, Long userId) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return PageResult.of(0, 0, current, size, List.of());
        }
        String kw = keyword.trim();
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        postMapper.selectPage(page, Wrappers.<Post>lambdaQuery()
                .eq(Post::getStatus, 0)
                .and(w -> w.like(Post::getTitle, kw).or().like(Post::getContent, kw)));
        List<PostVO> vos = toVOList(page.getRecords(), userId);
        return PageResult.of(page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(), vos);
    }

    @Override
    public List<PostVO> listHotPosts(int limit) {
        List<Post> list = postMapper.selectList(Wrappers.<Post>lambdaQuery()
                .eq(Post::getStatus, 0)
                .last("ORDER BY (reply_count * 2 + like_count) DESC LIMIT " + limit));
        return toVOList(list, null);
    }

    @Override
    public PageResult<PostVO> getPostsByTag(Long tagId, long current, long size, Long userId) {
        Tag tag = tagMapper.selectById(tagId);
        if (tag == null) throw new BusinessException(404, "标签不存在");
        List<Long> postIds = postTagMapper.selectList(Wrappers.<PostTag>lambdaQuery()
                        .eq(PostTag::getTagId, tagId))
                .stream().map(PostTag::getPostId).toList();
        if (postIds.isEmpty()) {
            return PageResult.of(0, 0, current, size, List.of());
        }
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        postMapper.selectPage(page, Wrappers.<Post>lambdaQuery()
                .eq(Post::getStatus, 0)
                .in(Post::getId, postIds)
                .orderByDesc(Post::getCreatedAt));
        List<PostVO> vos = toVOList(page.getRecords(), userId);
        return PageResult.of(page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(), vos);
    }

    @Override
    @Transactional
    public Map<String, Object> setPin(Long postId) {
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        int next = (p.getIsTop() != null && p.getIsTop() == 1) ? 0 : 1;
        postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                .eq(Post::getId, postId).set(Post::getIsTop, next));
        // 置顶影响首页/热门排序，失效热点缓存
        cache.deleteByPrefix("stats:hot:");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("isTop", next);
        return m;
    }

    @Override
    @Transactional
    public Map<String, Object> setEssence(Long postId) {
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        int next = (p.getIsEssence() != null && p.getIsEssence() == 1) ? 0 : 1;
        postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                .eq(Post::getId, postId).set(Post::getIsEssence, next));
        // 加精奖励规则：每个帖子最多只奖励一次积分。
        // 以 points_log 中是否已有该帖的加精奖励流水（type=5, related_id=帖子）为准：
        //   - 加精：仅当此前从未奖励过才 +20；取消加精不扣分；
        //   - 取消后再次加精：流水仍在 → 不再重复奖励。
        boolean alreadyRewarded = pointsLogMapper.selectCount(Wrappers.<PointsLog>lambdaQuery()
                .eq(PointsLog::getType, 5)
                .eq(PointsLog::getRelatedId, postId)) > 0;
        if (next == 1 && !alreadyRewarded && p.getUserId() != null) {
            pointsService.addPoints(p.getUserId(), 5, 20, "帖子被加精奖励", postId);
        }
        cache.deleteByPrefix("stats:hot:");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("isEssence", next);
        return m;
    }

    @Override
    @Transactional
    public Map<String, Object> setHidden(Long postId, boolean hidden) {
        if (!hidden) {
            // 被驳回的帖子不能直接恢复可见（防止绕过审核），必须编辑后重新提审
            assertNotRejected(postId);
        }
        return setPostStatus(postId, hidden ? 1 : 0);
    }

    /** 被驳回（status=1 且带驳回理由）的帖子禁止直接恢复可见，需作者编辑后重新提交审核。 */
    private void assertNotRejected(Long postId) {
        Post p = postMapper.selectById(postId);
        if (p != null && p.getStatus() != null && p.getStatus() == 1
                && p.getRejectReason() != null && !p.getRejectReason().isBlank()) {
            throw new BusinessException(400, "该帖已被驳回，不能直接恢复可见；请编辑内容后重新提交审核");
        }
    }

    @Override
    @Transactional
    public Map<String, Object> setPostStatus(Long postId, int status) {
        if (status < 0 || status > 2) {
            throw new BusinessException(400, "非法的帖子状态");
        }
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        int oldStatus = p.getStatus() != null ? p.getStatus() : 0;
        if (oldStatus == status) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("status", status);
            return m;
        }
        // 状态切到 0（已发布）或 2（待审核）时清空驳回理由；切到 1（驳回）由 rejectPost 写
        com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Post> uw = Wrappers.<Post>lambdaUpdate()
                .eq(Post::getId, postId)
                .set(Post::getStatus, status);
        if (status == 0 || status == 2) {
            uw.set(Post::getRejectReason, null);
        }
        if (status == 0) {
            // 审核通过即不再是"待重审"，清空重提时间标记
            uw.set(Post::getResubmitAt, null);
        }
        postMapper.update(null, uw);
        // 可见性变化：status=0 才在公开列表可见。由"可见->不可见"或"不可见->可见"时调整板块计数
        boolean wasVisible = oldStatus == 0;
        boolean nowVisible = status == 0;
        int delta = (nowVisible ? 1 : 0) - (wasVisible ? 1 : 0);
        if (delta != 0) {
            boardMapper.update(null, Wrappers.<Board>lambdaUpdate()
                    .eq(Board::getId, p.getBoardId())
                    .setSql("post_count = post_count + " + delta));
            // 同步游戏帖子数
            if (p.getGameId() != null) {
                gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                        .eq(Game::getId, p.getGameId())
                        .setSql("post_count = GREATEST(post_count + " + delta + ", 0)"));
            }
            // 可见性变化会改变热门榜，失效热点缓存
            cache.deleteByPrefix("stats:hot:");
        }
        // 9-07：@提及通知补发——"待审→通过"（oldStatus==2 → status==0）时，把 createPost 阶段
        // 暂存的 @ 通知补发给被 @ 者。updatePost 阶段已对"差集新增"发了通知，
        // 此处的全量补发会触发 P0-3 合并（重复 @ 同人 → count+1，不会新增红点条目）。
        // 注意：驳回→恢复（oldStatus==1 → status==0）不发，避免历史帖子被 @ 的旧内容误通知。
        if (oldStatus == 2 && status == 0) {
            mentionNotifier.notify(String.valueOf(postId), 1, null, p.getContent(), p.getUserId());
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", status);
        return m;
    }

    @Override
    @Transactional
    public Map<String, Object> setHiddenOwned(Long postId, boolean hidden, Long operatorId) {
        assertPostOwnerOrAdmin(postId, operatorId);
        if (hidden) {
            // 待审帖不能先隐藏再恢复（2→1→0 会绕过审核直接可见），审核中直接拒绝
            Post pp = postMapper.selectById(postId);
            if (pp != null && pp.getStatus() != null && pp.getStatus() == 2) {
                throw new BusinessException(400, "帖子正在审核中，暂不能隐藏；如需修改请直接编辑");
            }
        } else {
            // 被驳回的帖子不能由作者一键恢复可见（防止绕过审核），必须编辑后重新提审
            assertNotRejected(postId);
        }
        return setPostStatus(postId, hidden ? 1 : 0);
    }

    @Override
    @Transactional
    public Map<String, Object> deletePost(Long postId, Long operatorId) {
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        assertPostOwnerOrAdmin(postId, operatorId);
        // 软删除：deleted=1。帖子数/获赞数统计（deleted=0 过滤）自动不再计入
        postMapper.deleteById(postId);
        // 同步板块/游戏帖子数 -1（仅此前公开可见 status=0 的帖子计入过计数；
        // 待审/隐藏帖从未计入，删除时不变 —— 2026-09-03 与 createPost 口径对齐）
        if (p.getStatus() != null && p.getStatus() == 0) {
            boardMapper.update(null, Wrappers.<Board>lambdaUpdate()
                    .eq(Board::getId, p.getBoardId())
                    .setSql("post_count = GREATEST(post_count - 1, 0)"));
            if (p.getGameId() != null) {
                gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                        .eq(Game::getId, p.getGameId())
                        .setSql("post_count = GREATEST(post_count - 1, 0)"));
            }
        }
        cache.deleteByPrefix("stats:hot:");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("deleted", true);
        return m;
    }

    /** 校验操作者为帖子作者本人或 ADMIN，否则 403。 */
    private void assertPostOwnerOrAdmin(Long postId, Long operatorId) {
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        if (operatorId == null) throw new BusinessException(401, "请先登录");
        List<String> roles = loadUserRoles(operatorId);
        boolean isAdmin = roles.contains("ADMIN");
        if (!isAdmin && !operatorId.equals(p.getUserId())) {
            throw new BusinessException(403, "只能操作自己的帖子");
        }
    }

    @Override
    @Transactional
    public Map<String, Object> updatePost(Long postId, CreatePostRequest req, Long operatorId) {
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        // 权限：仅作者本人或 ADMIN
        assertPostOwnerOrAdmin(postId, operatorId);
        // 校验目标板块存在
        Board newBoard = boardMapper.selectById(req.getBoardId());
        if (newBoard == null) throw new BusinessException(400, "所属板块不存在");
        // 校验关联游戏（如有）
        Long newGameId = req.getGameId();
        if (newGameId != null) {
            Game g = gameMapper.selectById(newGameId);
            if (g == null || g.getDeleted() == 1 || g.getStatus() != 0) {
                throw new BusinessException(400, "关联游戏不存在或已下架");
            }
        }
        // type 范围（0 普通 / 1 攻略 / 2 资讯 / 3 提问 / 4 闲置）
        Integer newType = req.getType() != null ? req.getType() : p.getType();
        if (newType == null || newType < 0 || newType > 4) {
            throw new BusinessException(400, "非法的帖子类型");
        }
        // 计算板块/游戏是否变更（用于同步 post_count）
        Long oldBoardId = p.getBoardId();
        Long oldGameId = p.getGameId();
        boolean boardChanged = oldBoardId == null || !oldBoardId.equals(req.getBoardId());
        boolean gameChanged = (oldGameId == null && newGameId != null)
                || (oldGameId != null && newGameId == null)
                || (oldGameId != null && newGameId != null && !oldGameId.equals(newGameId));
        // 9-07：编辑帖子补发新增 @ —— setContent 之前捕获旧内容，便于算 @ 差集
        String oldContent = p.getContent();
        // C1：违禁词硬拦截（编辑同样不能放行）
        contentRisk.assertNoBannedWord(req.getTitle(), req.getContent());
        // A1：先 Jsoup 剥 XSS 载荷；再 9-08 @提及规范化入库（显示名重写为真实昵称 / 目标不存在降级纯文本）
        String newContent = canonicalizeMentions(htmlSanitizer.sanitize(req.getContent()));
        // 更新主字段：保留 isTop / isEssence / deleted（绕审字段不被客户端控制）
        p.setTitle(req.getTitle());
        p.setContent(newContent);
        p.setSummary(req.getSummary() == null ? null : htmlSanitizer.sanitize(req.getSummary()));
        p.setCover(req.getCover());
        p.setBoardId(req.getBoardId());
        p.setGameId(newGameId);
        p.setType(newType);
        // 被驳回帖重新编辑：作者保存即视为重新提交审核（回到待审 status=2，清空驳回理由）。
        // 两者均不可见，板块/游戏计数不变；ADMIN 替他人编辑不触发重提。
        boolean resubmitted = false;
        if (p.getStatus() != null && p.getStatus() == 1
                && p.getRejectReason() != null && !p.getRejectReason().isBlank()
                && operatorId.equals(p.getUserId())) {
            p.setStatus(2);
            p.setRejectReason(null);
            // 记录重提时间：审核后台据此标注「待重审」，时间展示用重提日期而非首次发布日期
            p.setResubmitAt(java.time.LocalDateTime.now());
            resubmitted = true;
        }
        // C1：编辑后内容含站外联系方式 → 强制回待审（可见帖 status=0 也要拉回 status=2）
        if (contentRisk.hasContactInfo(p.getTitle(), p.getContent())
                && p.getStatus() != null && p.getStatus() == 0) {
            p.setStatus(2);
        }
        postMapper.updateById(p);
        // updateById 默认忽略 null 字段，驳回理由需显式置 NULL（否则旧理由残留，前端误判仍"已驳回"）
        if (resubmitted) {
            postMapper.update(null, Wrappers.<Post>lambdaUpdate()
                    .eq(Post::getId, postId)
                    .set(Post::getRejectReason, null));
        }
        // 同步 post_count：仅帖子可见时（status=0）计入；隐藏/待审帖子的归属计数不变
        boolean isVisible = p.getStatus() != null && p.getStatus() == 0;
        if (isVisible && boardChanged) {
            if (oldBoardId != null) {
                boardMapper.update(null, Wrappers.<Board>lambdaUpdate()
                        .eq(Board::getId, oldBoardId)
                        .setSql("post_count = GREATEST(post_count - 1, 0)"));
            }
            boardMapper.update(null, Wrappers.<Board>lambdaUpdate()
                    .eq(Board::getId, req.getBoardId())
                    .setSql("post_count = post_count + 1"));
        }
        if (isVisible && gameChanged) {
            if (oldGameId != null) {
                gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                        .eq(Game::getId, oldGameId)
                        .setSql("post_count = GREATEST(post_count - 1, 0)"));
            }
            if (newGameId != null) {
                gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                        .eq(Game::getId, newGameId)
                        .setSql("post_count = post_count + 1"));
            }
        }
        // 标签：tags==null 表示不改；非 null 全量替换（复用 setPostTags 的「先清后插」）
        if (req.getTags() != null) {
            tagService.setPostTags(postId, operatorId, req.getTags());
        }
        // 标题/标签变更可能影响排序，失效热点缓存
        cache.deleteByPrefix("stats:hot:");
        // 9-07：编辑帖子补发新增 @（仅 status=0 已发布帖才在 updatePost 阶段发；
        // status=2 待审帖不在此处发，避免与 setPostStatus(2→0) 审核通过时全量补发重叠，
        // P0-3 合并会 +1 但语义错——张三不会在同帖被两个阶段重复通知）。
        if (p.getStatus() != null && p.getStatus() == 0
                && oldContent != null && !oldContent.equals(newContent)) {
            List<Long> oldIds = com.yumu.community.utils.MentionParser
                    .resolveUserIds(oldContent, userMapper);
            List<Long> newIds = com.yumu.community.utils.MentionParser
                    .resolveUserIds(newContent, userMapper);
            java.util.Set<Long> oldSet = new java.util.HashSet<>(oldIds);
            List<Long> diff = newIds.stream()
                    .filter(uid -> !oldSet.contains(uid) && !uid.equals(operatorId))
                    .collect(java.util.stream.Collectors.toList());
            if (!diff.isEmpty()) {
                mentionNotifier.notifyMentionedUsers(String.valueOf(postId), 1, null, diff, operatorId);
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", postId);
        m.put("resubmitted", resubmitted);
        return m;
    }

    /**
     * 9-08：@提及规范化（入库前的防篡改兜底）。
     * 扫描内容中所有 [@显示名](/user/uid)：
     *   1) uid 不存在/已删除（@TableLogic 自动过滤）→ 降级为纯文本 @显示名（不可点、不通知）；
     *   2) 显示名 ≠ uid 真实昵称 → 强制重写为真实昵称，保证「显示=跳转目标」，
     *      杜绝改显示名误导他人（如显示"管理员"实际跳到别人主页）。
     * MentionParser 按昵称解析通知，规范化后昵称与 uid 必然一致，通知不再错位。
     */
    private String canonicalizeMentions(String content) {
        if (content == null || content.isEmpty() || !content.contains("](/user/")) {
            return content;
        }
        java.util.regex.Pattern p =
                java.util.regex.Pattern.compile("\\[@([^\\]]*)\\]\\(/user/(\\d+)\\)");
        java.util.regex.Matcher m = p.matcher(content);
        // 收集 uid 并批量查询有效用户
        java.util.LinkedHashSet<Long> uids = new java.util.LinkedHashSet<>();
        while (m.find()) {
            try {
                uids.add(Long.valueOf(m.group(2)));
            } catch (NumberFormatException ignored) {
            }
        }
        java.util.Map<Long, com.yumu.community.entity.User> users = new java.util.HashMap<>();
        if (!uids.isEmpty()) {
            for (com.yumu.community.entity.User u : userMapper.selectBatchIds(uids)) {
                users.put(u.getId(), u);
            }
        }
        // 逐个重写
        StringBuffer sb = new StringBuffer();
        m.reset();
        while (m.find()) {
            String display = m.group(1);
            Long uid = Long.valueOf(m.group(2));
            com.yumu.community.entity.User u = users.get(uid);
            String realNick = u == null ? "" : sanitizeMentionDisplay(
                    u.getNickname() != null && !u.getNickname().isBlank() ? u.getNickname() : u.getUsername());
            String replacement;
            if (realNick.isEmpty()) {
                // 目标不存在或昵称非法 → 降级纯文本 @显示名
                replacement = "@" + display;
            } else {
                replacement = "[@" + realNick + "](/user/" + uid + ")";
            }
            m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(replacement));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** 昵称进链接文本的安全化（与前端 escapeMentionText 对齐）：剔除破坏 []() 语法的字符 */
    private String sanitizeMentionDisplay(String nick) {
        if (nick == null) return "";
        return nick.replaceAll("[\\[\\]()]", "").trim();
    }

    @Override
    public PostVO getAdminDetail(Long postId) {
        Post p = postMapper.selectById(postId);
        if (p == null) throw new BusinessException(404, "帖子不存在");
        PostVO vo = toVOList(List.of(p), null).get(0);
        vo.setTags(tagService.getPostTags(postId));
        return vo;
    }

    @Override
    public PageResult<PostVO> pagePostsForModeration(Long boardId, Long gameId, Integer status,
                                                     long current, long size, String order,
                                                     Integer days,
                                                     List<ModeratorBoard> coverage) {
        Page<Post> page = new Page<>(clampCurrent(current), clampSize(size));
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Post> qw =
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        if (boardId != null) {
            qw.eq("board_id", boardId);
        }
        if (gameId != null) {
            qw.eq("game_id", gameId);
        }
        if (coverage != null) {
            // MODERATOR：仅可见自己负责的 (游戏, 板块) 对下的帖子
            if (coverage.isEmpty()) {
                return PageResult.of(0, 0, current, size, List.of());
            }
            qw.and(w -> {
                for (ModeratorBoard mb : coverage) {
                    w.or().eq("game_id", mb.getGameId()).eq("board_id", mb.getBoardId());
                }
            });
        }
        if (status != null) {
            qw.eq("status", status);
        }
        // 仅"可见"视图支持时间窗（最近 N 天内通过的帖子，避免列表繁杂）：
        // 用 updated_at 作"最近活跃/最近通过"近似，因为 status 切到 0 时 MyBatis-Plus 自动刷新 updated_at；
        // 待审(2)/驳回(1) 不限时间，便于追溯。
        if (days != null && days > 0 && status != null && status == 0) {
            qw.ge("updated_at", java.time.LocalDateTime.now().minusDays(days));
        }
        // 统一按「提交时间」排序：待重审帖取 resubmit_at，其余取 created_at（COALESCE 语义）。
        // 这样跨 status 时也是同一时间轴，与用户期望一致。
        boolean asc = "asc".equalsIgnoreCase(order);
        if (asc) {
            qw.orderByAsc("(CASE WHEN resubmit_at IS NULL THEN created_at ELSE resubmit_at END)")
              .orderByAsc("id");
        } else {
            qw.orderByDesc("(CASE WHEN resubmit_at IS NULL THEN created_at ELSE resubmit_at END)")
              .orderByDesc("id");
        }
        Page<Post> res = postMapper.selectPage(page, qw);
        List<PostVO> vos = toVOList(res.getRecords(), null);
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    // ===================== 层级审核（Phase 11） =====================

    /** 根据提交人身份决定帖子创建时的初始 status（0 可见 / 2 待审核）。 */
    private int determineInitialPostStatus(Long userId) {
        User u = userMapper.selectById(userId);
        if (u == null) return 0;
        List<String> roles = loadUserRoles(userId);
        // ADMIN → 直接发布
        if (roles.contains("ADMIN")) return 0;
        if (roles.contains("MODERATOR")) {
            return 2; // 版主发帖同样待审（1.2 起无大小版主之分）
        }
        return 2; // 普通用户 → 待审
    }

    /** 取用户角色 code 列表。 */
    private List<String> loadUserRoles(Long userId) {
        List<UserRole> urs = userRoleMapper.selectList(
                Wrappers.<UserRole>lambdaQuery().eq(UserRole::getUserId, userId));
        if (urs.isEmpty()) return List.of();
        List<Long> roleIds = urs.stream().map(UserRole::getRoleId).toList();
        return roleMapper.selectBatchIds(roleIds).stream()
                .map(Role::getCode).filter(java.util.Objects::nonNull).toList();
    }

    @Override
    public boolean canReviewPost(Long postId, Long viewerId) {
        if (viewerId == null) return false;
        Post post = postMapper.selectById(postId);
        if (post == null) return false;
        // 自己不能审自己
        if (post.getUserId().equals(viewerId)) return false;
        List<String> roles = loadUserRoles(viewerId);
        if (roles.contains("ADMIN")) return true;            // ADMIN 全权
        if (!roles.contains("MODERATOR")) return false;       // 普通用户无权
        // MODERATOR：仅可审自己负责的 (游戏, 板块) 对下的帖子
        return moderatorBoardService.covers(viewerId, post.getGameId(), post.getBoardId());
    }

    @Override
    public Map<String, Object> rejectPost(Long postId, String reason, Long reviewerId) {
        Post post = postMapper.selectById(postId);
        if (post == null) throw new BusinessException(404, "帖子不存在");
        String safeReason = reason == null ? "内容违反社区规范" : reason.trim();
        if (safeReason.isEmpty()) safeReason = "内容违反社区规范";
        if (safeReason.length() > 500) safeReason = safeReason.substring(0, 500);
        // 仅当帖子此前公开可见（status=0，创建时已计入板块计数）时才 -1；
        // 待审核帖（status=2）从未计入计数，驳回时不变（2026-09-03 与 createPost 口径对齐）
        boolean wasVisible = post.getStatus() != null && post.getStatus() == 0;
        post.setStatus(1);
        post.setRejectReason(safeReason);
        post.setReviewerId(reviewerId);
        postMapper.updateById(post);
        if (wasVisible) {
            boardMapper.update(null, Wrappers.<Board>lambdaUpdate()
                    .eq(Board::getId, post.getBoardId())
                    .setSql("post_count = GREATEST(post_count - 1, 0)"));
            if (post.getGameId() != null) {
                gameMapper.update(null, Wrappers.<Game>lambdaUpdate()
                        .eq(Game::getId, post.getGameId())
                        .setSql("post_count = GREATEST(post_count - 1, 0)"));
            }
        }
        // 通知发帖人（type=5 = 审核通知：帖子驳回）
        Notification n = new Notification();
        n.setUserId(post.getUserId());
        n.setType(5);
        n.setSenderId(reviewerId);
        n.setTargetType(1); // 1=帖子
        n.setTargetId(postId);
        n.setContent("你的帖子《" + post.getTitle() + "》被审核驳回。理由：" + safeReason);
        n.setIsRead(0);
        notificationMapper.insert(n);
        // 实时推送：作者在线时立即收到驳回通知（含理由）
        pushService.pushNotification(post.getUserId(), n.getId(), 5,
                "你的帖子《" + post.getTitle() + "》被审核驳回。理由：" + safeReason, reviewerId, postId);
        return Map.of("status", 1, "postId", postId);
    }

    /** 批量组装 PostVO：一次预取 user/board/roles/负责板块，登录态下各一次批量查 like/favorite，消除 N+1。 */
    @Override
    public List<PostVO> convertToVOList(List<Post> posts, Long userId) {
        return toVOList(posts, userId);
    }

    private List<PostVO> toVOList(List<Post> posts, Long userId) {
        if (posts == null || posts.isEmpty()) return List.of();
        Set<Long> userIds = posts.stream().map(Post::getUserId).collect(Collectors.toSet());
        Set<Long> boardIds = posts.stream().map(Post::getBoardId).collect(Collectors.toSet());
        Set<Long> gameIds = posts.stream().map(Post::getGameId).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        Map<Long, User> userMap = userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a));
        Map<Long, Board> boardMap = boardMapper.selectBatchIds(boardIds).stream()
                .collect(Collectors.toMap(Board::getId, b -> b, (a, b) -> a));
        Map<Long, Game> gameMap = gameIds.isEmpty() ? new java.util.HashMap<>() : gameMapper.selectBatchIds(gameIds).stream()
                .collect(Collectors.toMap(Game::getId, g -> g, (a, b) -> a));

        // 批量取作者角色（一次 SQL）
        Map<Long, List<String>> rolesMap = batchRoles(userIds);
        // 批量取作者负责板块（每用户一次 listBoardIdsByUserId；N 通常 ≤ 20，可接受）
        Map<Long, List<Long>> mbMap = new java.util.HashMap<>();
        // 批量取作者负责游戏名（同样每用户一次；用于徽章展示）
        Map<Long, List<String>> mbGameNamesMap = new java.util.HashMap<>();
        for (Long uid : userIds) {
            mbMap.put(uid, moderatorBoardService.listBoardIdsByUserId(uid));
            mbGameNamesMap.put(uid, moderatorBoardService.listGameNamesByUserId(uid));
        }

        Set<Long> likedIds = Set.of();
        Set<Long> favIds = Set.of();
        if (userId != null) {
            List<Long> postIds = posts.stream().map(Post::getId).collect(Collectors.toList());
            likedIds = likesMapper.selectList(Wrappers.<Likes>lambdaQuery()
                            .eq(Likes::getUserId, userId).eq(Likes::getTargetType, TARGET_POST)
                            .in(Likes::getTargetId, postIds)).stream()
                    .map(Likes::getTargetId).collect(Collectors.toSet());
            favIds = favoriteMapper.selectList(Wrappers.<Favorite>lambdaQuery()
                            .eq(Favorite::getUserId, userId).in(Favorite::getPostId, postIds)).stream()
                    .map(Favorite::getPostId).collect(Collectors.toSet());
        }

        List<PostVO> vos = new ArrayList<>(posts.size());
        for (Post p : posts) {
            PostVO vo = new PostVO();
            vo.setId(p.getId());
            vo.setUserId(p.getUserId());
            vo.setBoardId(p.getBoardId());
            vo.setGameId(p.getGameId());
            Game g = gameMap.get(p.getGameId());
            vo.setGameName(g != null ? g.getName() : null);
            vo.setGameCover(g != null ? g.getCover() : null);
            vo.setTitle(p.getTitle());
            vo.setContent(p.getContent());
            vo.setSummary(p.getSummary());
            vo.setCover(p.getCover());
            vo.setIsTop(p.getIsTop());
            vo.setIsEssence(p.getIsEssence());
            vo.setViewCount(p.getViewCount());
            vo.setReplyCount(p.getReplyCount());
            vo.setLikeCount(p.getLikeCount());
            vo.setStatus(p.getStatus());
            vo.setCreatedAt(p.getCreatedAt());
            User u = userMap.get(p.getUserId());
            vo.setAuthorName(u != null ? (u.getNickname() != null ? u.getNickname() : u.getUsername()) : "未知用户");
            vo.setAuthorAvatar(u != null ? u.getAvatar() : null);
            // 身份徽章 + 活跃度等级 + 负责游戏名（仅 MODERATOR 才有意义）
            if (u != null) {
                List<String> roles = rolesMap.getOrDefault(u.getId(), java.util.Collections.emptyList());
                List<Long> mbs = mbMap.getOrDefault(u.getId(), java.util.Collections.emptyList());
                com.yumu.community.vo.UserIdentity id = badgeService.compute(u, roles, mbs);
                vo.setAuthorBadge(id.getBadge());
                vo.setAuthorBadgeColor(id.getBadgeColor());
                vo.setAuthorLevel(id.getLevel());
                vo.setAuthorLevelTitle(id.getLevelTitle());
                vo.setAuthorModeratorGameNames(mbGameNamesMap.getOrDefault(u.getId(), java.util.Collections.emptyList()));
            }
            Board b = boardMap.get(p.getBoardId());
            vo.setBoardName(b != null ? b.getName() : "");
            vo.setLiked(likedIds.contains(p.getId()));
            vo.setFavorited(favIds.contains(p.getId()));
            vo.setRejectReason(p.getRejectReason());
            vo.setReviewerId(p.getReviewerId());
            vo.setResubmitAt(p.getResubmitAt());
            vos.add(vo);
        }
        return vos;
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
}
