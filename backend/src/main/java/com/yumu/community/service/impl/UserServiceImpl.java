package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.dto.UpdatePasswordRequest;
import com.yumu.community.dto.UpdateProfileRequest;
import com.yumu.community.dto.UpdateUsernameRequest;
import com.yumu.community.entity.Post;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.mapper.RoleMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.mapper.UserRoleMapper;
import com.yumu.community.security.HtmlSanitizer;
import com.yumu.community.service.FollowService;
import com.yumu.community.service.GameService;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.service.PostService;
import com.yumu.community.service.UserService;
import com.yumu.community.vo.GameMiniVO;
import com.yumu.community.vo.PostVO;
import com.yumu.community.vo.UserInfoVO;
import com.yumu.community.vo.UserProfileVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class UserServiceImpl implements UserService {

    private final UserMapper userMapper;
    private final PostMapper postMapper;
    private final UserRoleMapper userRoleMapper;
    private final RoleMapper roleMapper;
    private final FollowService followService;
    private final PostService postService;
    private final ModeratorBoardService moderatorBoardService;
    private final GameService gameService;
    private final PasswordEncoder passwordEncoder;
    /** A1：服务端 HTML 净化（Jsoup 白名单）—— 防存储型 XSS。 */
    private final HtmlSanitizer htmlSanitizer;

    @Override
    public UserProfileVO getProfile(Long userId, Long viewerId) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw new BusinessException(404, "用户不存在");
        }
        UserProfileVO vo = new UserProfileVO();
        vo.setId(u.getId());
        vo.setUsername(u.getUsername());
        vo.setNickname(u.getNickname());
        vo.setAvatar(u.getAvatar());
        vo.setBio(u.getBio());
        vo.setHobbies(u.getHobbies());
        vo.setFavoriteBoardIds(u.getFavoriteBoardIds());
        // 1.2 起：个人爱好改为多选游戏，存 ID 列表 + 解析后的精简 VO
        vo.setFavoriteGameIds(u.getFavoriteGameIds());
        vo.setFavoriteGames(resolveFavoriteGames(u.getFavoriteGameIds()));
        vo.setGender(u.getGender());

        Map<String, Long> counts = followService.getCounts(userId);
        vo.setFollowingCount(counts.get("following"));
        vo.setFollowersCount(counts.get("followers"));
        long postCount = postMapper.selectCount(Wrappers.<Post>lambdaQuery()
                .eq(Post::getUserId, userId)
                .eq(Post::getStatus, 0));
        vo.setPostCount(postCount);
        // 统计该用户未删除帖子获得的点赞总数（含隐藏帖：隐藏后获赞数不变；不含已删除帖）
        Integer likeReceivedCount = postMapper.selectObjs(Wrappers.<Post>lambdaQuery()
                        .eq(Post::getUserId, userId)
                        .select(Post::getLikeCount))
                .stream()
                .filter(o -> o != null)
                .mapToInt(o -> ((Number) o).intValue())
                .sum();
        vo.setLikeReceivedCount(likeReceivedCount);

        vo.setPoints(u.getPoints() == null ? 0 : u.getPoints());
        vo.setActivityScore(u.getActivityScore() == null ? 0 : u.getActivityScore());
        int lvl = u.getActivityLevel() == null ? 1 : u.getActivityLevel();
        vo.setActivityLevel(lvl);
        vo.setActivityTitle(switch (lvl) {
            case 2 -> "活跃玩家";
            case 3 -> "资深玩家";
            case 4 -> "社区精英";
            case 5 -> "传说玩家";
            default -> "初出茅庐";
        });

        vo.setIsFollowed(viewerId != null && followService.isFollowing(viewerId, userId));

        // 角色 + 版主负责板块（个人主页展示用）
        List<String> userRoles = loadUserRoles(userId);
        vo.setRoles(userRoles);
        vo.setBadge(computeBadge(userId, userRoles));
        List<Long> mbIds = moderatorBoardService.listBoardIdsByUserId(userId);
        vo.setModeratorBoardIds(mbIds);
        vo.setModeratorBoardNames(moderatorBoardService.listBoardNamesByUserId(userId));
        // 负责游戏名（徽章显示用）
        vo.setModeratorGameNames(moderatorBoardService.listGameNamesByUserId(userId));

        PageResult<PostVO> pr = postService.postsByUser(userId, 1, 20, viewerId);
        vo.setPosts(pr.getRecords());
        return vo;
    }

    /** 取用户角色 code 列表（直接查 user_role+role，避免依赖 BadgeService 的 UserIdentity）。 */
    private List<String> loadUserRoles(Long userId) {
        List<com.yumu.community.entity.UserRole> urs = userRoleMapper.selectList(
                Wrappers.<com.yumu.community.entity.UserRole>lambdaQuery().eq(com.yumu.community.entity.UserRole::getUserId, userId));
        if (urs.isEmpty()) return List.of();
        List<Long> roleIds = urs.stream().map(com.yumu.community.entity.UserRole::getRoleId).toList();
        return roleMapper.selectBatchIds(roleIds).stream()
                .map(com.yumu.community.entity.Role::getCode).filter(java.util.Objects::nonNull).toList();
    }

    /** ADMIN/MODERATOR/null 徽章（1.2 起不再区分大/小版主）。 */
    private String computeBadge(Long userId, List<String> roles) {
        if (roles.contains("ADMIN")) return "ADMIN";
        if (roles.contains("MODERATOR")) return "MODERATOR";
        return null;
    }

    @Override
    @Transactional
    public UserInfoVO updateProfile(Long userId, UpdateProfileRequest req) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw new BusinessException(404, "用户不存在");
        }
        if (req.getNickname() != null) u.setNickname(req.getNickname());
        if (req.getAvatar() != null) u.setAvatar(req.getAvatar());
        // A1：个人简介过 Jsoup 防 XSS
        if (req.getBio() != null) u.setBio(htmlSanitizer.sanitize(req.getBio()));
        if (req.getHobbies() != null) u.setHobbies(req.getHobbies());
        if (req.getFavoriteBoardIds() != null) u.setFavoriteBoardIds(req.getFavoriteBoardIds());
        if (req.getFavoriteGameIds() != null) u.setFavoriteGameIds(req.getFavoriteGameIds());
        userMapper.updateById(u);
        return toVO(u);
    }

    /** 账号每年仅可修改一次。返回可修改与否及下次可修改时间。 */
    private record UsernameChangeWindow(boolean canChange, LocalDateTime nextChangeAt) {}

    private UsernameChangeWindow computeUsernameChangeWindow(User u) {
        LocalDateTime last = u.getLastUsernameChangeAt();
        if (last == null) {
            return new UsernameChangeWindow(true, null);
        }
        LocalDateTime next = last.plusYears(1);
        if (LocalDateTime.now().isBefore(next)) {
            return new UsernameChangeWindow(false, next);
        }
        return new UsernameChangeWindow(true, null);
    }

    @Override
    @Transactional
    public UserInfoVO updateUsername(Long userId, UpdateUsernameRequest req) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw new BusinessException(404, "用户不存在");
        }
        String newName = req.getUsername() == null ? "" : req.getUsername().trim();
        if (newName.length() < 3 || newName.length() > 20) {
            throw new BusinessException(400, "账号长度需 3-20 位");
        }
        if (!newName.matches("^[a-zA-Z0-9_]+$")) {
            throw new BusinessException(400, "账号只能包含字母、数字和下划线");
        }
        if (newName.equals(u.getUsername())) {
            throw new BusinessException(400, "新账号不能与当前账号相同");
        }
        // 唯一性（排除自己）
        long dup = userMapper.selectCount(Wrappers.<User>lambdaQuery()
                .eq(User::getUsername, newName)
                .ne(User::getId, userId));
        if (dup > 0) {
            throw new BusinessException(409, "该账号已被占用");
        }
        // 每年一次限制
        UsernameChangeWindow win = computeUsernameChangeWindow(u);
        if (!win.canChange()) {
            long remainDays = java.time.temporal.ChronoUnit.DAYS.between(
                    LocalDate.now(), win.nextChangeAt().toLocalDate());
            throw new BusinessException(429, "账号每年只能修改一次，距离下次可修改还有 " + remainDays + " 天");
        }
        u.setUsername(newName);
        u.setLastUsernameChangeAt(LocalDateTime.now());
        userMapper.updateById(u);
        return toVO(u);
    }

    @Override
    @Transactional
    public void updatePassword(Long userId, UpdatePasswordRequest req) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            throw new BusinessException(404, "用户不存在");
        }
        if (!passwordEncoder.matches(req.getOldPassword(), u.getPassword())) {
            throw new BusinessException(400, "原密码错误");
        }
        u.setPassword(passwordEncoder.encode(req.getNewPassword()));
        userMapper.updateById(u);
    }

    private UserInfoVO toVO(User u) {
        UserInfoVO vo = new UserInfoVO();
        vo.setId(u.getId());
        vo.setUsername(u.getUsername());
        vo.setNickname(u.getNickname());
        vo.setAvatar(u.getAvatar());
        vo.setEmail(u.getEmail());
        vo.setBio(u.getBio());
        vo.setHobbies(u.getHobbies());
        vo.setFavoriteBoardIds(u.getFavoriteBoardIds());
        // 1.2 起：游戏爱好解析
        vo.setFavoriteGameIds(u.getFavoriteGameIds());
        vo.setFavoriteGames(resolveFavoriteGames(u.getFavoriteGameIds()));
        vo.setGender(u.getGender());
        vo.setPoints(u.getPoints() == null ? 0 : u.getPoints());
        vo.setActivityScore(u.getActivityScore() == null ? 0 : u.getActivityScore());
        vo.setActivityLevel(u.getActivityLevel() == null ? 1 : u.getActivityLevel());
        // 统计该用户未删除帖子获得的点赞总数（含隐藏帖；不含已删除帖）
        Integer likeReceivedCount = postMapper.selectObjs(Wrappers.<Post>lambdaQuery()
                        .eq(Post::getUserId, u.getId())
                        .select(Post::getLikeCount))
                .stream()
                .filter(o -> o != null)
                .mapToInt(o -> ((Number) o).intValue())
                .sum();
        vo.setLikeReceivedCount(likeReceivedCount);
        vo.setRoles(List.of());
        UsernameChangeWindow win = computeUsernameChangeWindow(u);
        vo.setCanChangeUsername(win.canChange());
        vo.setNextUsernameChangeAt(win.nextChangeAt());
        // 版主相关：负责板块 + 负责游戏（前端徽章展示）
        vo.setModeratorBoardIds(moderatorBoardService.listBoardIdsByUserId(u.getId()));
        vo.setModeratorBoardNames(moderatorBoardService.listBoardNamesByUserId(u.getId()));
        vo.setModeratorGameNames(moderatorBoardService.listGameNamesByUserId(u.getId()));
        return vo;
    }

    /** 解析逗号分隔的游戏 ID 串 → 精简 VO 列表（隐藏/已删游戏自动忽略，按热度排序）。 */
    private List<GameMiniVO> resolveFavoriteGames(String favoriteGameIds) {
        if (favoriteGameIds == null || favoriteGameIds.isBlank()) return List.of();
        List<Long> ids = Arrays.stream(favoriteGameIds.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(s -> {
                    try { return Long.parseLong(s); } catch (NumberFormatException e) { return null; }
                })
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (ids.isEmpty()) return List.of();
        return gameService.resolveGamesByIds(ids);
    }
}
