package com.yumu.community.service.impl;

import com.yumu.community.common.BusinessException;
import com.yumu.community.entity.User;
import com.yumu.community.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户唯一键守门员：账号id（{@code uk_username}）与邮箱（{@code uk_email}）的写前检查与回收。
 *
 * <h3>为什么需要它</h3>
 * user 表两列都是<b>数据库唯一索引</b>，但走的是 MyBatis-Plus 逻辑删除（{@code deleted=0/1}）：
 * <ul>
 *   <li>应用层 {@code selectCount(...)} 会自动追加 {@code deleted=0} ⇒ <b>看不见软删行</b>；</li>
 *   <li>数据库唯一索引<b>不认</b>逻辑删除 ⇒ 软删行照旧占着这个值。</li>
 * </ul>
 * 两者一错位，就出现 2026-09-27 线上那次 500：用户删掉自己的测试账号后，
 * 想用同一个邮箱重新注册 ⇒ 查重「没查到」⇒ INSERT ⇒
 * {@code Duplicate entry 'xxx@qq.com' for key 'user.uk_email'} ⇒ 未捕获 ⇒
 * 前端看到「服务器开小差了」（换绑邮箱接口会以同样方式炸）。
 *
 * <h3>处理原则：活账号报错、已删账号回收</h3>
 * <ul>
 *   <li><b>占用者是活账号</b>（deleted=0）⇒ 抛 409，提示「已被占用」——这是正常的业务冲突。</li>
 *   <li><b>占用者是软删账号</b>（deleted=1）⇒ 判定为「墓碑占位」，把该列<b>释放</b>后放行。
 *       理由：账号已经被删了，再永远锁死本人的邮箱/账号id 说不通；而且
 *       「删除」这个动作本身也没打算让这个 id 永久作废。</li>
 * </ul>
 * 回收是<b>幂等</b>的，也对历史脏数据生效 —— 也就是说，不需要额外跑数据订正脚本，
 * 用户下一次尝试注册时就会自动把旧墓碑腾开。
 *
 * <p>另外在 {@code GlobalExceptionHandler} 里还挂了一层
 * {@code DuplicateKeyException → 409} 的兜底：并发下两个请求同时通过检查时，
 * 输的那个也不会再变成 500。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserKeyGuard {

    private final UserMapper userMapper;

    /** username 列长度上限（VARCHAR(50)），墓碑名不能超。 */
    private static final int USERNAME_MAX = 50;

    /** 墓碑名的固定后缀标记：一眼能看出这是被回收过的已删账号，且不可能与真实账号id 混淆。 */
    private static final String TOMBSTONE_TAG = "#deleted#";

    /**
     * 检查账号id 是否可用；被软删账号占用时先回收。
     *
     * @throws BusinessException 409 —— 该账号id 被一个<b>正常账号</b>占着
     */
    @Transactional
    public void assertUsernameAvailable(String username) {
        if (username == null || username.isBlank()) {
            return;
        }
        User holder = userMapper.selectByUsernameIgnoreDeleted(username.trim());
        if (holder == null) {
            return;
        }
        if (isLive(holder)) {
            throw new BusinessException(409, "账号id 已被使用，请换一个");
        }
        releaseUsername(holder);
    }

    /**
     * 检查邮箱是否可用；被软删账号占用时先回收。
     *
     * @param selfId 调用方自己的用户id —— 命中自己时直接放行（换绑/改资料时「保持原邮箱不变」）
     * @throws BusinessException 409 —— 该邮箱被<b>另一个正常账号</b>占着
     */
    @Transactional
    public void assertEmailAvailable(String email, Long selfId) {
        if (email == null || email.isBlank()) {
            return;
        }
        User holder = userMapper.selectByEmailIgnoreDeleted(email.trim());
        if (holder == null) {
            return;
        }
        if (selfId != null && selfId.equals(holder.getId())) {
            return;
        }
        if (isLive(holder)) {
            throw new BusinessException(409, "该邮箱已被注册");
        }
        releaseEmail(holder);
    }

    /**
     * 逻辑删除一个用户之后调用：把它的两把唯一键交还出来。
     *
     * <p>不这么做的话，每删一个账号就永久消耗一个邮箱 + 一个账号id，
     * 而且只有等下一个人撞上来才会暴露（表现为 500，而不是一句看得懂的提示）。</p>
     */
    @Transactional
    public void releaseKeysOfDeletedUser(User user) {
        if (user == null || user.getId() == null) {
            return;
        }
        releaseEmail(user);
        releaseUsername(user);
    }

    // ---------------------------------------------------------------- 内部

    /** deleted 字段为 null 时按「活着」处理（例如自定义 SQL 未取该列）。 */
    private static boolean isLive(User u) {
        return u.getDeleted() == null || u.getDeleted() == 0;
    }

    private void releaseEmail(User tombstone) {
        if (tombstone.getEmail() == null || tombstone.getEmail().isBlank()) {
            return;
        }
        userMapper.releaseEmailById(tombstone.getId());
        log.info("[userkey] 已回收软删账号占用的邮箱 uid={}", tombstone.getId());
    }

    private void releaseUsername(User tombstone) {
        String name = tombstone.getUsername();
        if (name == null || name.isBlank() || name.contains(TOMBSTONE_TAG)) {
            return;   // 空 / 已经是墓碑名 ⇒ 无需再改（幂等）
        }
        userMapper.renameUsernameById(tombstone.getId(), tombstoneName(name, tombstone.getId()));
        log.info("[userkey] 已回收软删账号占用的账号id uid={}", tombstone.getId());
    }

    /**
     * 生成墓碑名：{@code 123abc#deleted#20144}。
     *
     * <p>带 id 所以必定唯一（id 唯一）；带 {@code #} 所以永远撞不上真实账号id
     * （注册/改名的字符集都是 {@code [A-Za-z0-9_]}）；超长时截断原名而不是截断标记，
     * 保证 50 字符上限内仍可读、可追溯。</p>
     */
    private static String tombstoneName(String username, Long id) {
        String suffix = TOMBSTONE_TAG + id;
        int keep = Math.max(0, USERNAME_MAX - suffix.length());
        String head = username.length() > keep ? username.substring(0, keep) : username;
        return head + suffix;
    }
}
