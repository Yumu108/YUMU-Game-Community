package com.yumu.community.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 审计动作码字典的单元测试。
 *
 * 这里的断言解决一个具体的隐性风险：动作码是「写库值」与「界面展示」共用的标识，
 * 一旦某个码漏登记中文标签，界面就会显示英文码（如 POST_HIDE），
 * 而这种问题在接口测试里看不出、只有人肉点开日志页才会发现。
 */
class AuditActionsTest {

    @Test
    @DisplayName("动作码表非空且去重")
    void allIsNonEmptyAndUnique() {
        List<String> all = AuditActions.all();
        assertFalse(all.isEmpty(), "动作码表不应为空");
        assertEquals(all.size(), all.stream().distinct().count(), "动作码不应重复");
        // 注意：Map.ofEntries 上限 10 组，实际动作码已 > 10，故此处只校验非空与去重
        assertTrue(all.size() >= 20, "动作码数量异常偏少：" + all.size());
    }

    @Test
    @DisplayName("每个动作码都有中文标签（不得回落为英文码本身）")
    void everyActionHasChineseLabel() {
        for (String code : AuditActions.all()) {
            String label = AuditActions.label(code);
            assertNotNull(label);
            assertNotEquals(code, label, "动作码 " + code + " 缺少中文标签");
            assertTrue(label.matches(".*[\\u4e00-\\u9fa5].*"), "标签应含中文：" + code + " → " + label);
        }
    }

    @Test
    @DisplayName("核心动作码的标签符合预期")
    void keyLabelsAreCorrect() {
        assertEquals("隐藏帖子", AuditActions.label(AuditActions.POST_HIDE));
        assertEquals("审核通过", AuditActions.label(AuditActions.POST_APPROVE));
        assertEquals("封禁用户", AuditActions.label(AuditActions.USER_BAN));
        assertEquals("驳回帖子", AuditActions.label(AuditActions.POST_REJECT));
        assertEquals("处理举报", AuditActions.label(AuditActions.REPORT_HANDLE));
    }

    @Test
    @DisplayName("未登记的码原样返回，便于灰度新增动作码")
    void unknownActionFallsBackToCode() {
        assertEquals("SOME_NEW_ACTION", AuditActions.label("SOME_NEW_ACTION"));
        assertNull(AuditActions.label(null));
    }

    @Test
    @DisplayName("对象类型常量齐全（前端筛选下拉依赖）")
    void targetTypesAreDefined() {
        List<String> t = List.of(
                AuditActions.TARGET_POST, AuditActions.TARGET_REPLY, AuditActions.TARGET_USER,
                AuditActions.TARGET_REPORT, AuditActions.TARGET_ANNOUNCEMENT, AuditActions.TARGET_GAME);
        assertEquals(6, t.stream().distinct().count(), "对象类型不应重复");
        assertTrue(t.contains("POST") && t.contains("USER") && t.contains("GAME"));
    }
}
