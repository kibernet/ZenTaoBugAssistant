package com.zentao.bugassistant;

import java.util.List;
import java.util.Map;

public final class ZenTaoParserSelfTest {
    private ZenTaoParserSelfTest() {
    }

    public static void main(String[] args) {
        String bugTableHtml =
                "<table>\n" +
                "  <thead>\n" +
                "    <tr>\n" +
                "      <th>ID</th>\n" +
                "      <th>Bug标题</th>\n" +
                "      <th>级别</th>\n" +
                "      <th>状态</th>\n" +
                "      <th>创建者</th>\n" +
                "      <th>创建日期</th>\n" +
                "      <th>确认</th>\n" +
                "      <th>指派给</th>\n" +
                "    </tr>\n" +
                "  </thead>\n" +
                "  <tbody>\n" +
                "    <tr>\n" +
                "      <td>183099</td>\n" +
                "      <td><a href=\"/index.php?m=bug&amp;f=view&amp;bugID=183099\">8.1.0---渔场激光技能---触发斩杀的时候索敌时间结束了，没有用激光但是在发炮</a></td>\n" +
                "      <td>一般</td>\n" +
                "      <td>激活</td>\n" +
                "      <td>石挺现</td>\n" +
                "      <td>06-02 10:55</td>\n" +
                "      <td>已确认</td>\n" +
                "      <td><a href=\"/index.php?m=user&amp;f=view&amp;account=wangqiangqiang\">王强强</a></td>\n" +
                "    </tr>\n" +
                "  </tbody>\n" +
                "</table>\n" +
                "<input type=\"hidden\" id=\"recTotal\" value=\"1\">\n" +
                "<input type=\"hidden\" id=\"recPerPage\" value=\"20\">\n" +
                "<input type=\"hidden\" id=\"pageID\" value=\"1\">\n";

        String wrappedTableHtml = jsonHtml(bugTableHtml);
        List<Map<String, String>> tableBugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(wrappedTableHtml);
        assertEquals(1, tableBugs.size(), "table bug count");
        Map<String, String> bug = tableBugs.get(0);
        assertEquals("183099", bug.get("id"), "table bug id");
        assertContains(bug.get("title"), "渔场激光技能", "table bug title");
        assertEquals("medium", bug.get("priority"), "table bug priority");
        assertEquals("active", bug.get("status"), "table bug status");
        assertEquals("王强强", bug.get("assignedTo"), "table bug assignee");
        assertEquals("true", bug.get("confirmed"), "table bug confirmed");

        Map<String, Integer> pager = ZenTaoBugAssistantToolWindowFactory.parseBugPagerForTest(wrappedTableHtml);
        assertEquals(1, pager.get("recTotal"), "pager recTotal");
        assertEquals(20, pager.get("recPerPage"), "pager recPerPage");
        assertEquals(1, pager.get("pageID"), "pager pageID");
        assertEquals(1, pager.get("pageTotal"), "pager pageTotal");

        String linkOnlyHtml = jsonHtml(
                "<div class=\"bug-list\">\n" +
                "  <a href=\"/index.php?m=bug&amp;f=view&amp;bugID=183099\">8.1.0---渔场激光技能---触发斩杀的时候索敌时间结束了</a>\n" +
                "  <span>一般</span><span>激活</span><span>指派给 王强强</span><span>06-02 10:55</span>\n" +
                "</div>\n");
        List<Map<String, String>> linkBugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(linkOnlyHtml);
        assertEquals(1, linkBugs.size(), "link bug count");
        assertEquals("183099", linkBugs.get(0).get("id"), "link bug id");
        assertContains(linkBugs.get(0).get("title"), "渔场激光技能", "link bug title");
        assertEquals("王强强", linkBugs.get(0).get("assignedTo"), "link bug assignee");

        String rewrittenTableHtml = jsonHtml(
                "<table>\n" +
                "  <thead>\n" +
                "    <tr>\n" +
                "      <th><input type=\"checkbox\"></th>\n" +
                "      <th>ID</th>\n" +
                "      <th>Bug标题</th>\n" +
                "      <th>级别</th>\n" +
                "      <th>状态</th>\n" +
                "      <th>指派给</th>\n" +
                "    </tr>\n" +
                "  </thead>\n" +
                "  <tbody>\n" +
                "    <tr data-id=\"183099\">\n" +
                "      <td><input type=\"checkbox\" name=\"bugIDList[]\" value=\"183099\"></td>\n" +
                "      <td><a href=\"/bug-view-183099.html\">183099</a></td>\n" +
                "      <td><a href=\"/bug-view-183099.html\">8.1.0---渔场激光技能触发新杀的时候索敌时间结束了</a></td>\n" +
                "      <td>一般</td>\n" +
                "      <td>激活</td>\n" +
                "      <td><a href=\"/index.php?m=user&f=view&account=wangqiangqiang\">王强强</a></td>\n" +
                "    </tr>\n" +
                "  </tbody>\n" +
                "  <input type=\"hidden\" name=\"recTotal\" value=\"1\">\n" +
                "</table>\n");
        List<Map<String, String>> rewrittenBugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(rewrittenTableHtml);
        assertEquals(1, rewrittenBugs.size(), "rewritten table bug count");
        assertEquals("183099", rewrittenBugs.get(0).get("id"), "rewritten table bug id");
        assertContains(rewrittenBugs.get(0).get("title"), "渔场激光技能", "rewritten table bug title");
        assertEquals("active", rewrittenBugs.get(0).get("status"), "rewritten table bug status");
        assertEquals("王强强", rewrittenBugs.get(0).get("assignedTo"), "rewritten table bug assignee");

        String moduleSettingsHtml = jsonHtml(
                "<table>\n" +
                "  <tbody>\n" +
                "    <tr data-id=\"0\">\n" +
                "      <td><input type=\"checkbox\" value=\"0\"></td>\n" +
                "      <td>0</td>\n" +
                "      <td>列表页是否显示模块名</td>\n" +
                "      <td>未指派</td>\n" +
                "    </tr>\n" +
                "  </tbody>\n" +
                "</table>\n");
        List<Map<String, String>> moduleSettingBugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(moduleSettingsHtml);
        assertEquals(0, moduleSettingBugs.size(), "module settings row must not become a bug");

        String dtableHtml = jsonHtml(
                "<div class=\"dtable\" data-module=\"bug\">\n" +
                "  <div class=\"dtable-header\">ID Bug标题 级别 状态 创建者 创建日期 确认 指派给</div>\n" +
                "  <div class=\"dtable-row\" data-id=\"184055\">\n" +
                "    <div class=\"dtable-cell c-id\">184055</div>\n" +
                "    <div class=\"dtable-cell c-title\">测试用--推送需要支持主动切换到对应的页签</div>\n" +
                "    <div class=\"dtable-cell c-pri\">一般</div>\n" +
                "    <div class=\"dtable-cell c-status\">激活</div>\n" +
                "    <div class=\"dtable-cell c-opened\">施健</div>\n" +
                "    <div class=\"dtable-cell c-date\">06-25 11:51</div>\n" +
                "    <div class=\"dtable-cell c-confirmed\">未确认</div>\n" +
                "    <div class=\"dtable-cell c-assigned\">蔡宏亮</div>\n" +
                "  </div>\n" +
                "</div>\n");
        List<Map<String, String>> dtableBugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(dtableHtml);
        assertEquals(1, dtableBugs.size(), "dtable bug count");
        assertEquals("184055", dtableBugs.get(0).get("id"), "dtable bug id");
        assertContains(dtableBugs.get(0).get("title"), "推送需要支持", "dtable bug title");
        assertEquals("active", dtableBugs.get(0).get("status"), "dtable bug status");
        assertEquals("medium", dtableBugs.get(0).get("priority"), "dtable bug priority");

        String zentao18TableHtml = jsonHtml(
                "<table>\n" +
                "  <thead>\n" +
                "    <tr>\n" +
                "      <th><input type=\"checkbox\"></th>\n" +
                "      <th><a href=\"/index.php?m=bug&amp;f=browse&amp;productID=34&amp;branch=all&amp;browseType=unclosed&amp;orderBy=id_asc&amp;recTotal=22&amp;recPerPage=20\">ID</a></th>\n" +
                "      <th><a href=\"/index.php?m=bug&amp;f=browse&amp;productID=34&amp;branch=all&amp;browseType=unclosed&amp;orderBy=title_asc&amp;recTotal=22&amp;recPerPage=20\">Bug标题</a></th>\n" +
                "      <th>级别</th>\n" +
                "      <th>P</th>\n" +
                "      <th>状态</th>\n" +
                "      <th>创建者</th>\n" +
                "      <th>创建日期</th>\n" +
                "      <th>确认</th>\n" +
                "      <th>指派给</th>\n" +
                "      <th>方案</th>\n" +
                "      <th>操作</th>\n" +
                "    </tr>\n" +
                "  </thead>\n" +
                "  <tbody>\n" +
                "    <tr>\n" +
                "      <td><input type=\"checkbox\" name=\"bugIDList[]\" value=\"184055\"></td>\n" +
                "      <td><a href=\"/index.php?m=bug&amp;f=view&amp;bugID=184055\">184055</a></td>\n" +
                "      <td><a href=\"/index.php?m=bug&amp;f=view&amp;bugID=184055\">测试用---推送需要支持主动切换到对应的页签</a></td>\n" +
                "      <td><span title=\"3\">3</span></td>\n" +
                "      <td>一般</td>\n" +
                "      <td>激活</td>\n" +
                "      <td>施健</td>\n" +
                "      <td>06-25 11:51</td>\n" +
                "      <td>未确认</td>\n" +
                "      <td><a href=\"/index.php?m=bug&amp;f=assignTo&amp;bugID=184055&amp;onlybody=yes\">蔡宏亮</a></td>\n" +
                "      <td></td>\n" +
                "      <td>\n" +
                "        <a href=\"/index.php?m=bug&amp;f=confirmBug&amp;bugID=184055&amp;onlybody=yes\">确认</a>\n" +
                "        <a href=\"/index.php?m=bug&amp;f=resolve&amp;bugID=184055&amp;onlybody=yes\">解决</a>\n" +
                "        <a href=\"/index.php?m=bug&amp;f=edit&amp;bugID=184055\">编辑</a>\n" +
                "      </td>\n" +
                "    </tr>\n" +
                "  </tbody>\n" +
                "</table>\n" +
                "<input type=\"hidden\" id=\"recTotal\" value=\"22\">\n" +
                "<input type=\"hidden\" id=\"recPerPage\" value=\"20\">\n" +
                "<input type=\"hidden\" id=\"pageID\" value=\"1\">\n");
        List<Map<String, String>> zentao18Bugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(zentao18TableHtml);
        assertEquals(1, zentao18Bugs.size(), "zentao 18 table bug count");
        assertEquals("184055", zentao18Bugs.get(0).get("id"), "zentao 18 bug id");
        assertContains(zentao18Bugs.get(0).get("title"), "主动切换", "zentao 18 bug title");
        assertEquals("active", zentao18Bugs.get(0).get("status"), "zentao 18 bug status");
        assertEquals("medium", zentao18Bugs.get(0).get("priority"), "zentao 18 bug priority");
        assertEquals("施健", zentao18Bugs.get(0).get("openedBy"), "zentao 18 bug openedBy");
        assertEquals("蔡宏亮", zentao18Bugs.get(0).get("assignedTo"), "zentao 18 bug assignee");
        assertEquals("false", zentao18Bugs.get(0).get("confirmed"), "zentao 18 bug confirmed");

        String activeRowWithCloseActionHtml = jsonHtml(
                "<table><tbody><tr>" +
                "<td><a href=\"/index.php?m=bug&amp;f=view&amp;bugID=184055\">184055</a></td>" +
                "<td>active</td><td>closed</td><td>测试状态解析</td>" +
                "</tr></tbody></table>");
        List<Map<String, String>> activeRowWithCloseActionBugs = ZenTaoBugAssistantToolWindowFactory.parseBugListForTest(activeRowWithCloseActionHtml);
        assertEquals(1, activeRowWithCloseActionBugs.size(), "active row with close action bug count");
        assertEquals("active", activeRowWithCloseActionBugs.get(0).get("status"), "active status should match VS Code before close action text");

        Map<String, Integer> zentao18Pager = ZenTaoBugAssistantToolWindowFactory.parseBugPagerForTest(zentao18TableHtml);
        assertEquals(22, zentao18Pager.get("recTotal"), "zentao 18 pager recTotal");
        assertEquals(20, zentao18Pager.get("recPerPage"), "zentao 18 pager recPerPage");
        assertEquals(1, zentao18Pager.get("pageID"), "zentao 18 pager pageID");
        assertEquals(2, zentao18Pager.get("pageTotal"), "zentao 18 pager pageTotal");

        List<Map<String, String>> bugParams = ZenTaoBugAssistantToolWindowFactory.bugParamsForTest("34");
        if (bugParams.isEmpty()) {
            throw new AssertionError("bug params should not be empty");
        }
        assertEquals("34", bugParams.get(0).get("productID"), "first bug param should match VS Code productID scope");
        assertEquals("unclosed", bugParams.get(0).get("browseType"), "first bug param browseType");
        boolean hasLowerUnresolved = bugParams.stream().anyMatch(params ->
                "34".equals(params.get("productid")) && "unresolved".equals(params.get("browseType")));
        if (!hasLowerUnresolved) {
            throw new AssertionError("bug params should include VS Code lowercase productid unresolved candidate");
        }

        String prompt = ZenTaoBugAssistantToolWindowFactory.buildPromptForTest();
        assertContains(prompt, "禅道缺陷单", "prompt metadata section");
        assertContains(prompt, "当前指派：王强强", "prompt assignee");
        assertContains(prompt, "创建者：石挺现", "prompt opener");
        assertContains(prompt, "期望结果：\n技能表现和发炮状态一致。", "prompt expected result");
        assertContains(prompt, "实际结果：\n没有用激光但是在发炮。", "prompt actual result");
        assertContains(prompt, "附件/视频线索", "prompt attachments");
        assertContains(prompt, "video repro.mp4：http://zentao.example/file.mp4", "prompt video attachment");
        assertContains(prompt, "保留当前工作区已有未提交改动", "prompt dirty worktree rule");

        System.out.println("ZenTao parser regression tests passed.");
    }

    private static String jsonHtml(String html) {
        return "{\"result\":\"success\",\"data\":\"" + escapeJson(html) + "\"}";
    }

    private static String escapeJson(String value) {
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }

    private static void assertContains(String value, String expected, String label) {
        if (value == null || !value.contains(expected)) {
            throw new AssertionError(label + ": expected to contain <" + expected + "> but was <" + value + ">");
        }
    }

    private static void assertEquals(Object expected, Object actual, String label) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(label + ": expected <" + expected + "> but was <" + actual + ">");
        }
    }
}
