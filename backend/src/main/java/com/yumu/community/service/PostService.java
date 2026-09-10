package com.yumu.community.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.PageResult;
import com.yumu.community.dto.CreatePostRequest;
import com.yumu.community.entity.ModeratorBoard;
import com.yumu.community.entity.Post;
import com.yumu.community.vo.PostVO;

import java.util.List;
import java.util.Map;

public interface PostService {

    /**
     * 帖子列表：可按板块 / 游戏过滤 + 排序（all/latest/hot/essence/reply/favorite）。
     * - all：返回该条件下全部帖子（不分页）
     * - latest / hot / reply / favorite：数量不超过一页，total 截断到 size 隐藏分页
     * - essence：仅 is_essence=1 的全部帖子（不分页）
     * - boardId 指定板块（1.2 起六种固定分类之一）；
     * - gameId 指定游戏（进入游戏库后只展示该游戏帖子；为 null 表示全部游戏）。
     * 传入 userId 时会附带该用户的点赞/收藏状态。
     */
    PageResult<PostVO> pagePosts(Long boardId, Long gameId, String sort, long current, long size, Long userId);

    /**
     * 帖子详情：附带作者/板块信息与当前用户的点赞/收藏状态。
     */
    PostVO getDetail(Long id, Long userId);

    /**
     * 发布帖子，返回新帖子 id。
     */
    Long createPost(CreatePostRequest req, Long userId);

    /**
     * 切换点赞状态，返回当前状态与最新点赞数。
     */
    Map<String, Object> toggleLike(Long postId, Long userId);

    /**
     * 切换收藏状态，返回当前状态。
     */
    Map<String, Object> toggleFavorite(Long postId, Long userId);

    /**
     * 全文搜索帖子（title + content），分页返回。keyword 为空时返回空页。
     */
    PageResult<PostVO> searchPosts(String keyword, long current, long size, Long userId);

    /**
     * 热门帖：按 (回复数*2 + 点赞数) 降序取前 limit 条。
     */
    List<PostVO> listHotPosts(int limit);

    /**
     * 某标签下的帖子列表（分页）。校验标签存在；按关联 post_tag 取 post_id 再 IN 查询。
     */
    PageResult<PostVO> getPostsByTag(Long tagId, long current, long size, Long userId);

    /**
     * 切换置顶状态，返回 {isTop: 1|0}。仅管理员可用（由 AdminController 的 @PreAuthorize 守卫）。
     */
    Map<String, Object> setPin(Long postId);

    /**
     * 切换加精状态，返回 {isEssence: 1|0}。仅管理员可用。
     */
    Map<String, Object> setEssence(Long postId);

    /**
     * 隐藏/恢复帖子：hidden=true → status=1（隐藏），false → status=0（正常）。仅管理员可用。
     * 返回 {status: 新状态}。
     */
    Map<String, Object> setHidden(Long postId, boolean hidden);

    /**
     * 作者/管理员 隐藏或恢复自己的帖子（隐藏=status 1，恢复=status 0）。
     * 权限：仅帖子作者本人或 ADMIN。复用 setPostStatus 同步板块/游戏计数。
     * 返回 {status: 新状态}。
     */
    Map<String, Object> setHiddenOwned(Long postId, boolean hidden, Long operatorId);

    /**
     * 删除帖子（软删除 deleted=1）：仅作者本人或 ADMIN。
     * 删除后：帖子数与获赞数（likeReceivedCount）均不再计入（deleted=0 过滤）。
     * 同步板块/游戏 post_count -1、失效热点缓存。
     * 返回 {deleted: true}。
     */
    Map<String, Object> deletePost(Long postId, Long operatorId);

    /**
     * 编辑帖子（更新 title/content/summary/cover/tags/gameId/type/boardId）。
     * 权限：仅帖子作者本人或 ADMIN。
     * 不可通过此接口修改 status / isTop / isEssence 等审核字段（保持原值，避免被绕审）。
     * tags 为 null 时保留原标签；非 null 时全量替换（复用 setPostTags 的「先清后插」逻辑）。
     * 同步失效热点缓存。
     * 返回 {id: 帖子 id}。
     */
    Map<String, Object> updatePost(Long postId, CreatePostRequest req, Long operatorId);

    /**
     * 设定帖子的任意审核状态并同步板块帖子数。
     * status 语义：0=正常(可见) 1=隐藏(违规) 2=待审核(待发布)。
     * 可见性变化（是否在公开列表）会同步父板块 post_count 与热门榜缓存。
     */
    Map<String, Object> setPostStatus(Long postId, int status);

    /**
     * 管理员预览帖子详情：绕过 status 过滤（含被隐藏/待审核的帖子），用于后台审核查看。
     */
    PostVO getAdminDetail(Long postId);

    /**
     * 后台管理系统帖子列表：可查看所有状态（含隐藏）。
     * coverage 为某版主负责的 (游戏, 板块) 授权项；为 null 表示 ADMIN 可查看全部。
     * 列表可按 boardId / gameId 进一步过滤。
     */
    PageResult<PostVO> pagePostsForModeration(Long boardId, Long gameId, Integer status,
                                               long current, long size, String order,
                                               Integer days,
                                               List<ModeratorBoard> coverage);

    /** 用户主页 TA 的帖子：按用户 ID 过滤，仅可见（status=0）。viewerId 用于附带 liked/favorited。 */
    PageResult<PostVO> postsByUser(Long userId, long current, long size, Long viewerId);

    /** 游戏详情页：按 gameId 聚合帖子，仅可见（status=0）。viewerId 用于附带 liked/favorited。 */
    PageResult<PostVO> pagePostsByGame(Long gameId, long current, long size, Long viewerId);

    /**
     * 个性化订阅流：聚合当前用户订阅的板块帖子 + 命中订阅关键词的帖子，仅可见（status=0）。
     * viewerId 用于附带 liked/favorited。无订阅时返回空页。
     */
    PageResult<PostVO> pagePersonalizedFeed(Long userId, long current, long size);

    /**
     * 关注流：仅当前用户关注的人（follow.follow_type=1）发的可见帖。
     * 未关注任何人时返回空页；支持排序二次筛选（all/latest/hot/essence/reply/favorite）。
     * viewerId 用于附带 liked/favorited。
     */
    PageResult<PostVO> pageFollowingFeed(Long userId, String sort, long current, long size);

    /**
     * 驳回帖子（status=1 隐藏 + reject_reason + 通知作者）。viewer 为实际审核人。
     * 返回 {status}。
     */
    Map<String, Object> rejectPost(Long postId, String reason, Long reviewerId);

    /**
     * 检查 viewer 是否能审这个帖子。
     * 规则（1.2 起统一版主）：
     *   - ADMIN 全权（含自己的帖由自己处理或交由其他 ADMIN）；
     *   - MODERATOR 仅可审「自己负责的 (游戏, 板块) 对」下的帖子，且不能审自己发的帖；
     *   - 普通用户无权。
     */
    boolean canReviewPost(Long postId, Long viewerId);

    /**
     * 批量将 Post 实体列表转换为 PostVO（复用批量预取逻辑，避免 N+1）。
     * 用于其他服务（如每日精选）需要组装 PostVO 的场景。
     */
    List<PostVO> convertToVOList(List<Post> posts, Long viewerId);
}
