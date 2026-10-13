package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class OrderBrowserTechnicalErrorsTest {
    @Test public void knownTechnicalCodesHaveFixedDistinctMessages() {
        assertEquals("外卖页面初始化失败，自动操作已停止。请手动返回后重试。",
            OrderBrowserPlugin.technicalErrorMessage("takeout_page_init_failed"));
        assertEquals("外卖页面渲染进程已退出，自动操作已停止。请手动返回后重试。",
            OrderBrowserPlugin.technicalErrorMessage("takeout_page_renderer_failed"));
        assertEquals("外卖页面已重新打开，自动操作已停止。请先手动核对，再返回重试。",
            OrderBrowserPlugin.technicalErrorMessage("takeout_page_interrupted"));
    }

    @Test public void unknownCodesCannotBecomePublicErrorText() {
        for (String code : new String[]{null, "", "timeout", "cancelled", "fictional private upstream text"}) {
            assertNull(OrderBrowserPlugin.technicalErrorMessage(code));
        }
    }
}
