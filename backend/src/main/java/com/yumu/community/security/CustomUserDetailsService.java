package com.yumu.community.security;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.entity.Role;
import com.yumu.community.entity.User;
import com.yumu.community.entity.UserRole;
import com.yumu.community.mapper.RoleMapper;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.mapper.UserRoleMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 根据用户名加载用户与角色，用于 JWT 校验时的身份重建。
 */
@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserMapper userMapper;
    private final UserRoleMapper userRoleMapper;
    private final RoleMapper roleMapper;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userMapper.selectOne(
                Wrappers.<User>lambdaQuery().eq(User::getUsername, username));
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在：" + username);
        }
        return toDetails(user);
    }

    /** 按用户 id 加载（JWT 过滤器用 uid claim 解析，避免登录账号改名后旧 token 失效）。 */
    public UserDetails loadUserById(Long id) throws UsernameNotFoundException {
        User user = userMapper.selectById(id);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在：" + id);
        }
        return toDetails(user);
    }

    private UserDetails toDetails(User user) {
        List<Long> roleIds = userRoleMapper.selectList(
                        Wrappers.<UserRole>lambdaQuery().eq(UserRole::getUserId, user.getId()))
                .stream().map(UserRole::getRoleId).toList();
        List<String> roles = roleIds.isEmpty()
                ? List.of()
                : roleMapper.selectBatchIds(roleIds).stream().map(Role::getCode).toList();
        return new CustomUserDetails(user, roles);
    }
}
