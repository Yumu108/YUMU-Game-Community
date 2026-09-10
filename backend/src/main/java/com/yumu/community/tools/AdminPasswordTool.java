package com.yumu.community.tools;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.security.SecureRandom;

/**
 * D2（9-10）：管理员口令运维工具 —— 打包进 jar，生成 BCrypt 口令哈希时不依赖任何外部工具。
 *
 * <p>解决的问题：此前管理员账号是**手工在数据库里建的**，仓库内没有任何初始化脚本，
 * 换一台服务器部署就复现不出来；而临时手搓一个 BCrypt 串又极易出错（格式不对 → 建出来的
 * 管理员永远登录不上）。本项目已有 fat jar，直接内置入口最省事。
 *
 * <p>用法（只输出结果后退出，不会启动 Web 容器）：
 * <pre>
 *   # ① 为指定口令生成 BCrypt 哈希
 *   java -jar yumu-community-1.0.0.jar --gen-password-hash='你的口令'
 *
 *   # ② 直接生成一个随机强口令 + 对应哈希（部署时推荐用这个）
 *   java -jar yumu-community-1.0.0.jar --gen-password
 * </pre>
 */
public final class AdminPasswordTool {

    /** 随机口令长度。 */
    private static final int RANDOM_LENGTH = 20;

    /** 随机口令字符集：剔除 0/O/1/l/I 等易混字符，便于人工转录到密码管理器。 */
    private static final char[] ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*".toCharArray();

    private AdminPasswordTool() {
    }

    /**
     * 若命令行命中运维子命令，则执行并返回 {@code true}
     * （调用方应直接返回，不再启动 Spring 容器）。
     */
    public static boolean tryRun(String[] args) {
        String hashArg = null;
        boolean genRandom = false;
        for (String a : args) {
            if (a == null) {
                continue;
            }
            if ("--gen-password".equals(a)) {
                genRandom = true;
            } else if (a.startsWith("--gen-password-hash=")) {
                hashArg = a.substring("--gen-password-hash=".length());
            }
        }
        if (!genRandom && hashArg == null) {
            return false;
        }

        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        if (genRandom) {
            String pwd = randomPassword();
            System.out.println("=======================================================");
            System.out.println(" 已生成随机管理员口令 —— 请立即保存，此处只显示这一次");
            System.out.println("-------------------------------------------------------");
            System.out.println(" 明文口令  : " + pwd);
            System.out.println(" BCrypt哈希 : " + encoder.encode(pwd));
            System.out.println("-------------------------------------------------------");
            System.out.println(" 用法：把哈希写进 deploy/tools/init-admin.sql 的");
            System.out.println("       @admin_password_hash，或用 deploy/tools/init-admin.sh");
            System.out.println("=======================================================");
        } else if (hashArg.isEmpty()) {
            System.err.println("用法：java -jar app.jar --gen-password-hash='你的口令'");
            System.exit(2);
        } else {
            System.out.println(encoder.encode(hashArg));
        }
        return true;
    }

    private static String randomPassword() {
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder(RANDOM_LENGTH);
        for (int i = 0; i < RANDOM_LENGTH; i++) {
            sb.append(ALPHABET[rnd.nextInt(ALPHABET.length)]);
        }
        return sb.toString();
    }
}
