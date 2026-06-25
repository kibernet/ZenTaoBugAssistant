import assert from "assert/strict";
import { __zentaoParserTestInternals } from "../src/core/zentaoClient";

const { normalizeZenTaoHtml, parseBugList, parseBugListPager } = __zentaoParserTestInternals;

const bugTableHtml = `
<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>Bug标题</th>
      <th>级别</th>
      <th>状态</th>
      <th>创建者</th>
      <th>创建日期</th>
      <th>确认</th>
      <th>指派给</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>183099</td>
      <td><a href="/index.php?m=bug&amp;f=view&amp;bugID=183099">8.1.0---渔场激光技能---触发斩杀的时候索敌时间结束了，没有用激光但是在发炮</a></td>
      <td>一般</td>
      <td>激活</td>
      <td>石挺现</td>
      <td>06-02 10:55</td>
      <td>已确认</td>
      <td><a href="/index.php?m=user&amp;f=view&amp;account=wangqiangqiang">王强强</a></td>
    </tr>
  </tbody>
</table>
<input type="hidden" id="recTotal" value="1">
<input type="hidden" id="recPerPage" value="20">
<input type="hidden" id="pageID" value="1">
`;

const wrappedTableHtml = JSON.stringify({ result: "success", data: bugTableHtml });
const normalized = normalizeZenTaoHtml(wrappedTableHtml);
assert.match(normalized, /183099/);

const tableBugs = parseBugList(wrappedTableHtml);
assert.equal(tableBugs.length, 1);
assert.equal(tableBugs[0].id, "183099");
assert.match(tableBugs[0].title, /渔场激光技能/);
assert.equal(tableBugs[0].priority, "medium");
assert.equal(tableBugs[0].status, "active");
assert.equal(tableBugs[0].assignedTo, "王强强");
assert.equal(tableBugs[0].confirmed, true);

const pager = parseBugListPager(wrappedTableHtml);
assert.equal(pager?.recTotal, 1);
assert.equal(pager?.recPerPage, 20);
assert.equal(pager?.pageID, 1);
assert.equal(pager?.pageTotal, 1);

const linkOnlyHtml = JSON.stringify({
  result: "success",
  data: `
    <div class="bug-list">
      <a href="/index.php?m=bug&amp;f=view&amp;bugID=183099">8.1.0---渔场激光技能---触发斩杀的时候索敌时间结束了</a>
      <span>一般</span><span>激活</span><span>指派给 王强强</span><span>06-02 10:55</span>
    </div>`
});

const linkBugs = parseBugList(linkOnlyHtml);
assert.equal(linkBugs.length, 1);
assert.equal(linkBugs[0].id, "183099");
assert.match(linkBugs[0].title, /渔场激光技能/);
assert.equal(linkBugs[0].assignedTo, "王强强");

const rewrittenTableHtml = JSON.stringify({
  result: "success",
  data: `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox"></th>
          <th>ID</th>
          <th>Bug标题</th>
          <th>级别</th>
          <th>状态</th>
          <th>指派给</th>
        </tr>
      </thead>
      <tbody>
        <tr data-id="183099">
          <td><input type="checkbox" name="bugIDList[]" value="183099"></td>
          <td><a href="/bug-view-183099.html">183099</a></td>
          <td><a href="/bug-view-183099.html">8.1.0---渔场激光技能触发新杀的时候索敌时间结束了</a></td>
          <td>一般</td>
          <td>激活</td>
          <td><a href="/index.php?m=user&f=view&account=wangqiangqiang">王强强</a></td>
        </tr>
      </tbody>
      <input type="hidden" name="recTotal" value="1">
    </table>`
});
const rewrittenBugs = parseBugList(rewrittenTableHtml);
assert.equal(rewrittenBugs.length, 1);
assert.equal(rewrittenBugs[0].id, "183099");
assert.match(rewrittenBugs[0].title, /渔场激光技能/);
assert.equal(rewrittenBugs[0].status, "active");
assert.equal(rewrittenBugs[0].assignedTo, "王强强");

const moduleSettingsHtml = JSON.stringify({
  result: "success",
  data: `
    <table>
      <tbody>
        <tr data-id="0">
          <td><input type="checkbox" value="0"></td>
          <td>0</td>
          <td>列表页是否显示模块名</td>
          <td>未指派</td>
        </tr>
      </tbody>
    </table>`
});
const moduleSettingBugs = parseBugList(moduleSettingsHtml);
assert.equal(moduleSettingBugs.length, 0);

const dtableHtml = JSON.stringify({
  result: "success",
  data: `
    <div class="dtable" data-module="bug">
      <div class="dtable-header">ID Bug标题 级别 状态 创建者 创建日期 确认 指派给</div>
      <div class="dtable-row" data-id="184055">
        <div class="dtable-cell c-id">184055</div>
        <div class="dtable-cell c-title">测试用--推送需要支持主动切换到对应的页签</div>
        <div class="dtable-cell c-pri">一般</div>
        <div class="dtable-cell c-status">激活</div>
        <div class="dtable-cell c-opened">施健</div>
        <div class="dtable-cell c-date">06-25 11:51</div>
        <div class="dtable-cell c-confirmed">未确认</div>
        <div class="dtable-cell c-assigned">蔡宏亮</div>
      </div>
    </div>`
});
const dtableBugs = parseBugList(dtableHtml);
assert.equal(dtableBugs.length, 1);
assert.equal(dtableBugs[0].id, "184055");
assert.match(dtableBugs[0].title, /推送需要支持/);
assert.equal(dtableBugs[0].status, "active");
assert.equal(dtableBugs[0].priority, "medium");

const zentao18TableHtml = JSON.stringify({
  result: "success",
  data: `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox"></th>
          <th><a href="/index.php?m=bug&amp;f=browse&amp;productID=34&amp;branch=all&amp;browseType=unclosed&amp;orderBy=id_asc&amp;recTotal=22&amp;recPerPage=20">ID</a></th>
          <th><a href="/index.php?m=bug&amp;f=browse&amp;productID=34&amp;branch=all&amp;browseType=unclosed&amp;orderBy=title_asc&amp;recTotal=22&amp;recPerPage=20">Bug标题</a></th>
          <th>级别</th>
          <th>P</th>
          <th>状态</th>
          <th>创建者</th>
          <th>创建日期</th>
          <th>确认</th>
          <th>指派给</th>
          <th>方案</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><input type="checkbox" name="bugIDList[]" value="184055"></td>
          <td><a href="/index.php?m=bug&amp;f=view&amp;bugID=184055">184055</a></td>
          <td><a href="/index.php?m=bug&amp;f=view&amp;bugID=184055">测试用---推送需要支持主动切换到对应的页签</a></td>
          <td><span title="3">3</span></td>
          <td>一般</td>
          <td>激活</td>
          <td>施健</td>
          <td>06-25 11:51</td>
          <td>未确认</td>
          <td><a href="/index.php?m=bug&amp;f=assignTo&amp;bugID=184055&amp;onlybody=yes">蔡宏亮</a></td>
          <td></td>
          <td>
            <a href="/index.php?m=bug&amp;f=confirmBug&amp;bugID=184055&amp;onlybody=yes">确认</a>
            <a href="/index.php?m=bug&amp;f=resolve&amp;bugID=184055&amp;onlybody=yes">解决</a>
            <a href="/index.php?m=bug&amp;f=edit&amp;bugID=184055">编辑</a>
          </td>
        </tr>
      </tbody>
    </table>
    <input type="hidden" id="recTotal" value="22">
    <input type="hidden" id="recPerPage" value="20">
    <input type="hidden" id="pageID" value="1">`
});
const zentao18Bugs = parseBugList(zentao18TableHtml);
assert.equal(zentao18Bugs.length, 1);
assert.equal(zentao18Bugs[0].id, "184055");
assert.match(zentao18Bugs[0].title, /主动切换/);
assert.equal(zentao18Bugs[0].status, "active");
assert.equal(zentao18Bugs[0].priority, "medium");
assert.equal(zentao18Bugs[0].openedBy, "施健");
assert.equal(zentao18Bugs[0].assignedTo, "蔡宏亮");
assert.equal(zentao18Bugs[0].confirmed, false);

console.log("ZenTao parser regression tests passed.");
