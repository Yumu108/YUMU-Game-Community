package com.yumu.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.yumu.community.entity.AdminAuditLog;
import org.apache.ibatis.annotations.Mapper;

/**
 * 审计日志 Mapper。审计只做「追加」与「按条件检索」，检索统一走 QueryWrapper，故无需自定义 SQL。
 */
@Mapper
public interface AdminAuditLogMapper extends BaseMapper<AdminAuditLog> {
}
