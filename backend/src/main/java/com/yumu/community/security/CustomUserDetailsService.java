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
import java.util.Locale;

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

    /**
     * 9-15：按「账号id <b>或</b> 邮箱」加载用户 —— 登录入口专用。
     *
     * <p>顺序：先按 username 精确查（85 个老账号走这条，行为与以前一致），
     * 查不到再按 email 查（转小写，与库中归一化后的存储保持一致）；两者都查不到才抛异常。</p>
     *
     * <p>⚠️ 单独开一个方法而不是改写 {@link #loadUserByUsername}：后者还被
     * {@code AuthServiceImpl#refresh} 使用（传的是库里的真实 username），
     * 保持它「就是账号id」的语义更不容易出岔子。</p>
     */
    public UserDetails loadByLoginIdentifier(String identifier) throws UsernameNotFoundException {
        if (identifier == null || identifier.isBlank()) {
            throw new UsernameNotFoundException("登录标识为空");
        }
        String key = identifier.trim();
        User user = userMapper.selectOne(
                Wrappers.<User>lambdaQuery().eq(User::getUsername, key));
        if (user == null && key.indexOf('@') > 0) {
            // 只有长得像邮箱才走第二条查询，省掉一次无意义的全表匹配
            user = userMapper.selectOne(
                    Wrappers.<User>lambdaQuery().eq(User::getEmail, key.toLowerCase(Locale.ROOT)));
        }
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在：" + key);
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
