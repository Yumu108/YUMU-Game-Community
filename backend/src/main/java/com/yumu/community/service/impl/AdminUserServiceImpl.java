package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.BusinessException;
import com.yumu.community.common.PageResult;
import com.yumu.community.dto.ModeratorBoardItem;
import com.yumu.community.dto.ResetPasswordRequest;
import com.yumu.community.dto.UpdateUserProfileRequest;
import com.yumu.community.entity.ModeratorBoard;
import com.yumu.community.entity.Role;
import com.yumu.community.entity.User;
import com.yumu.community.entity.UserRole;
import com.yumu.community.mapper.ModeratorBoardMapper;
import com.yumu.community.mapper.RoleMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.mapper.UserRoleMapper;
import com.yumu.community.service.AdminUserService;
import com.yumu.community.service.ModeratorBoardService;
import com.yumu.community.vo.AdminUserDetailVO;
import com.yumu.community.vo.AdminUserVO;
import com.yumu.community.vo.ModeratorAssignmentVO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AdminUserServiceImpl implements AdminUserService {

    private final UserMapper userMapper;
    private final UserRoleMapper userRoleMapper;
    private final RoleMapper roleMapper;
    private final ModeratorBoardMapper moderatorBoardMapper;
    private final ModeratorBoardService moderatorBoardService;
    private final PasswordEncoder passwordEncoder;

    @Override
    public PageResult<AdminUserVO> listUsers(String keyword, Long gameId, long current, long size) {
        Page<User> page = new Page<>(Math.max(1, current), Math.min(100, Math.max(1, size)));
        com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<User> qw =
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>();
        qw.eq("deleted", 0);
        if (keyword != null && !keyword.isBlank()) {
            qw.and(w -> w.like("username", keyword).or().like("nickname", keyword));
        }
        // 9-07：按游戏筛版主：限制 user.id ∈ (SELECT user_id FROM moderator_board WHERE game_id = #{gameId})
        if (gameId != null) {
            // 先查该游戏的版主 user_id 集合，避免子查询包裹分页 SQL 引发兼容性问题
            List<ModeratorBoard> rows = moderatorBoardMapper.selectList(
                    Wrappers.<ModeratorBoard>lambdaQuery()
                            .eq(ModeratorBoard::getGameId, gameId)
                            .select(ModeratorBoard::getUserId));
            Set<Long> userIds = rows.stream().map(ModeratorBoard::getUserId).collect(Collectors.toCollection(HashSet::new));
            if (userIds.isEmpty()) {
                // 该游戏暂无版主，直接返回空页
                return PageResult.of(0, 0, current, size, List.of());
            }
            qw.in("id", userIds);
        }
        qw.orderByDesc("created_at");
        Page<User> res = userMapper.selectPage(page, qw);

        List<Long> userIds = res.getRecords().stream().map(User::getId).toList();
        Map<Long, List<String>> rolesMap = batchRoles(userIds);

        List<AdminUserVO> vos = res.getRecords().stream().map(u -> {
            AdminUserVO vo = new AdminUserVO();
            vo.setId(u.getId());
            vo.setUsername(u.getUsername());
            vo.setNickname(u.getNickname());
            vo.setAvatar(u.getAvatar());
            vo.setStatus(u.getStatus());
            vo.setRoles(rolesMap.getOrDefault(u.getId(), Collections.emptyList()));
            vo.setCreatedAt(u.getCreatedAt());
            // 9-07：列出该用户的版主授权（含游戏名），便于卡片展示与前端二次过滤
            vo.setModeratorAssignments(moderatorBoardService.listAssignmentsVO(u.getId()));
            return vo;
        }).toList();
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    @Override
    public AdminUserDetailVO getUserDetail(Long userId) {
        User u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(404, "用户不存在");
        AdminUserDetailVO vo = new AdminUserDetailVO();
        vo.setId(u.getId());
        vo.setUsername(u.getUsername());
        vo.setNickname(u.getNickname());
        vo.setAvatar(u.getAvatar());
        vo.setStatus(u.getStatus());
        vo.setEmail(u.getEmail());
        vo.setBio(u.getBio());
        vo.setGender(u.getGender());
        vo.setCreatedAt(u.getCreatedAt());
        vo.setRoles(batchRoles(List.of(userId)).getOrDefault(userId, Collections.emptyList()));
        vo.setModeratorAssignments(moderatorBoardService.listAssignmentsVO(userId));
        return vo;
    }

    @Override
    @Transactional
    public void updateUserRoles(Long userId, List<String> roleCodes) {
        User u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(404, "用户不存在");
        if (roleCodes == null || roleCodes.isEmpty()) {
            throw new BusinessException(400, "至少保留一个角色");
        }
        // 校验角色 code 有效
        List<Role> roles = roleMapper.selectList(
                Wrappers.<Role>lambdaQuery().in(Role::getCode, roleCodes));
        if (roles.size() != roleCodes.stream().distinct().count()) {
            throw new BusinessException(400, "存在无效角色");
        }
        // 清空旧角色并重新绑定
        userRoleMapper.delete(
                Wrappers.<UserRole>lambdaQuery().eq(UserRole::getUserId, userId));
        for (Role r : roles) {
            UserRole ur = new UserRole();
            ur.setUserId(userId);
            ur.setRoleId(r.getId());
            userRoleMapper.insert(ur);
        }
        // 如果用户不再是版主，清空其负责板块
        if (!roleCodes.contains("MODERATOR")) {
            moderatorBoardService.setModeratorBoards(userId, List.of());
        }
    }

    @Override
    @Transactional
    public void setUserStatus(Long operatorId, Long userId, int status) {
        if (!List.of(0, 1).contains(status)) {
            throw new BusinessException(400, "非法的状态值");
        }
        if (operatorId.equals(userId)) {
            throw new BusinessException(400, "不能封禁或解封自己");
        }
        User u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(404, "用户不存在");
        if (u.getStatus() != null && u.getStatus() == status) {
            return; // 幂等
        }
        userMapper.update(null, Wrappers.<User>lambdaUpdate()
                .eq(User::getId, userId).set(User::getStatus, status));
    }

    @Override
    @Transactional
    public void updateUserProfile(Long userId, UpdateUserProfileRequest req) {
        User u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(404, "用户不存在");
        if (req.getNickname() != null) u.setNickname(req.getNickname().trim());
        if (req.getBio() != null) u.setBio(req.getBio());
        if (req.getEmail() != null) {
            // 邮箱唯一约束：若变更且与他人冲突则报错
            String email = req.getEmail().trim();
            if (!email.equals(u.getEmail()) && userMapper.selectCount(
                    Wrappers.<User>lambdaQuery().eq(User::getEmail, email)) > 0) {
                throw new BusinessException(409, "邮箱已被其他用户占用");
            }
            u.setEmail(email);
        }
        if (req.getAvatar() != null) u.setAvatar(req.getAvatar());
        if (req.getGender() != null) u.setGender(req.getGender());
        userMapper.updateById(u);
    }

    @Override
    @Transactional
    public String resetPassword(Long userId, ResetPasswordRequest req) {
        User u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(404, "用户不存在");
        // 1.2 起：强制要求管理员显式输入新密码，不再生成随机初始密码（避免管理员「留空」误操作）
        String raw = req == null ? null : req.getNewPassword();
        if (raw == null || raw.isBlank()) {
            throw new BusinessException(400, "请输入新密码（不允许留空）");
        }
        String newPassword = raw.trim();
        if (newPassword.length() < 6) {
            throw new BusinessException(400, "密码长度至少 6 位");
        }
        u.setPassword(passwordEncoder.encode(newPassword));
        userMapper.updateById(u);
        return newPassword;
    }

    @Override
    @Transactional
    public void deleteUser(Long operatorId, Long userId) {
        if (operatorId.equals(userId)) {
            throw new BusinessException(400, "不能删除自己");
        }
        User u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(404, "用户不存在");
        // 逻辑删除前先清空版主关联：用户被逻辑删除后 moderator_board 行不会级联消失，
        // 会变成「幽灵版主」继续占用单游戏版主名额（曾导致上限被历史测试账号占满）。
        moderatorBoardService.setModeratorBoards(userId, List.of());
        // 逻辑删除：物理删除会级联清掉其帖子/回复，风险较高，采用逻辑删除保留数据
        userMapper.deleteById(userId);
    }

    private Map<Long, List<String>> batchRoles(List<Long> userIds) {
        if (userIds.isEmpty()) return Map.of();
        List<UserRole> urs = userRoleMapper.selectList(
                Wrappers.<UserRole>lambdaQuery().in(UserRole::getUserId, userIds));
        if (urs.isEmpty()) return Map.of();
        Set<Long> roleIds = urs.stream().map(UserRole::getRoleId).collect(Collectors.toSet());
        Map<Long, String> roleCodeMap = roleMapper.selectBatchIds(roleIds).stream()
                .collect(Collectors.toMap(Role::getId, Role::getCode));
        return urs.stream().collect(Collectors.groupingBy(
                UserRole::getUserId,
                Collectors.mapping(ur -> roleCodeMap.getOrDefault(ur.getRoleId(), "UNKNOWN"), Collectors.toList())
        ));
    }
}
