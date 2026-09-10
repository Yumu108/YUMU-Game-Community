package com.yumu.community.service;

import com.yumu.community.common.PageResult;
import com.yumu.community.dto.AnnouncementRequest;
import com.yumu.community.vo.AnnouncementVO;

import java.util.List;

/**
 * 公告服务：公开（取展示中的）/ 管理端 CRUD。
 */
public interface NoticeService {

    /** 公开：取展示中的公告列表，按 sort 倒序 → id 倒序，size 由调用方控制。 */
    List<AnnouncementVO> listActive(int size);

    /** 公开/管理端：详情（含已隐藏）。 */
    AnnouncementVO getById(Long id);

    /** 管理端：分页（包含全部状态，便于后台管理）。 */
    PageResult<AnnouncementVO> pageAdmin(long current, long size);

    /** 管理端：创建。 */
    Long create(AnnouncementRequest req, Long operatorId);

    /** 管理端：更新。 */
    void update(Long id, AnnouncementRequest req);

    /** 管理端：删除（逻辑删除）。 */
    void delete(Long id);

    /**
     * 管理端：置顶/取消置顶。
     * @param id 公告 ID
     * @param isTop true=置顶，false=取消置顶
     */
    void setTop(Long id, boolean isTop);
}