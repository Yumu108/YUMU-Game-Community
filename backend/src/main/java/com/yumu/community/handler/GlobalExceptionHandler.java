package com.yumu.community.handler;

import com.yumu.community.common.BusinessException;
import com.yumu.community.common.Result;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 全局异常处理：将各类异常统一为 Result 响应。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusiness(BusinessException e) {
        return Result.error(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(AuthenticationException.class)
    public Result<Void> handleAuth(AuthenticationException e) {
        return Result.error(401, "未登录或登录已过期");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleValid(MethodArgumentNotValidException e) {
        StringBuilder sb = new StringBuilder();
        for (FieldError fe : e.getBindingResult().getFieldErrors()) {
            sb.append(fe.getField()).append(": ").append(fe.getDefaultMessage()).append("; ");
        }
        return Result.error(400, sb.length() > 0 ? sb.toString() : "参数校验失败");
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public Result<Void> handleMaxUpload(MaxUploadSizeExceededException e) {
        return Result.error(400, "文件过大（上限 10MB），请压缩后再上传");
    }

    /**
     * 角色/权限不足（如普通用户调用 @PreAuthorize("hasRole('ADMIN')") 的接口）。
     * 与全局约定一致：HTTP 200 + code=403，便于前端按 data.code 拦截。
     */
    @ExceptionHandler(AccessDeniedException.class)
    public Result<Void> handleAccessDenied(AccessDeniedException e) {
        return Result.error(403, "无权限（需要管理员角色）");
    }

    /**
     * 接口/资源不存在（如已下线的 /admin/boards 或拼错的路径）：统一返回 404 而非 500。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public Result<Void> handleNotFound(NoResourceFoundException e) {
        return Result.error(404, "接口不存在：" + e.getResourcePath());
    }

    /**
     * 9-08：路径参数类型错误（如被篡改的提及链接 /user/1的02 → Long 转换失败）。
     * 返回 400 而非 500，配合前端用户页的非数字 id 拦截，杜绝红色系统报错。
     */
    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public Result<Void> handleTypeMismatch(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException e) {
        return Result.error(400, "参数格式不正确");
    }

    /**
     * D3 伴生（9-10）：请求体 JSON 解析失败。
     * 修复前会落进 handleOther 被报成 500（实测：向 /auth/login 发 `{bad json` → 500），
     * 属客户端错误而非服务端故障，且会污染服务端 ERROR 日志、干扰告警。此处归位为 400。
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public Result<Void> handleBodyUnreadable(HttpMessageNotReadableException e) {
        return Result.error(400, "请求体格式不正确（JSON 解析失败）");
    }

    /** D3 伴生：请求方法不支持（如把 POST 接口用 GET 调）。原会落进 handleOther 报 500。 */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public Result<Void> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        return Result.error(405, "请求方法不支持：" + e.getMethod());
    }

    /** D3 伴生：缺少必填查询参数。同为客户端错误，归位 400。 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public Result<Void> handleMissingParam(MissingServletRequestParameterException e) {
        return Result.error(400, "缺少必要参数：" + e.getParameterName());
    }

    /**
     * D3（9-10）：兜底 500 —— 必须「日志留全、响应留白」。
     *
     * 修复前：`Result.error(500, "服务器内部错误：" + e.getMessage())` —— 把内部异常原文
     *（SQL 片段 / 绝对路径 / 类名 / 框架堆栈消息）直接吐给客户端，且全程没有 log.error，
     * 线上 500 既泄密又查不到根因（与本项目 B5「日志落盘+告警」目标自相矛盾）。
     *
     * 修复后：完整异常（含堆栈）只进服务端日志（ERROR 级别 → logback 单独落 error.log），
     * 客户端只拿到与请求方法/路径绑定的「事件编号」，便于用户报障时和日志对上，
     * 但拿不到任何内部细节。
     */
    @ExceptionHandler(Exception.class)
    public Result<Void> handleOther(Exception e, HttpServletRequest request) {
        String traceId = Long.toHexString(System.nanoTime()).toUpperCase();
        log.error("[500][{}] {} {} 未处理异常", traceId, request.getMethod(), request.getRequestURI(), e);
        return Result.error(500, "服务器开小差了，请稍后再试（错误编号 " + traceId + "）");
    }
}
