package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.config.JwtUtil;
import com.yumu.community.dto.EmailCodeRequest;
import com.yumu.community.dto.LoginRequest;
import com.yumu.community.dto.PasswordResetRequest;
import com.yumu.community.dto.RegisterRequest;
import com.yumu.community.entity.Role;
import com.yumu.community.entity.User;
import com.yumu.community.entity.UserRole;
import com.yumu.community.mail.EmailScene;
import com.yumu.community.mail.MailService;
import com.yumu.community.mapper.RoleMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.mapper.UserRoleMapper;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.security.CustomUserDetailsService;
import com.yumu.community.security.RateLimiter;
import com.yumu.community.security.TokenBlacklistService;
import com.yumu.community.service.AuthService;
import com.yumu.community.service.ActivityScoreService;
import com.yumu.community.service.BadgeService;
import com.yumu.community.service.EmailCodeService;
import com.yumu.community.service.GameService;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.entity.Post;
import com.yumu.community.mapper.PostMapper;
import com.yumu.community.vo.GameMiniVO;
import com.yumu.community.vo.UserIdentity;
import com.yumu.community.vo.UserInfoVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private final UserMapper userMapper;
    private final UserRoleMapper userRoleMapper;
    private final RoleMapper roleMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final CustomUserDetailsService userDetailsService;
    private final BadgeService badgeService;
    private final ModeratorBoardService moderatorBoardService;
    private final ActivityScoreService activityScoreService;
    private final PostMapper postMapper;
    private final GameService gameService;
    /** A2：登录 / 注册限频器（Redis 滑动窗口，Redis 不可用降级到进程内）。 */
    private final RateLimiter rateLimiter;
    /** A3：JWT 退出黑名单（jti → Redis，TTL=剩余有效期）。 */
    private final TokenBlacklistService tokenBlacklist;
    /** 9-15：邮箱验证码（注册 / 找回密码 / 换绑邮箱）。 */
    private final EmailCodeService emailCodeService;

    private static final String DEFAULT_ROLE_CODE = "USER";

    @Override
    @Transactional
    public Map<String, Object> register(RegisterRequest req) {
        // A2：按 IP 限频：单 IP 5 分钟最多 5 次注册，防脚本批量灌水账号
        String ip = com.yumu.community.utils.RequestUtils.clientIp();
        if (!rateLimiter.tryAcquire("register:ip:" + ip, 5, 300)) {
            throw new BusinessException(429, "注册尝试过于频繁，请 5 分钟后再试");
        }
        // 9-15：邮箱归一化（去空格 + 小写）—— 必须与库中已有数据、Redis 里的验证码 key 完全一致。
        //   自动化测试通道（MAIL_TEST_CODE，仅非生产）下允许不带邮箱，回到 9-15 之前的旧式注册，
        //   好让既有那批走 /auth/register 的接口测试脚本不必为「邮箱改必填」整批重写。
        boolean testChannel = emailCodeService.testChannelEnabled();
        String email;
        if (!StringUtils.hasText(req.getEmail())) {
            if (!testChannel) {
                throw new BusinessException(400, "邮箱不能为空");
            }
            email = null;
        } else {
            email = emailCodeService.normalize(req.getEmail());
        }

        // 查重排在「校验验证码」之前：否则用户填了个已被占用的账号id，
        // 验证码却已经被消费掉，得重新发一封邮件才敢重试。
        if (userMapper.selectCount(Wrappers.<User>lambdaQuery().eq(User::getUsername, req.getUsername())) > 0) {
            throw new BusinessException(409, "账号id 已被使用，请换一个");
        }
        if (email != null && userMapper.selectCount(Wrappers.<User>lambdaQuery().eq(User::getEmail, email)) > 0) {
            throw new BusinessException(409, "该邮箱已被注册");
        }

        // 9-15：邮箱验证码是注册的前置条件 —— 校验通过即消费（同一个码不能重复使用）。
        //   无邮箱（仅测试通道可达）时自然无需校验。
        if (email != null) {
            emailCodeService.verifyAndConsume(email, EmailScene.REGISTER, req.getEmailCode());
        }

        User user = new User();
        user.setUsername(req.getUsername());
        user.setNickname(req.getNickname() != null && !req.getNickname().isBlank() ? req.getNickname() : req.getUsername());
        user.setPassword(passwordEncoder.encode(req.getPassword()));
        user.setEmail(email);
        // 能走到这里说明邮箱验证码是对的 —— 注册即视为已验证；无邮箱的测试账号则标记为未验证
        user.setEmailVerified(email != null ? 1 : 0);
        user.setStatus(0);
        user.setPoints(0);
        userMapper.insert(user);

        // 分配默认角色
        Role role = roleMapper.selectOne(Wrappers.<Role>lambdaQuery().eq(Role::getCode, DEFAULT_ROLE_CODE));
        if (role != null) {
            UserRole ur = new UserRole();
            ur.setUserId(user.getId());
            ur.setRoleId(role.getId());
            userRoleMapper.insert(ur);
        }

        return buildTokenResult(user.getUsername());
    }

    @Override
    public Map<String, Object> login(LoginRequest req) {
        // A2：登录限频——同一账号 1 分钟 5 次、同一 IP 1 分钟 20 次，防撞库 / 刷密码
        String identifier = req.getUsername() == null ? "?" : req.getUsername().trim();
        if (!rateLimiter.tryAcquire("login:user:" + identifier.toLowerCase(Locale.ROOT), 5, 60)) {
            throw new BusinessException(429, "该账号尝试过于频繁，请稍后再试");
        }
        String ip = com.yumu.community.utils.RequestUtils.clientIp();
        if (!rateLimiter.tryAcquire("login:ip:" + ip, 20, 60)) {
            throw new BusinessException(429, "当前 IP 尝试过于频繁，请稍后再试");
        }
        // 9-15：登录标识兼容「账号id」与「邮箱」——先按账号id精确查，查不到再按邮箱查。
        //   用 loadByLoginIdentifier 而不是 loadUserByUsername：后者还被 refresh 路径使用，
        //   语义保持「就是账号id」更清晰。
        CustomUserDetails details;
        try {
            details = (CustomUserDetails) userDetailsService.loadByLoginIdentifier(identifier);
        } catch (UsernameNotFoundException e) {
            // 提示与「密码错误」完全一致，不暴露该账号/邮箱是否已注册
            throw new BusinessException(401, "账号或密码错误");
        }
        if (!passwordEncoder.matches(req.getPassword(), details.getPassword())) {
            throw new BusinessException(401, "账号或密码错误");
        }
        // 被封禁（status=1）账号禁止登录
        if (!details.isEnabled()) {
            throw new BusinessException(403, "账号已被禁用，请联系管理员");
        }
        // 每日首次登录 +3 活跃度（内部自动按 lastLoginAt 判断）
        activityScoreService.onDailyLogin(details.getUserId());
        // ⚠️ 必须用库里的真实 username，不能用用户输入值 —— 输入的可能是邮箱
        return buildTokenResult(details.getUser().getUsername());
    }

    /**
     * 9-15：请求邮箱验证码（免登录场景：注册 / 忘记密码）。
     *
     * <p><b>防枚举差异</b>：</p>
     * <ul>
     *   <li>{@code register} —— 邮箱已被占用时<b>必须</b>明确告知，否则用户不知道为何收不到码；</li>
     *   <li>{@code reset} —— 邮箱没注册过时<b>静默返回成功</b>（但一封邮件都不发），
     *       否则这个免登录接口会变成「批量探测全站邮箱是否注册过」的工具。</li>
     * </ul>
     */
    @Override
    public void sendEmailCode(EmailCodeRequest req) {
        EmailScene scene;
        try {
            scene = EmailScene.of(req.getScene());
        } catch (IllegalArgumentException e) {
            throw new BusinessException(400, "不支持的场景");
        }
        // 免登录入口只允许这两个场景；bind / unbind 必须登录后走 /user/email/code
        if (scene != EmailScene.REGISTER && scene != EmailScene.RESET) {
            throw new BusinessException(400, "不支持的场景");
        }
        String email = emailCodeService.normalize(req.getEmail());

        if (scene == EmailScene.REGISTER) {
            if (userMapper.selectCount(Wrappers.<User>lambdaQuery().eq(User::getEmail, email)) > 0) {
                throw new BusinessException(409, "该邮箱已被注册");
            }
        } else {
            User exists = userMapper.selectOne(Wrappers.<User>lambdaQuery().eq(User::getEmail, email));
            if (exists == null) {
                log.info("[auth] reset 发码命中未注册邮箱，按防枚举策略静默返回（不发送）: {}", MailService.mask(email));
                return;
            }
        }
        emailCodeService.send(email, scene);
    }

    /**
     * 9-15：忘记密码 —— 邮箱验证码重置密码。
     *
     * <p>只改密码：不返回账号信息、不自动登录、不影响账号禁用状态。
     * 邮箱不存在时与「验证码错误」返回同一句提示，避免被用来枚举邮箱。</p>
     */
    @Override
    @Transactional
    public void resetPassword(PasswordResetRequest req) {
        String ip = com.yumu.community.utils.RequestUtils.clientIp();
        if (!rateLimiter.tryAcquire("reset:ip:" + ip, 10, 3600)) {
            throw new BusinessException(429, "操作过于频繁，请稍后再试");
        }
        String email = emailCodeService.normalize(req.getEmail());
        User user = userMapper.selectOne(Wrappers.<User>lambdaQuery().eq(User::getEmail, email));
        if (user == null) {
            // 与下面「验证码不对」保持同一提示
            throw new BusinessException(400, "验证码不正确或已过期");
        }
        emailCodeService.verifyAndConsume(email, EmailScene.RESET, req.getEmailCode());

        User upd = new User();
        upd.setId(user.getId());
        upd.setPassword(passwordEncoder.encode(req.getNewPassword()));
        userMapper.updateById(upd);
        log.info("[auth] 密码已通过邮箱验证码重置: uid={}, email={}", user.getId(), MailService.mask(email));
    }

    @Override
    public UserInfoVO me(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(404, "用户不存在");
        }
        List<Long> roleIds = userRoleMapper.selectList(
                        Wrappers.<UserRole>lambdaQuery().eq(UserRole::getUserId, userId))
                .stream().map(UserRole::getRoleId).toList();
        List<String> roles = roleIds.isEmpty() ? List.of()
                : roleMapper.selectBatchIds(roleIds).stream().map(Role::getCode).toList();
        return toVO(user, roles);
    }

    /** A3：把当前 token 的 jti 加入 Redis 黑名单（短期 token + 退出即时失效）。 */
    @Override
    public void logout(String jti, java.util.Date expiration) {
        tokenBlacklist.blacklist(jti, expiration);
    }

    /**
     * 9-10 滑动续签：校验通过后轮换 token（旧 jti 立即入黑名单），有效期重置为配置值。
     */
    @Override
    public Map<String, Object> refresh(Long userId, String jti, java.util.Date currentExpiration) {
        User user = userMapper.selectById(userId);
        if (user == null || Integer.valueOf(1).equals(user.getStatus())) {
            // 账号被删除 / 被禁用 → 不再续签，前端收到 401 后会清理登录态
            throw new BusinessException(401, "账号状态异常，请重新登录");
        }
        String username = user.getUsername();
        // 角色每次从 DB 重载（与登录路径一致）：权限被调整后无需等 token 过期
        CustomUserDetails details = (CustomUserDetails) userDetailsService.loadUserByUsername(username);
        String token = jwtUtil.generateToken(username, details.getUserId());
        // 轮换：旧 token 立即失效（即便它还没到自然过期时间）
        if (jti != null) {
            tokenBlacklist.blacklist(jti, currentExpiration);
        }
        Map<String, Object> result = new java.util.HashMap<>();
        result.put("token", token);
        result.put("expiresIn", jwtUtil.getExpirationMs());
        return result;
    }

    private Map<String, Object> buildTokenResult(String username) {
        CustomUserDetails details = (CustomUserDetails) userDetailsService.loadUserByUsername(username);
        String token = jwtUtil.generateToken(username, details.getUserId());
        return Map.of("token", token, "user", toVO(details.getUser(), extractRoles(details)));
    }

    private List<String> extractRoles(CustomUserDetails details) {
        return details.getAuthorities().stream()
                .map(a -> a.getAuthority().replace("ROLE_", ""))
                .toList();
    }

    private UserInfoVO toVO(User user, List<String> roles) {
        UserInfoVO vo = new UserInfoVO();
        vo.setId(user.getId());
        vo.setUsername(user.getUsername());
        vo.setNickname(user.getNickname());
        vo.setAvatar(user.getAvatar());
        vo.setEmail(user.getEmail());
        vo.setBio(user.getBio());
        vo.setHobbies(user.getHobbies());
        vo.setFavoriteBoardIds(user.getFavoriteBoardIds());
        // 1.2 起：游戏爱好解析
        vo.setFavoriteGameIds(user.getFavoriteGameIds());
        vo.setFavoriteGames(resolveFavoriteGames(user.getFavoriteGameIds()));
        vo.setGender(user.getGender());
        vo.setRoles(roles);
        // 身份徽章 + 活跃度等级
        List<Long> boardIds = moderatorBoardService.listBoardIdsByUserId(user.getId());
        UserIdentity id = badgeService.compute(user, roles, boardIds);
        vo.setBadge(id.getBadge());
        vo.setBadgeColor(id.getBadgeColor());
        vo.setBadgeText(id.getBadgeText());
        vo.setActivityScore(user.getActivityScore() == null ? 0 : user.getActivityScore());
        vo.setActivityLevel(id.getLevel());
        vo.setActivityTitle(id.getLevelTitle());
        vo.setPoints(user.getPoints() == null ? 0 : user.getPoints());
        // 统计该用户未删除帖子获得的点赞总数（含隐藏帖；不含已删除帖）
        Integer likeReceivedCount = postMapper.selectObjs(Wrappers.<Post>lambdaQuery()
                        .eq(Post::getUserId, user.getId())
                        .select(Post::getLikeCount))
                .stream()
                .filter(o -> o != null)
                .mapToInt(o -> ((Number) o).intValue())
                .sum();
        vo.setLikeReceivedCount(likeReceivedCount);
        // 角色负责的板块（个人中心展示用）
        vo.setModeratorBoardIds(boardIds);
        vo.setModeratorBoardNames(moderatorBoardService.listBoardNamesByUserId(user.getId()));
        // 角色负责的游戏 id（前端做「作用域」判定的依据：帖子 gameId 是否在此列表内）
        vo.setModeratorGameIds(moderatorBoardService.listGameIdsByUserId(user.getId()));
        // 角色负责的游戏名（徽章显示用：「版主 · 三角洲行动」之类）
        vo.setModeratorGameNames(moderatorBoardService.listGameNamesByUserId(user.getId()));
        // 账号修改窗口（从未修改过 或 距上次修改满一年 才可改）
        LocalDateTime lastChange = user.getLastUsernameChangeAt();
        if (lastChange == null) {
            vo.setCanChangeUsername(true);
            vo.setNextUsernameChangeAt(null);
        } else {
            LocalDateTime next = lastChange.plusYears(1);
            boolean can = !LocalDateTime.now().isBefore(next);
            vo.setCanChangeUsername(can);
            vo.setNextUsernameChangeAt(can ? null : next);
        }
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
