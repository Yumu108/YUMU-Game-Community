package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.yumu.community.common.BusinessException;
import com.yumu.community.dto.EmailBindRequest;
import com.yumu.community.dto.UserEmailCodeRequest;
import com.yumu.community.entity.User;
import com.yumu.community.mail.EmailScene;
import com.yumu.community.mail.MailService;
import com.yumu.community.mapper.UserMapper;
import com.yumu.community.service.AuthService;
import com.yumu.community.service.EmailCodeService;
import com.yumu.community.service.UserEmailService;
import com.yumu.community.vo.UserInfoVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

/**
 * 邮箱绑定 / 更换（9-15）。
 *
 * <h3>为什么不做「先解绑再绑定」</h3>
 * 那样中间会存在「原邮箱已解绑、新邮箱还没绑上」的窗口，此刻若用户网络断了、
 * 或新邮箱验证码过期，账号就变成一个没有邮箱的裸状态（与我们的产品决定冲突）。
 * 所以改成<b>两个验证码都过了才一次性替换</b>，全程要么旧邮箱、要么新邮箱，没有中间态。
 *
 * <h3>为什么「先验新码、再验原码」</h3>
 * 校验规则是「失败不消费、成功才消费」。新码填错的概率远高于原码（新邮箱可能抄错、
 * 或验证码输错一位），先验新码能在<b>零副作用</b>的前提下拦掉绝大多数错误，
 * 不至于白白把原邮箱那枚码消费掉、逼用户从头再来。
 * 但「原邮箱码压根没填」这种<b>免费就能判断</b>的错，要在验新码<b>之前</b>就拦掉 ——
 * 否则注定失败的请求仍会把新码消费掉。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserEmailServiceImpl implements UserEmailService {

    private final UserMapper userMapper;
    private final EmailCodeService emailCodeService;
    private final AuthService authService;

    @Override
    public void sendCode(Long userId, UserEmailCodeRequest req) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(404, "用户不存在");
        }
        String scene = req.getScene() == null ? "" : req.getScene().trim().toLowerCase(Locale.ROOT);

        if ("old".equals(scene)) {
            // 发给当前已绑定的邮箱 —— 用于证明「你是号主」
            if (isBlank(user.getEmail())) {
                throw new BusinessException(400, "当前账号还没有绑定邮箱，无需验证原邮箱");
            }
            emailCodeService.send(user.getEmail(), EmailScene.UNBIND);
            return;
        }

        if ("new".equals(scene)) {
            String email = emailCodeService.normalize(req.getEmail());
            if (email.equalsIgnoreCase(safe(user.getEmail()))) {
                throw new BusinessException(400, "新邮箱与当前邮箱相同，无需更换");
            }
            // 提前查重：让用户「点发送验证码」时就发现被占用，不必等填完码才被拒
            if (userMapper.selectCount(Wrappers.<User>lambdaQuery()
                    .eq(User::getEmail, email)
                    .ne(User::getId, userId)) > 0) {
                throw new BusinessException(409, "该邮箱已被其他账号绑定");
            }
            emailCodeService.send(email, EmailScene.BIND);
            return;
        }

        throw new BusinessException(400, "不支持的场景");
    }

    @Override
    @Transactional
    public UserInfoVO bind(Long userId, EmailBindRequest req) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(404, "用户不存在");
        }
        String newEmail = emailCodeService.normalize(req.getEmail());
        boolean hasOld = !isBlank(user.getEmail());

        if (newEmail.equalsIgnoreCase(safe(user.getEmail()))) {
            throw new BusinessException(400, "新邮箱与当前邮箱相同，无需更换");
        }
        // 查重必须排除自己，否则「把自己的邮箱再填一遍」会被误判成占用
        if (userMapper.selectCount(Wrappers.<User>lambdaQuery()
                .eq(User::getEmail, newEmail)
                .ne(User::getId, userId)) > 0) {
            throw new BusinessException(409, "该邮箱已被其他账号绑定");
        }

        // ① 先做「免费的」存在性检查：已绑定过的账号必须带原邮箱码。
        //   必须排在验证新码之前 —— 否则一个注定失败的请求会把新邮箱那枚码白白消费掉，
        //   用户重新补上原邮箱码时反而被告知「验证码已过期」，得再等 60 秒重发。
        if (hasOld && isBlank(req.getOldEmailCode())) {
            throw new BusinessException(400, "请先验证当前绑定的邮箱");
        }

        // ② 再验新邮箱的码（码本身填错时同样无副作用，只是消耗一次错误计数）
        emailCodeService.verifyAndConsume(newEmail, EmailScene.BIND, req.getEmailCode());

        // ③ 已绑定过的账号，还必须证明自己是号主
        if (hasOld) {
            emailCodeService.verifyAndConsume(user.getEmail(), EmailScene.UNBIND, req.getOldEmailCode());
        }

        // ④ 两个码都过了，一次性替换
        User upd = new User();
        upd.setId(userId);
        upd.setEmail(newEmail);
        upd.setEmailVerified(1);
        userMapper.updateById(upd);
        log.info("[email] 绑定邮箱成功 uid={}, new={}, 换绑={}", userId, MailService.mask(newEmail), hasOld);

        // 返回最新用户信息，前端可直接刷新 store（UserInfoVO 里带 email，个人中心要立刻显示新值）
        return authService.me(userId);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }
}
