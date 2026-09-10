package com.yumu.community.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.yumu.community.common.AuditActions;
import com.yumu.community.common.PageResult;
import com.yumu.community.entity.AdminAuditLog;
import com.yumu.community.mapper.AdminAuditLogMapper;
import com.yumu.community.security.CustomUserDetails;
import com.yumu.community.service.AuditLogService;
import com.yumu.community.utils.RequestUtils;
import com.yumu.community.vo.AdminAuditLogVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuditLogServiceImpl implements AuditLogService {

    private final AdminAuditLogMapper auditLogMapper;

    @Override
    public void record(String action, String targetType, Long targetId, String detail) {
        try {
            AdminAuditLog row = new AdminAuditLog();
            row.setAction(action);
            row.setTargetType(targetType);
            row.setTargetId(targetId);
            row.setDetail(trim(detail, 500));
            row.setIp(RequestUtils.clientIp());
            CustomUserDetails me = currentUser();
            if (me != null) {
                row.setOperatorId(me.getUserId());
                // 昵称快照：用户之后改名也不影响这条历史记录的可追溯性
                row.setOperatorName(me.getUser().getNickname() != null
                        ? me.getUser().getNickname() : me.getUsername());
            }
            auditLogMapper.insert(row);
        } catch (Exception e) {
            // 审计是旁路能力：写失败只记日志，绝不把异常抛回业务链路
            log.error("写入审计日志失败 action={} targetType={} targetId={}", action, targetType, targetId, e);
        }
    }

    @Override
    public PageResult<AdminAuditLogVO> page(String action, String targetType, String operator,
                                            String from, String to, long current, long size) {
        Page<AdminAuditLog> page = new Page<>(Math.max(1, current), Math.min(100, Math.max(1, size)));
        QueryWrapper<AdminAuditLog> qw = new QueryWrapper<>();
        qw.eq("deleted", 0);
        if (notBlank(action)) qw.eq("action", action.trim());
        if (notBlank(targetType)) qw.eq("target_type", targetType.trim());
        if (notBlank(operator)) {
            String kw = operator.trim();
            // 昵称模糊；若输入纯数字则同时按 user_id 精确匹配（便于按 ID 追查）
            if (kw.matches("\\d+")) {
                Long uid = Long.valueOf(kw);
                qw.and(w -> w.eq("operator_id", uid).or().like("operator_name", kw));
            } else {
                qw.like("operator_name", kw);
            }
        }
        if (notBlank(from)) qw.ge("created_at", normalizeTime(from.trim(), true));
        if (notBlank(to)) qw.le("created_at", normalizeTime(to.trim(), false));
        qw.orderByDesc("created_at").orderByDesc("id");

        Page<AdminAuditLog> res = auditLogMapper.selectPage(page, qw);
        List<AdminAuditLogVO> vos = res.getRecords().stream().map(this::toVO).toList();
        return PageResult.of(res.getTotal(), res.getPages(), res.getCurrent(), res.getSize(), vos);
    }

    private AdminAuditLogVO toVO(AdminAuditLog row) {
        AdminAuditLogVO vo = new AdminAuditLogVO();
        vo.setId(row.getId());
        vo.setOperatorId(row.getOperatorId());
        vo.setOperatorName(row.getOperatorName());
        vo.setAction(row.getAction());
        vo.setActionLabel(AuditActions.label(row.getAction()));
        vo.setTargetType(row.getTargetType());
        vo.setTargetId(row.getTargetId());
        vo.setDetail(row.getDetail());
        vo.setIp(row.getIp());
        vo.setCreatedAt(row.getCreatedAt());
        return vo;
    }

    /** 只传日期时补全时分秒：起点补 00:00:00，终点补 23:59:59（否则"截止今天"会漏掉当天数据）。 */
    private String normalizeTime(String t, boolean startOfDay) {
        if (t.length() == 10) {
            return t + (startOfDay ? " 00:00:00" : " 23:59:59");
        }
        return t;
    }

    private CustomUserDetails currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof CustomUserDetails cud) {
            return cud;
        }
        return null;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String trim(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
