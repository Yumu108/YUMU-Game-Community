package com.yumu.community.common;

/**
 * 业务异常：在 Service 层抛出，由全局异常处理器转换为统一响应。
 */
public class BusinessException extends RuntimeException {

    private final int code;

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }

    public BusinessException(String message) {
        this(500, message);
    }

    public int getCode() {
        return code;
    }
}
