package com.zentao.bugassistant;

import com.intellij.ide.DataManager;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionPlaces;
import com.intellij.openapi.actionSystem.ActionUiKind;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.ComboBox;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBPasswordField;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.components.JBTextField;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.util.ui.JBUI;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Image;
import java.awt.datatransfer.StringSelection;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Collator;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JEditorPane;
import javax.swing.ImageIcon;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingWorker;
import javax.swing.border.LineBorder;
import org.jetbrains.annotations.NotNull;

public class ZenTaoBugAssistantToolWindowFactory implements ToolWindowFactory {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        ZenTaoBugAssistantPanel panel = new ZenTaoBugAssistantPanel(project);
        Content content = ContentFactory.getInstance().createContent(panel.root, "", false);
        toolWindow.getContentManager().addContent(content);
    }

    private static final class ZenTaoBugAssistantPanel {
        private static final String DEFAULT_SERVER = "http://zentao.yuwan-game.com:8088/";
        private static final int PAGE_SIZE = 20;
        private static final List<String> FILTER_KEYS = List.of("assignedToMe", "unresolved", "resolved", "closed");
        private static final List<String> CLAUDE_ACTION_IDS = List.of("ClaudeCode.Open", "ClaudeCode.Chat", "claude-code.open", "claudeCode.open", "claude-code.chat", "claudeCode.chat");

        private final Project project;
        private final JPanel root = new JPanel(new BorderLayout(8, 8));
        private final JBTextField serverField = new JBTextField(DEFAULT_SERVER);
        private final JBTextField accountField = new JBTextField();
        private final JBPasswordField passwordField = new JBPasswordField();
        private final JCheckBox rememberPasswordBox = new JCheckBox("记住密码");
        private final JCheckBox autoLoginBox = new JCheckBox("自动登录", true);
        private final JButton loginButton = new JButton("登录");
        private final JLabel loginState = new JLabel("未登录");
        private final ComboBox<Item> projectBox = new ComboBox<>();
        private final ComboBox<Item> memberBox = new ComboBox<>();
        private final JPanel memberWrap = new JPanel(new BorderLayout(6, 0));
        private final JCheckBox allFilterBox = new JCheckBox("全部", true);
        private final Map<String, JCheckBox> filterChecks = new LinkedHashMap<>();
        private final JLabel bugCountLabel = new JLabel("共 0 个 Bug");
        private final JButton refreshButton = new JButton("刷新");
        private final JButton aiFixAllButton = new JButton("AI一键修复");
        private final ComboBox<String> aiEngineBox = new ComboBox<>(new String[] {"Claude Code"});
        private final JPanel bugListPanel = new JPanel();
        private final JLabel pageLabel = new JLabel("0/0");
        private final JButton firstPageButton = new JButton("|<");
        private final JButton prevPageButton = new JButton("<");
        private final JButton nextPageButton = new JButton(">");
        private final JButton lastPageButton = new JButton(">|");
        private final JTextArea statusArea = new JTextArea("状态：就绪");
        private final ZenTaoClient client = new ZenTaoClient();
        private final List<BugSummary> bugs = new ArrayList<>();
        private final List<Item> projects = new ArrayList<>();
        private final List<Item> members = new ArrayList<>();
        private String preferredProjectId = "";
        private String preferredMemberAccount = "";
        private int currentPage = 1;
        private PreviewDialog previewDialog;
        private boolean hydratingProjects = false;
        private boolean hydratingMembers = false;
        private boolean hydratingFilters = false;

        private ZenTaoBugAssistantPanel(Project project) {
            this.project = project;
            root.setBorder(JBUI.Borders.empty(10));
            root.add(buildTopPanel(), BorderLayout.NORTH);
            root.add(buildCenterPanel(), BorderLayout.CENTER);
            statusArea.setEditable(false);
            statusArea.setLineWrap(true);
            statusArea.setRows(2);
            root.add(statusArea, BorderLayout.SOUTH);
            restorePreferences();
            bindEvents();
            if (autoLoginBox.isSelected() && !accountField.getText().isBlank() && passwordField.getPassword().length > 0) {
                loginAndRefresh();
            }
        }

        private JPanel buildTopPanel() {
            JPanel top = new JPanel(new GridBagLayout());
            GridBagConstraints c = new GridBagConstraints();
            c.fill = GridBagConstraints.HORIZONTAL;
            c.insets = JBUI.insets(2);
            c.weightx = 1;
            c.gridx = 0;
            c.gridy = 0;
            c.gridwidth = 2;
            top.add(buildHeaderLogo(), c);
            c.gridwidth = 1;
            addRow(top, c, 1, "禅道地址", serverField);
            addRow(top, c, 2, "禅道账号", accountField);
            addRow(top, c, 3, "禅道密码", passwordField);
            JPanel loginRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 0));
            loginRow.add(autoLoginBox);
            loginRow.add(rememberPasswordBox);
            loginRow.add(loginButton);
            loginRow.add(loginState);
            c.gridx = 1;
            c.gridy = 4;
            top.add(loginRow, c);

            JPanel projectRow = new JPanel(new BorderLayout(6, 0));
            JButton refreshProjects = new JButton("刷新");
            refreshProjects.addActionListener(event -> loadProjects(true));
            projectRow.add(projectBox, BorderLayout.CENTER);
            projectRow.add(refreshProjects, BorderLayout.EAST);
            addRow(top, c, 5, "项目", projectRow);

            memberBox.setEditable(true);
            memberWrap.add(memberBox, BorderLayout.CENTER);
            JButton refreshMembers = new JButton("刷新");
            refreshMembers.addActionListener(event -> loadMembers(true));
            memberWrap.add(refreshMembers, BorderLayout.EAST);
            addRow(top, c, 6, "成员", memberWrap);

            JPanel filters = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            allFilterBox.addActionListener(event -> {
                if (hydratingFilters) return;
                hydratingFilters = true;
                filterChecks.values().forEach(box -> box.setSelected(allFilterBox.isSelected()));
                hydratingFilters = false;
                savePreferences();
                currentPage = 1;
                renderBugs();
            });
            filters.add(allFilterBox);
            addFilter(filters, "assignedToMe", "我的");
            addFilter(filters, "unresolved", "未解决");
            addFilter(filters, "resolved", "已解决");
            addFilter(filters, "closed", "已关闭");
            addRow(top, c, 7, "分类", filters);
            return top;
        }

        private JComponent buildHeaderLogo() {
            java.net.URL logo = ZenTaoBugAssistantToolWindowFactory.class.getResource("/META-INF/header-logo.png");
            if (logo == null) {
                return new JPanel();
            }
            JPanel panel = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
            ImageIcon icon = new ImageIcon(logo);
            Image scaled = icon.getImage().getScaledInstance(Math.max(1, icon.getIconWidth() / 2), Math.max(1, icon.getIconHeight() / 2), Image.SCALE_SMOOTH);
            panel.add(new JLabel(new ImageIcon(scaled)));
            return panel;
        }

        private JPanel buildCenterPanel() {
            JPanel center = new JPanel(new BorderLayout(8, 8));
            JPanel bar = new JPanel(new BorderLayout(8, 0));
            JPanel actions = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
            actions.add(refreshButton);
            actions.add(aiFixAllButton);
            aiEngineBox.setEnabled(false);
            actions.add(aiEngineBox);
            bar.add(bugCountLabel, BorderLayout.WEST);
            bar.add(actions, BorderLayout.EAST);
            center.add(bar, BorderLayout.NORTH);
            bugListPanel.setLayout(new javax.swing.BoxLayout(bugListPanel, javax.swing.BoxLayout.Y_AXIS));
            center.add(new JBScrollPane(bugListPanel), BorderLayout.CENTER);
            JPanel pager = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
            pager.add(new JLabel("每页 20 项"));
            pager.add(firstPageButton);
            pager.add(prevPageButton);
            pager.add(pageLabel);
            pager.add(nextPageButton);
            pager.add(lastPageButton);
            center.add(pager, BorderLayout.SOUTH);
            return center;
        }

        private void addRow(JPanel panel, GridBagConstraints c, int y, String label, JComponent component) {
            c.gridy = y;
            c.gridx = 0;
            c.weightx = 0;
            panel.add(new JLabel(label), c);
            c.gridx = 1;
            c.weightx = 1;
            panel.add(component, c);
        }

        private void addFilter(JPanel filters, String key, String text) {
            JCheckBox box = new JCheckBox(text, true);
            box.addActionListener(event -> {
                if (hydratingFilters) return;
                refreshAllFilterState();
                savePreferences();
                currentPage = 1;
                renderBugs();
            });
            filterChecks.put(key, box);
            filters.add(box);
        }

        private void bindEvents() {
            loginButton.addActionListener(event -> loginAndRefresh());
            refreshButton.addActionListener(event -> refreshBugs());
            aiFixAllButton.addActionListener(event -> aiFixAll());
            projectBox.addActionListener(event -> {
                if (hydratingProjects) return;
                preferredMemberAccount = "";
                if (memberBox.getItemCount() > 0) memberBox.setSelectedIndex(0);
                savePreferences();
                refreshBugs();
            });
            memberBox.addActionListener(event -> {
                if (hydratingMembers) return;
                savePreferences();
                currentPage = 1;
                renderBugs();
            });
            firstPageButton.addActionListener(event -> {
                currentPage = 1;
                renderBugs();
            });
            prevPageButton.addActionListener(event -> {
                currentPage = Math.max(1, currentPage - 1);
                renderBugs();
            });
            nextPageButton.addActionListener(event -> {
                currentPage++;
                renderBugs();
            });
            lastPageButton.addActionListener(event -> {
                currentPage = Integer.MAX_VALUE;
                renderBugs();
            });
        }

        private void loginAndRefresh() {
            savePreferences();
            runAsync("正在登录禅道...", () -> {
                client.login(serverField.getText(), accountField.getText(), new String(passwordField.getPassword()));
                return "已登录：" + accountField.getText();
            }, message -> {
                loginState.setText(message);
                loginButton.setText("重新登录");
                loadProjectsAfterLogin(false);
            });
        }

        private void loadProjectsAfterLogin(boolean force) {
            loadProjects(force, () -> loadMembers(false, () ->
                    statusArea.setText("状态：登录成功，项目 " + projects.size() + " 个，成员 " + members.size() + " 个。请选择项目拉取 Bug。")
            ));
        }

        private void loadProjects(boolean force) {
            loadProjects(force, null);
        }

        private void loadProjects(boolean force, Runnable afterLoaded) {
            if (!force && !projects.isEmpty()) {
                statusArea.setText("状态：项目列表已缓存：" + projects.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
                return;
            }
            runAsync("正在获取项目列表...", client::listProjects, items -> {
                projects.clear();
                projects.addAll(items);
                populateProjectBox();
                savePreferences();
                statusArea.setText(items.isEmpty() ? "状态：项目列表为空，请检查禅道权限或项目入口。" : "状态：项目列表已加载：" + items.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
            });
        }

        private void loadMembers(boolean force) {
            loadMembers(force, null);
        }

        private void loadMembers(boolean force, Runnable afterLoaded) {
            if (!force && !members.isEmpty()) {
                statusArea.setText("状态：成员列表已缓存：" + members.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
                return;
            }
            runAsync("正在获取成员列表...", () -> client.listMembers(selectedProjectId()), items -> {
                members.clear();
                members.addAll(items);
                populateMemberBox();
                savePreferences();
                renderBugs();
                statusArea.setText(items.isEmpty() ? "状态：成员列表为空，请先选择项目或检查禅道权限。" : "状态：成员列表已加载：" + items.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
            });
        }

        private void refreshBugs() {
            if (!client.loggedIn()) return;
            runAsync("正在获取 Bug 列表...", () -> client.listBugs(selectedProjectId(), "all", "", accountField.getText()), result -> {
                bugs.clear();
                bugs.addAll(result);
                currentPage = 1;
                renderBugs();
                loadMembers(false);
            });
        }

        private String selectedProjectId() {
            Object item = projectBox.getSelectedItem();
            return item instanceof Item ? ((Item)item).id : "";
        }

        private String selectedMemberAccount() {
            Object item = memberBox.getSelectedItem();
            if (item instanceof Item) {
                return ((Item)item).id;
            }
            String text = item == null ? "" : item.toString().trim();
            return text.contains("|") ? text.substring(text.lastIndexOf('|') + 1).trim() : text;
        }

        private String scopeKey() {
            return "member";
        }

        private void selectItem(ComboBox<Item> box, String id) {
            if (id == null || id.isBlank()) return;
            for (int i = 0; i < box.getItemCount(); i++) {
                Item item = box.getItemAt(i);
                if (item != null && item.id.equals(id)) {
                    box.setSelectedIndex(i);
                    return;
                }
            }
        }

        private void savePreferences() {
            PropertiesComponent properties = PropertiesComponent.getInstance(project);
            properties.setValue("zentao.idea.serverUrl", serverField.getText(), DEFAULT_SERVER);
            properties.setValue("zentao.idea.account", accountField.getText(), "");
            properties.setValue("zentao.idea.autoLogin", autoLoginBox.isSelected(), true);
            properties.setValue("zentao.idea.rememberPassword", rememberPasswordBox.isSelected(), false);
            properties.setValue("zentao.idea.password", rememberPasswordBox.isSelected() ? new String(passwordField.getPassword()) : "", "");
            properties.setValue("zentao.idea.projectId", selectedProjectId(), "");
            properties.setValue("zentao.idea.memberAccount", selectedMemberAccount(), "");
            properties.setValue("zentao.idea.projects", encodeItems(projects), "");
            properties.setValue("zentao.idea.members", encodeItems(members), "");
            properties.setValue("zentao.idea.filters", String.join(",", selectedFilterKeys()), String.join(",", FILTER_KEYS));
        }

        private void restorePreferences() {
            PropertiesComponent properties = PropertiesComponent.getInstance(project);
            serverField.setText(properties.getValue("zentao.idea.serverUrl", DEFAULT_SERVER));
            accountField.setText(properties.getValue("zentao.idea.account", ""));
            rememberPasswordBox.setSelected(properties.getBoolean("zentao.idea.rememberPassword", false));
            autoLoginBox.setSelected(properties.getBoolean("zentao.idea.autoLogin", true));
            passwordField.setText(properties.getValue("zentao.idea.password", ""));
            preferredProjectId = properties.getValue("zentao.idea.projectId", "");
            preferredMemberAccount = "";
            projects.clear();
            projects.addAll(decodeItems(properties.getValue("zentao.idea.projects", "")));
            members.clear();
            members.addAll(decodeItems(properties.getValue("zentao.idea.members", "")));
            populateProjectBox();
            populateMemberBox();
            Set<String> filters = new LinkedHashSet<>(List.of(properties.getValue("zentao.idea.filters", String.join(",", FILTER_KEYS)).split(",")));
            filterChecks.forEach((key, box) -> box.setSelected(filters.contains(key)));
            refreshAllFilterState();
        }

        private void populateProjectBox() {
            hydratingProjects = true;
            projectBox.removeAllItems();
            projectBox.addItem(new Item("", "全部项目"));
            for (Item item : projects) projectBox.addItem(item);
            selectItem(projectBox, preferredProjectId);
            hydratingProjects = false;
        }

        private void populateMemberBox() {
            hydratingMembers = true;
            memberBox.removeAllItems();
            memberBox.addItem(new Item("", "全部成员"));
            for (Item item : members) memberBox.addItem(item);
            selectItem(memberBox, preferredMemberAccount);
            hydratingMembers = false;
        }

        private static String encodeItems(List<Item> values) {
            return values.stream()
                    .map(item -> item.id.replace("\t", " ").replace("\n", " ") + "\t" + item.name.replace("\t", " ").replace("\n", " "))
                    .reduce((a, b) -> a + "\n" + b)
                    .orElse("");
        }

        private static List<Item> decodeItems(String value) {
            if (value == null || value.isBlank()) return List.of();
            List<Item> result = new ArrayList<>();
            for (String line : value.split("\n")) {
                String[] parts = line.split("\t", 2);
                if (parts.length == 2 && !parts[0].isBlank() && !parts[1].isBlank()) {
                    result.add(new Item(parts[0], parts[1]));
                }
            }
            return result;
        }

        private List<String> selectedFilterKeys() {
            List<String> keys = new ArrayList<>();
            filterChecks.forEach((key, box) -> {
                if (box.isSelected()) keys.add(key);
            });
            return keys;
        }

        private void refreshAllFilterState() {
            hydratingFilters = true;
            boolean allSelected = filterChecks.values().stream().filter(JCheckBox::isEnabled).allMatch(JCheckBox::isSelected);
            allFilterBox.setSelected(allSelected);
            hydratingFilters = false;
        }

        private void renderBugs() {
            updateMineFilterAvailability();
            List<BugSummary> filtered = filteredBugs();
            int totalPages = Math.max(1, (int)Math.ceil(filtered.size() / (double)PAGE_SIZE));
            currentPage = Math.min(Math.max(1, currentPage), totalPages);
            int start = Math.min(filtered.size(), (currentPage - 1) * PAGE_SIZE);
            int end = Math.min(filtered.size(), start + PAGE_SIZE);
            bugListPanel.removeAll();
            for (BugSummary bug : filtered.subList(start, end)) bugListPanel.add(new BugCard(bug));
            bugCountLabel.setText("共 " + filtered.size() + " 个 Bug / 总 " + bugs.size() + " 个");
            pageLabel.setText(currentPage + "/" + totalPages);
            aiFixAllButton.setText("AI一键修复 " + unresolved(filtered).size());
            aiFixAllButton.setEnabled(!unresolved(filtered).isEmpty());
            bugListPanel.revalidate();
            bugListPanel.repaint();
        }

        private List<BugSummary> filteredBugs() {
            List<BugSummary> scopedBugs = filterBugsBySelectedMember();
            Set<String> active = new LinkedHashSet<>();
            filterChecks.forEach((key, box) -> {
                if (box.isSelected()) active.add(key);
            });
            if (active.isEmpty() || active.containsAll(FILTER_KEYS)) return scopedBugs;
            List<BugSummary> result = new ArrayList<>();
            for (BugSummary bug : scopedBugs) {
                if ((active.contains("assignedToMe") && containsIgnoreCase(bug.assignedTo, accountField.getText()))
                        || (active.contains("unresolved") && !bug.status.equals("resolved") && !bug.status.equals("closed"))
                        || (active.contains("resolved") && bug.status.equals("resolved"))
                        || (active.contains("closed") && bug.status.equals("closed"))) {
                    result.add(bug);
                }
            }
            return result;
        }

        private List<BugSummary> filterBugsBySelectedMember() {
            if (selectedMemberAccount().isBlank()) {
                return new ArrayList<>(bugs);
            }
            Set<String> candidates = new LinkedHashSet<>(personAliases(selectedMemberAccount()));
            members.stream()
                    .filter(member -> member.id.equals(selectedMemberAccount()))
                    .findFirst()
                    .ifPresent(member -> {
                        candidates.addAll(personAliases(member.id));
                        candidates.addAll(personAliases(member.name));
                    });
            List<BugSummary> result = new ArrayList<>();
            for (BugSummary bug : bugs) {
                Set<String> assignedToValues = new LinkedHashSet<>(personAliases(bug.assignedTo));
                if (candidates.stream().anyMatch(candidate -> assignedToValues.stream().anyMatch(assignedTo -> assignedTo.equals(candidate) || assignedTo.contains(candidate) || candidate.contains(assignedTo)))) {
                    result.add(bug);
                }
            }
            return result;
        }

        private void updateMineFilterAvailability() {
            JCheckBox mine = filterChecks.get("assignedToMe");
            if (mine == null) return;
            boolean disabled = isMineFilterDisabled();
            if (disabled) {
                mine.setSelected(false);
            }
            mine.setEnabled(!disabled);
            refreshAllFilterState();
        }

        private boolean isMineFilterDisabled() {
            String selectedAccount = selectedMemberAccount();
            if (selectedAccount.isBlank()) return false;
            Set<String> accountValues = new LinkedHashSet<>(personAliases(accountField.getText()));
            Set<String> candidates = new LinkedHashSet<>(personAliases(selectedAccount));
            members.stream()
                    .filter(member -> member.id.equals(selectedAccount))
                    .findFirst()
                    .ifPresent(member -> {
                        candidates.addAll(personAliases(member.id));
                        candidates.addAll(personAliases(member.name));
                    });
            return candidates.stream().noneMatch(accountValues::contains);
        }

        private static List<String> personAliases(String value) {
            String text = value == null ? "" : value.trim();
            if (text.isBlank()) return List.of();
            Set<String> aliases = new LinkedHashSet<>();
            aliases.add(text);
            for (String part : text.split("[|/／,，;；]")) {
                if (!part.trim().isBlank()) aliases.add(part.trim());
            }
            String beforeParen = text.replaceAll("\\s*[（(].*?[）)]\\s*", "").trim();
            if (!beforeParen.isBlank()) aliases.add(beforeParen);
            Matcher matcher = Pattern.compile("[（(]([^）)]+)[）)]").matcher(text);
            while (matcher.find()) {
                if (!matcher.group(1).trim().isBlank()) aliases.add(matcher.group(1).trim());
            }
            return aliases.stream().map(item -> item.toLowerCase(Locale.ROOT)).filter(item -> !item.isBlank()).toList();
        }

        private void aiFixAll() {
            List<BugSummary> targets = unresolved(filteredBugs());
            if (targets.isEmpty()) return;
            runAsync("正在构建 " + targets.size() + " 个 Bug 的批量修复提示词...", () -> {
                List<BugDetail> details = new ArrayList<>();
                for (BugSummary bug : targets) {
                    details.add(client.getBugDetail(bug.id));
                }
                return details;
            }, details -> {
                String prompt = details.size() == 1 ? PromptBuilder.build(details.get(0)) : PromptBuilder.buildBatch(details);
                sendToClaudeCode(prompt);
                statusArea.setText("状态：" + details.size() + " 个 Bug 已合并发送给 Claude Code with GUI");
            });
        }

        private void aiFix(String bugId) {
            runAsync("正在构建 Bug #" + bugId + " 修复提示词...", () -> client.getBugDetail(bugId), detail -> {
                sendToClaudeCode(PromptBuilder.build(detail));
                statusArea.setText("状态：Bug #" + bugId + " 已发送给 Claude Code with GUI");
            });
        }

        private void preview(String bugId) {
            runAsync("正在加载 Bug #" + bugId + " 预览...", () -> client.getBugDetail(bugId), detail -> {
                if (previewDialog == null) previewDialog = new PreviewDialog();
                previewDialog.show(detail);
            });
        }

        private void submitWorkflow(String bugId, String action) {
            String title = switch (action) {
                case "assign" -> "指派";
                case "confirm" -> "确认";
                case "resolve" -> "解决";
                case "activate" -> "激活";
                default -> action;
            };
            String assignee = "";
            if (action.equals("assign")) {
                assignee = Messages.showInputDialog(project, "请输入要指派给的禅道账号：", "禅道助手 - 指派", null);
                if (assignee == null || assignee.isBlank()) return;
            }
            String defaultComment = action.equals("resolve") ? "已修复，请验证。" : action.equals("activate") ? "重新激活，请继续处理。" : "";
            String comment = Messages.showInputDialog(project, title + " Bug #" + bugId + "，可填写备注：", "禅道助手 - " + title, null, defaultComment, null);
            if (comment == null) return;
            String finalAssignee = assignee;
            runAsync("正在" + title + " Bug #" + bugId + "...", () -> {
                client.submitWorkflow(bugId, action, finalAssignee, comment);
                return true;
            }, ignored -> {
                statusArea.setText("状态：Bug #" + bugId + " 已提交" + title);
                refreshBugs();
            });
        }

        private void sendToClaudeCode(String prompt) {
            CopyPasteManager.getInstance().setContents(new StringSelection(prompt));
            ActionManager manager = ActionManager.getInstance();
            for (String actionId : CLAUDE_ACTION_IDS) {
                AnAction action = manager.getAction(actionId);
                if (action != null) {
                    AnActionEvent event = AnActionEvent.createEvent(
                            action,
                            DataManager.getInstance().getDataContext(root),
                            null,
                            ActionPlaces.UNKNOWN,
                            ActionUiKind.NONE,
                            null
                    );
                    action.actionPerformed(event);
                    return;
                }
            }
            Messages.showInfoMessage(project, "修复提示词已复制到剪贴板，请粘贴到 Claude Code with GUI。", "禅道助手");
        }

        private <T> void runAsync(String status, ThrowingSupplier<T> supplier, java.util.function.Consumer<T> onSuccess) {
            statusArea.setText("状态：" + status);
            new SwingWorker<T, Void>() {
                @Override
                protected T doInBackground() throws Exception {
                    return supplier.get();
                }

                @Override
                protected void done() {
                    try {
                        onSuccess.accept(get());
                    } catch (Exception error) {
                        statusArea.setText("失败：" + error.getMessage());
                        Messages.showErrorDialog(project, error.getMessage(), "禅道助手");
                    }
                }
            }.execute();
        }

        private final class BugCard extends JPanel {
            private BugCard(BugSummary bug) {
                super(new BorderLayout(6, 6));
                setBorder(new LineBorder(statusColor(bug.status), 1, true));
                setBackground(statusBackground(bug.status));
                setOpaque(true);
                JPanel title = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
                title.setOpaque(false);
                title.add(new JLabel("#" + bug.id));
                JLabel status = new JLabel(statusText(bug.status));
                status.setForeground(statusColor(bug.status));
                title.add(status);
                title.add(new JLabel("指派给：" + assigneeText(bug.assignedTo)));
                if (!bug.priority.equals("unknown")) title.add(new JLabel(priorityText(bug.priority)));
                add(title, BorderLayout.NORTH);
                add(new JLabel("<html>" + html(bug.title) + "</html>"), BorderLayout.CENTER);
                JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
                buttons.setOpaque(false);
                JButton preview = new JButton("预览");
                preview.addActionListener(event -> preview(bug.id));
                buttons.add(preview);
                if (!bug.status.equals("resolved") && !bug.status.equals("closed")) {
                    JButton assign = new JButton("指派");
                    assign.addActionListener(event -> submitWorkflow(bug.id, "assign"));
                    buttons.add(assign);
                    JButton confirm = new JButton("确认");
                    confirm.addActionListener(event -> submitWorkflow(bug.id, "confirm"));
                    buttons.add(confirm);
                    JButton resolve = new JButton("解决");
                    resolve.addActionListener(event -> submitWorkflow(bug.id, "resolve"));
                    buttons.add(resolve);
                    JButton aiFix = new JButton("AI修复");
                    aiFix.addActionListener(event -> aiFix(bug.id));
                    buttons.add(aiFix);
                } else {
                    JButton activate = new JButton("激活");
                    activate.addActionListener(event -> submitWorkflow(bug.id, "activate"));
                    buttons.add(activate);
                }
                add(buttons, BorderLayout.SOUTH);
                addMouseListener(new java.awt.event.MouseAdapter() {
                    @Override
                    public void mouseClicked(java.awt.event.MouseEvent event) {
                        if (event.getClickCount() == 2) preview(bug.id);
                    }
                });
            }
        }

        private final class PreviewDialog {
            private final JEditorPane pane = new JEditorPane("text/html", "");
            private final DialogWrapper dialog = new DialogWrapper(project) {
                {
                    init();
                    setTitle("Bug 预览");
                }

                @Override
                protected JComponent createCenterPanel() {
                    pane.setEditable(false);
                    return new JScrollPane(pane);
                }
            };

            private void show(BugDetail detail) {
                String previewTitle = detail.description == null || detail.description.isBlank() ? detail.title : detail.description;
                pane.setText("<html><body style='font-family:sans-serif'><h2>#" + html(detail.id) + " " + html(previewTitle) + "</h2>" + section("重现步骤", detail.reproduceStepsHtml, detail.reproduceSteps) + section("期望", detail.expectedResultHtml, detail.expectedResult) + "</body></html>");
                dialog.setTitle("Bug #" + detail.id);
                dialog.show();
            }
        }

        private static String section(String title, String htmlValue, String textValue) {
            String body = htmlValue == null || htmlValue.isBlank() ? html(textValue == null || textValue.isBlank() ? "未提供" : textValue) : htmlValue;
            return "<h3>" + html(title) + "</h3><div>" + body + "</div>";
        }

        private static boolean containsIgnoreCase(String value, String needle) {
            return value != null && needle != null && value.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
        }

        private static List<BugSummary> unresolved(List<BugSummary> values) {
            return values.stream().filter(bug -> !bug.status.equals("resolved") && !bug.status.equals("closed")).toList();
        }

        private static Color statusColor(String status) {
            return switch (status) {
                case "resolved" -> new Color(31, 122, 58);
                case "closed" -> Color.GRAY;
                case "active" -> new Color(180, 35, 24);
                default -> new Color(161, 92, 0);
            };
        }

        private static Color statusBackground(String status) {
            return switch (status) {
                case "resolved" -> new JBColor(new Color(237, 248, 241), new Color(31, 50, 38));
                case "closed" -> new JBColor(new Color(245, 245, 245), new Color(48, 48, 48));
                case "active" -> new JBColor(new Color(255, 242, 241), new Color(55, 35, 35));
                default -> new JBColor(new Color(255, 248, 235), new Color(55, 45, 30));
            };
        }

        private static String statusText(String status) {
            return switch (status) {
                case "active" -> "激活";
                case "resolved" -> "已解决";
                case "closed" -> "已关闭";
                default -> "未知";
            };
        }

        private static String priorityText(String priority) {
            return switch (priority) {
                case "high" -> "高";
                case "medium" -> "中";
                case "low" -> "低";
                default -> "未知";
            };
        }

        private static String assigneeText(String assignee) {
            return assignee == null || assignee.isBlank() || assignee.equals("unknown") ? "未指派" : assignee;
        }

        private static String html(String value) {
            return StringUtil.escapeXmlEntities(StringUtil.notNullize(value));
        }

        @FunctionalInterface
        private interface ThrowingSupplier<T> {
            T get() throws Exception;
        }

        private record Item(String id, String name) {
            @Override
            public String toString() {
                return name.equals(id) ? id : name + " | " + id;
            }
        }

        private record BugSummary(String id, String title, String priority, String status, String createdAt, String assignedTo, String openedBy) {}
        private record Attachment(String name, String url) {}
        private record BugDetail(String id, String title, String priority, String status, String createdAt, String assignedTo, String openedBy, String description, String descriptionHtml, String reproduceSteps, String reproduceStepsHtml, String expectedResult, String expectedResultHtml, String actualResult, List<Attachment> attachments) {}

        private static final class PromptBuilder {
            private static String build(BugDetail bug) {
                List<String> images = extractReproduceStepImages(bug.reproduceStepsHtml).stream().limit(32).toList();
                String imageText = images.isEmpty() ? "未提供" : indexedImages(images, "");
                String description = textOrFallback(bug.description, bug.title);
                String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                return "【Bug修复任务】\nBug编号：" + bug.id + "\n\nBug描述：\n" + description + "\n\n复现步骤文本：\n" + reproduceText + "\n\n复现步骤图片：\n" + imageText + "\n\n请在当前代码仓库中修复以上 Bug。完成后请说明：\n1. 根因是什么\n2. 修改了哪些关键位置\n3. 如何验证修复";
            }

            private static String buildBatch(List<BugDetail> bugs) {
                List<String> sections = new ArrayList<>();
                for (int i = 0; i < bugs.size(); i++) {
                    BugDetail bug = bugs.get(i);
                    List<String> images = extractReproduceStepImages(bug.reproduceStepsHtml).stream().limit(32).toList();
                    String imageText = images.isEmpty() ? "  未提供" : indexedImages(images, "  ");
                    String description = textOrFallback(bug.description, bug.title);
                    String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                    sections.add("## " + (i + 1) + ". Bug #" + bug.id + "\n\nBug描述：\n" + description + "\n\n复现步骤文本：\n" + reproduceText + "\n\n复现步骤图片：\n" + imageText);
                }
                return "【批量Bug修复任务】\n以下是当前列表中的未解决 Bug，请在当前代码仓库中依次分析并修复。\n\n" + String.join("\n\n---\n\n", sections) + "\n\n完成后请按 Bug 编号分别说明：\n1. 根因是什么\n2. 修改了哪些关键位置\n3. 如何验证修复";
            }

            private static String indexedImages(List<String> images, String prefix) {
                List<String> lines = new ArrayList<>();
                for (int i = 0; i < images.size(); i++) {
                    lines.add(prefix + "- 图片" + (i + 1) + "：" + images.get(i));
                }
                return String.join("\n", lines);
            }

            private static String textOrFallback(String... values) {
                for (String value : values) {
                    if (value != null && !value.isBlank()) return value.trim();
                }
                return "未提供";
            }

            private static List<String> extractReproduceStepImages(String html) {
                if (html == null || html.isBlank()) return List.of();
                List<String> urls = new ArrayList<>();
                Matcher matcher = Pattern.compile("<img\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
                while (matcher.find()) {
                    String tag = matcher.group();
                    String url = readImageAttr(tag, "data-original-src");
                    if (url.isBlank()) url = readImageAttr(tag, "src");
                    if (!url.matches("(?i)^data:.*") && !urls.contains(url)) urls.add(url);
                }
                return urls;
            }

            private static String readImageAttr(String tag, String name) {
                Matcher matcher = Pattern.compile("\\b" + Pattern.quote(name) + "=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(tag);
                return matcher.find() ? matcher.group(1) : "";
            }

            private static String htmlText(String value) {
                return value == null ? "" : value
                        .replaceAll("(?is)<img\\b[^>]*>", " ")
                        .replaceAll("(?i)<br\\s*/?>", "\n")
                        .replaceAll("(?i)</(?:p|div|li|tr|td|h\\d)>", "\n")
                        .replaceAll("<[^>]+>", " ")
                        .replace("&nbsp;", " ")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .replace("&amp;", "&")
                        .replace("&quot;", "\"")
                        .replace("&#39;", "'")
                        .replaceAll("[ \\t]+\n", "\n")
                        .replaceAll("\n{3,}", "\n\n")
                        .trim();
            }
        }

        private static final class ZenTaoClient {
            private final Map<String, String> cookieJar = new LinkedHashMap<>();
            private final HttpClient http = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();
            private String baseUrl = DEFAULT_SERVER;

            private boolean loggedIn() {
                return !cookieJar.isEmpty();
            }

            private void login(String serverUrl, String account, String password) throws Exception {
                baseUrl = normalizeBaseUrl(serverUrl);
                String loginHtml = get("index.php?m=user&f=login", Map.of(), false);
                String verifyRand = text(get("index.php", Map.of("m", "user", "f", "refreshRandom"), true));
                String encrypted = verifyRand.isBlank() ? password : md5(md5(password) + verifyRand);
                Map<String, String> form = new LinkedHashMap<>();
                form.put("account", account);
                form.put("password", encrypted);
                form.put("passwordStrength", "3");
                form.put("referer", readInput(loginHtml, "referer", "/"));
                form.put("verifyRand", verifyRand);
                form.put("keepLogin", "1");
                form.put("captcha", "");
                String body = post("index.php?m=user&f=login", form);
                if (body.contains("\"result\":\"fail\"") || isLoginExpired(get("index.php", Map.of("m", "bug", "f", "browse"), true))) {
                    throw new IllegalStateException("禅道登录失败，请检查账号密码。");
                }
            }

            private List<Item> listProjects() throws Exception {
                List<String> pages = new ArrayList<>();
                List<Map<String, String>> seedParams = List.of(
                        Map.of("m", "bug", "f", "browse"),
                        Map.of("m", "bug", "f", "browse", "productID", "0"),
                        Map.of("m", "product", "f", "browse"),
                        Map.of("m", "product", "f", "all")
                );
                for (Map<String, String> params : seedParams) {
                    pages.add(get("index.php", params, false));
                }
                Set<String> productIds = new LinkedHashSet<>();
                productIds.add("0");
                for (String page : pages) productIds.addAll(extractProductIds(page));
                for (String productId : productIds) {
                    pages.add(get("index.php", Map.of("m", "product", "f", "ajaxGetDropMenu", "objectID", productId, "module", "bug", "method", "browse"), true));
                    pages.add(get("index.php", Map.of("m", "product", "f", "ajaxGetDropMenu", "objectID", productId, "module", "bug", "method", "browse", "extra", ""), true));
                    pages.add(get("index.php", Map.of("m", "project", "f", "ajaxGetDropMenu", "objectID", productId, "module", "bug", "method", "browse"), true));
                    pages.add(get("index.php", Map.of("m", "program", "f", "ajaxGetDropMenu", "objectID", productId, "module", "bug", "method", "browse"), true));
                }
                String html = String.join("\n", pages);
                Map<String, Item> result = new LinkedHashMap<>();
                for (String link : matches(html, "<a\\b[^>]*>[\\s\\S]*?</a>")) {
                    String href = attr(link, "href") + " " + attr(link, "data-url") + " " + attr(link, "data-href") + " " + attr(link, "onclick");
                    String id = readProjectIdFromText(href);
                    if (id.isBlank()) id = readProjectIdFromAttrs(link);
                    String name = htmlText(link);
                    if (!id.isBlank() && !name.isBlank() && !isIgnoredProjectName(name)) result.put(id, new Item(id, name));
                }
                for (String item : matches(html, "<(?:li|div|span|button)\\b[^>]*(?:data-(?:id|key|value|url|href)=[\"'][^\"']+[\"'])[^>]*>[\\s\\S]*?</(?:li|div|span|button)>")) {
                    String id = readProjectIdFromAttrs(item);
                    if (id.isBlank()) id = readProjectIdFromText(attr(item, "data-url") + " " + attr(item, "data-href") + " " + attr(item, "onclick"));
                    String name = htmlText(item);
                    if (!id.isBlank() && !name.isBlank() && !isIgnoredProjectName(name)) result.put(id, new Item(id, name));
                }
                return new ArrayList<>(result.values());
            }

            private List<Item> listMembers(String projectId) throws Exception {
                Map<String, Item> result = new LinkedHashMap<>();
                for (MemberSource source : memberSources(projectId)) {
                    String html = get(source.path, source.params, source.ajax);
                    for (Item item : parseMemberOptionsFromSelects(html)) result.put(item.id, item);
                    for (Item item : parseMembersFromTeamTable(html)) result.put(item.id, item);
                }
                List<BugSummary> bugRows = listBugs(projectId, "all", "", "");
                for (BugSummary bug : bugRows) if (!bug.assignedTo.isBlank()) result.put(bug.assignedTo, new Item(bug.assignedTo, bug.assignedTo));
                Collator collator = Collator.getInstance(Locale.CHINA);
                return result.values().stream().sorted((left, right) -> collator.compare(left.name, right.name)).toList();
            }

            private List<BugSummary> listBugs(String projectId, String scope, String assignee, String account) throws Exception {
                String assignedTo = switch (scope) {
                    case "all" -> "";
                    case "member" -> assignee;
                    default -> account;
                };
                for (Map<String, String> param : bugParams(projectId, assignedTo)) {
                    List<BugSummary> parsed = parseBugs(get("index.php", param, false), assignedTo);
                    if (!parsed.isEmpty()) return parsed;
                }
                return List.of();
            }

            private BugDetail getBugDetail(String id) throws Exception {
                String html = get("index.php", Map.of("m", "bug", "f", "view", "bugID", id), false);
                String detailContentHtml = readBugDescriptionHtml(html);
                DetailSections sections = splitBugDescriptionHtml(detailContentHtml);
                String descriptionHtml = !sections.descriptionHtml.isBlank() ? sections.descriptionHtml : readSectionHtml(html, "描述|Bug描述");
                String reproduceStepsHtml = !sections.reproduceStepsHtml.isBlank() ? sections.reproduceStepsHtml : readSectionHtml(html, "重现步骤|复现步骤");
                String expectedResultHtml = !sections.expectedResultHtml.isBlank() ? sections.expectedResultHtml : readSectionHtml(html, "预期结果|期望");
                String description = htmlText(descriptionHtml);
                String title = meaningfulTitle(html, id);
                if (title.isBlank() && !description.isBlank()) title = description;
                return new BugDetail(id, title.isBlank() ? "Bug #" + id : title, parsePriority(htmlText(html)), parseStatus(htmlText(html)), firstText(html, "\\d{4}-\\d{2}-\\d{2}"), "", "", description, descriptionHtml, htmlText(reproduceStepsHtml), reproduceStepsHtml, htmlText(expectedResultHtml), expectedResultHtml, htmlText(readSectionHtml(html, "实际结果|结果")), parseAttachments(html));
            }

            private void submitWorkflow(String bugId, String action, String assignee, String comment) throws Exception {
                String endpoint = switch (action) {
                    case "assign" -> "assignTo";
                    case "confirm" -> "confirmBug";
                    default -> action;
                };
                String formHtml = get("index.php", Map.of("m", "bug", "f", endpoint, "bugID", bugId, "onlybody", "yes"), false);
                Map<String, String> form = readFormInputs(formHtml);
                String safeComment = comment == null ? "" : comment;
                form.put("comment", safeComment);
                form.put("remark", safeComment);
                form.put("comment[]", safeComment);
                form.putIfAbsent("mailto", "");
                if (action.equals("assign")) {
                    form.put("assignedTo", assignee);
                    form.put("assignedTo[]", assignee);
                } else if (action.equals("resolve")) {
                    form.put("resolution", "fixed");
                    form.put("resolvedBuild", "trunk");
                    form.put("resolvedDate", formatZenTaoDate(new java.util.Date()));
                } else if (action.equals("confirm")) {
                    form.put("confirmed", "1");
                }
                String body = post("index.php?m=bug&f=" + endpoint + "&bugID=" + enc(bugId), form);
                if (body.contains("\"result\":\"fail\"") || body.contains("error")) {
                    throw new IllegalStateException("禅道未接受该工作流提交，请在网页确认必填字段。");
                }
            }

            private List<BugSummary> parseBugs(String html, String assignedTo) {
                List<String> rows = matches(html, "<tr\\b[\\s\\S]*?</tr>");
                List<String> header = rows.stream().filter(row -> htmlText(row).matches(".*(Bug标题|标题|指派给|创建者|提交者).*")).findFirst().map(row -> matches(row, "<t[dh]\\b[\\s\\S]*?</t[dh]>").stream().map(ZenTaoClient::htmlText).toList()).orElse(List.of());
                int titleIndex = indexOf(header, "Bug标题|标题");
                int openedIndex = indexOf(header, "创建者|由谁创建|提交者");
                int createdIndex = indexOf(header, "创建日期|创建时间");
                int assignedIndex = indexOf(header, "指派给");
                List<BugSummary> result = new ArrayList<>();
                for (String row : rows) {
                    List<String> cells = matches(row, "<td\\b[\\s\\S]*?</td>").stream().map(ZenTaoClient::htmlText).toList();
                    String id = cells.stream().filter(cell -> cell.matches("#?\\d+")).findFirst().orElse("").replace("#", "");
                    if (id.isBlank()) continue;
                    String bugLink = matches(row, "<a\\b[^>]*href=[\"'][^\"']*(?:m=bug[^\"']*f=view|bug[-/]view|bug-view)[^\"']*[\"'][^>]*>[\\s\\S]*?</a>").stream().findFirst().orElse("");
                    String linkText = htmlText(bugLink);
                    String title = cell(cells, titleIndex);
                    if (title.isBlank() || title.matches("#?\\d+")) title = !linkText.isBlank() && !linkText.equals(id) && !linkText.matches("#?\\d+") ? linkText : cells.stream().filter(cell -> isLikelyBugTitleCell(cell, id)).findFirst().orElse("Bug #" + id);
                    result.add(new BugSummary(id, title, parsePriority(String.join(" ", cells)), parseStatus(String.join(" ", cells)), cell(cells, createdIndex), cell(cells, assignedIndex).isBlank() ? assignedTo : cell(cells, assignedIndex), cell(cells, openedIndex)));
                }
                Map<String, BugSummary> deduped = new LinkedHashMap<>();
                for (BugSummary bug : result) deduped.putIfAbsent(bug.id, bug);
                return new ArrayList<>(deduped.values());
            }

            private List<Map<String, String>> bugParams(String projectId, String assignedTo) {
                Map<String, String> base = new LinkedHashMap<>();
                base.put("m", "bug");
                base.put("f", "browse");
                if (projectId != null && !projectId.isBlank()) base.put("productID", projectId);
                if (!assignedTo.isBlank()) base.put("assignedTo", assignedTo);
                List<Map<String, String>> result = new ArrayList<>();
                result.add(base);
                if (projectId != null && !projectId.isBlank()) {
                    Map<String, String> browser = new LinkedHashMap<>(base);
                    browser.remove("productID");
                    browser.put("productid", projectId);
                    browser.put("branch", "all");
                    browser.put("browseType", "unresolved");
                    result.add(browser);
                    Map<String, String> unresolvedUpper = new LinkedHashMap<>(base);
                    unresolvedUpper.put("branch", "all");
                    unresolvedUpper.put("browseType", "unresolved");
                    result.add(unresolvedUpper);
                    Map<String, String> bySearchLower = new LinkedHashMap<>(browser);
                    bySearchLower.put("browseType", "bySearch");
                    result.add(bySearchLower);
                }
                for (String type : List.of("bySearch", "all", "unclosed", "assigntome")) {
                    Map<String, String> next = new LinkedHashMap<>(base);
                    next.put("browseType", type);
                    result.add(next);
                }
                Map<String, String> ordered = new LinkedHashMap<>(base);
                ordered.put("browseType", "all");
                ordered.put("param", "0");
                ordered.put("orderBy", "id_desc");
                result.add(ordered);
                return dedupeParams(result);
            }

            private static boolean isLikelyBugTitleCell(String value, String id) {
                if (value == null || value.isBlank() || value.equals(id) || value.matches("#?\\d+")) return false;
                if (value.matches("(?i)一般|严重|致命|建议|激活|已解决|关闭|未确认|已确认|未知|高|中|低")) return false;
                if (value.matches("\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2})?|\\d{4}-\\d{2}-\\d{2}.*")) return false;
                return value.length() > 4;
            }

            private static List<Map<String, String>> dedupeParams(List<Map<String, String>> values) {
                Set<String> seen = new LinkedHashSet<>();
                List<Map<String, String>> result = new ArrayList<>();
                for (Map<String, String> value : values) {
                    String key = value.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(entry -> entry.getKey() + "=" + entry.getValue()).reduce((a, b) -> a + "&" + b).orElse("");
                    if (seen.add(key)) result.add(value);
                }
                return result;
            }

            private static List<MemberSource> memberSources(String projectId) {
                List<MemberSource> result = new ArrayList<>();
                for (Map<String, String> params : bugParamsStatic(projectId, "")) {
                    result.add(new MemberSource("index.php", params, false));
                    if (params.containsKey("productID")) {
                        Map<String, String> lower = new LinkedHashMap<>(params);
                        lower.put("productid", lower.remove("productID"));
                        lower.put("branch", "all");
                        lower.put("browseType", "unresolved");
                        result.add(new MemberSource("index.php", lower, false));
                    }
                }
                if (projectId != null && !projectId.isBlank()) {
                    result.add(new MemberSource("index.php", Map.of("m", "bug", "f", "create", "productID", projectId), false));
                    result.add(new MemberSource("index.php", Map.of("m", "bug", "f", "create", "productID", projectId, "branch", "0", "moduleID", "0"), false));
                    result.add(new MemberSource("index.php", Map.of("m", "product", "f", "team", "productID", projectId), false));
                    result.add(new MemberSource("index.php", Map.of("m", "project", "f", "team", "projectID", projectId), false));
                    result.add(new MemberSource("index.php", Map.of("m", "execution", "f", "team", "executionID", projectId), false));
                }
                return dedupeMemberSources(result);
            }

            private static List<Map<String, String>> bugParamsStatic(String projectId, String assignedTo) {
                Map<String, String> base = new LinkedHashMap<>();
                base.put("m", "bug");
                base.put("f", "browse");
                if (projectId != null && !projectId.isBlank()) base.put("productID", projectId);
                if (assignedTo != null && !assignedTo.isBlank()) base.put("assignedTo", assignedTo);
                List<Map<String, String>> result = new ArrayList<>();
                result.add(base);
                for (String type : List.of("bySearch", "all", "unclosed", "assigntome")) {
                    Map<String, String> next = new LinkedHashMap<>(base);
                    next.put("browseType", type);
                    result.add(next);
                }
                return result;
            }

            private static List<MemberSource> dedupeMemberSources(List<MemberSource> values) {
                Set<String> seen = new LinkedHashSet<>();
                List<MemberSource> result = new ArrayList<>();
                for (MemberSource value : values) {
                    String key = value.path + "?" + value.params.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(entry -> entry.getKey() + "=" + entry.getValue()).reduce((a, b) -> a + "&" + b).orElse("");
                    if (seen.add(key)) result.add(value);
                }
                return result;
            }

            private static List<Item> parseMemberOptionsFromSelects(String html) {
                String names = "assignedTo|assignedTo\\[\\]|openedBy|resolvedBy|closedBy|confirmedBy|lastEditedBy";
                List<Item> result = new ArrayList<>();
                for (String select : matches(html, "<select\\b[^>]*\\bname=[\"'](?:" + names + ")[\"'][^>]*>[\\s\\S]*?</select>")) {
                    for (String option : matches(select, "<option\\b[^>]*>[\\s\\S]*?</option>")) {
                        String account = attr(option, "value").trim();
                        String name = htmlText(option).trim();
                        if (!account.isBlank() && !name.isBlank() && !account.matches("(?i)all|0|closed|ditto") && !name.matches("全部|所有|选择|空|无|closed")) {
                            result.add(new Item(account, name.equals(account) ? account : name + " (" + account + ")"));
                        }
                    }
                }
                return result;
            }

            private static List<Item> parseMembersFromTeamTable(String html) {
                Map<String, Item> result = new LinkedHashMap<>();
                for (String row : matches(html, "<tr\\b[\\s\\S]*?</tr>")) {
                    String text = htmlText(row);
                    if (!text.matches("(?is).*(账号|用户名|真实姓名|成员|realname|account).*") && matches(row, "<td\\b[\\s\\S]*?</td>").isEmpty()) continue;
                    for (String link : matches(row, "<a\\b[^>]*>[\\s\\S]*?</a>")) {
                        String account = readUserAccount(link);
                        String name = htmlText(link);
                        if (!account.isBlank() && !name.isBlank() && !isIgnoredMember(account, name)) {
                            result.put(account, new Item(account, name.equals(account) ? account : name + " (" + account + ")"));
                        }
                    }
                    List<String> cells = matches(row, "<td\\b[\\s\\S]*?</td>").stream().map(ZenTaoClient::htmlText).toList();
                    for (String cell : cells) {
                        if (cell.matches("[A-Za-z][A-Za-z0-9_.-]{1,40}") && !isIgnoredMember(cell, cell)) {
                            result.putIfAbsent(cell, new Item(cell, cell));
                        }
                    }
                }
                return new ArrayList<>(result.values());
            }

            private static String readUserAccount(String html) {
                String href = attr(html, "href");
                for (String name : List.of("account", "userID", "assignedTo")) {
                    Matcher matcher = Pattern.compile("[?&]" + Pattern.quote(name) + "=([^&#]+)", Pattern.CASE_INSENSITIVE).matcher(href);
                    if (matcher.find()) return urlDecode(matcher.group(1));
                }
                for (String name : List.of("data-account", "data-user", "data-id", "data-value")) {
                    String value = attr(html, name);
                    if (!value.isBlank()) return value;
                }
                String text = htmlText(html);
                return text.matches("[A-Za-z][A-Za-z0-9_.-]{1,40}") ? text : "";
            }

            private static boolean isIgnoredMember(String account, String name) {
                return account.matches("(?i)all|0|closed|ditto|admin|guest") || name.matches("全部|所有|选择|空|无|closed");
            }

            private static List<String> extractProductIds(String html) {
                Set<String> result = new LinkedHashSet<>();
                Matcher matcher = Pattern.compile("(?:productID|productid)[=/](\\d+)|(?:bug|product)[-/]browse[-/](\\d+)|data-(?:id|key|value)=[\"'](\\d+)[\"']", Pattern.CASE_INSENSITIVE).matcher(html == null ? "" : html);
                while (matcher.find()) {
                    for (int i = 1; i <= matcher.groupCount(); i++) {
                        if (matcher.group(i) != null) result.add(matcher.group(i));
                    }
                }
                return new ArrayList<>(result);
            }

            private static String readProjectIdFromText(String value) {
                Matcher matcher = Pattern.compile("(?:productID|productid|product|objectID)\\D{0,12}(\\d+)|(?:bug|product)[-/]browse[-/](\\d+)", Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
                if (!matcher.find()) return "";
                return matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            }

            private static String readProjectIdFromAttrs(String tag) {
                for (String name : List.of("data-id", "data-key", "data-value", "objectID", "productID", "productid")) {
                    String value = attr(tag, name);
                    if (value.matches("\\d+")) return value;
                    String id = readProjectIdFromText(value);
                    if (!id.isBlank()) return id;
                }
                return "";
            }

            private static boolean isIgnoredProjectName(String name) {
                return name == null || name.matches("(?i)关闭|closed|more|更多|全部项目|all|搜索");
            }

            private String get(String path, Map<String, String> params, boolean ajax) throws Exception {
                HttpRequest.Builder builder = HttpRequest.newBuilder(buildUri(path, params)).timeout(Duration.ofSeconds(15)).GET().header("User-Agent", "ZenTaoBugAssistant-IDEA/1.0.0").header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
                if (ajax) builder.header("X-Requested-With", "XMLHttpRequest");
                addCookieHeader(builder);
                HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                mergeSetCookie(response);
                if (response.statusCode() < 200 || response.statusCode() >= 400) throw new IllegalStateException("禅道请求失败：HTTP " + response.statusCode());
                String body = response.body();
                String decoded = decodeJsonHtml(body);
                if (isLoginExpired(body) || isLoginExpired(decoded)) throw new IllegalStateException("禅道登录已超时，请重新登录。");
                return decoded;
            }

            private String post(String path, Map<String, String> form) throws Exception {
                HttpRequest.Builder builder = HttpRequest.newBuilder(buildUri(path, Map.of()))
                        .timeout(Duration.ofSeconds(15))
                        .POST(HttpRequest.BodyPublishers.ofString(encode(form)))
                        .header("Accept", "application/json, text/javascript, */*; q=0.01")
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("Origin", baseUrl.replaceFirst("/$", ""))
                        .header("Referer", buildUri("index.php?m=user&f=login", Map.of()).toString())
                        .header("X-Requested-With", "XMLHttpRequest");
                addCookieHeader(builder);
                HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                mergeSetCookie(response);
                if (response.statusCode() < 200 || response.statusCode() >= 400) throw new IllegalStateException("禅道请求失败：HTTP " + response.statusCode());
                return response.body();
            }

            private void addCookieHeader(HttpRequest.Builder builder) {
                String cookie = cookieJar.entrySet().stream().map(entry -> entry.getKey() + "=" + entry.getValue()).reduce((a, b) -> a + "; " + b).orElse("");
                if (!cookie.isBlank()) builder.header("Cookie", cookie);
            }

            private void mergeSetCookie(HttpResponse<?> response) {
                for (String header : response.headers().allValues("set-cookie")) {
                    for (String cookie : header.split(",(?=\\s*[^;,]+=)")) {
                        String pair = cookie.split(";", 2)[0].trim();
                        if (pair.isBlank()) continue;
                        String[] parts = pair.split("=", 2);
                        if (parts.length == 0 || parts[0].isBlank()) continue;
                        if (parts.length == 1 || parts[1].isBlank()) {
                            cookieJar.remove(parts[0]);
                        } else {
                            cookieJar.put(parts[0], parts[1]);
                        }
                    }
                }
            }

            private URI buildUri(String path, Map<String, String> params) {
                String query = encode(params);
                return URI.create(baseUrl + path + (query.isBlank() ? "" : (path.contains("?") ? "&" : "?") + query));
            }

            private static String normalizeBaseUrl(String value) {
                String url = value == null || value.isBlank() ? DEFAULT_SERVER : value.trim();
                return url.endsWith("/") ? url : url + "/";
            }

            private static String encode(Map<String, String> values) {
                return values.entrySet().stream().map(entry -> enc(entry.getKey()) + "=" + enc(entry.getValue())).reduce((a, b) -> a + "&" + b).orElse("");
            }

            private static String enc(String value) {
                return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
            }

            private static String urlDecode(String value) {
                return URLDecoder.decode(value == null ? "" : value, StandardCharsets.UTF_8);
            }

            private static String formatZenTaoDate(java.util.Date value) {
                return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(value);
            }

            private static String md5(String value) throws Exception {
                byte[] digest = MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8));
                StringBuilder builder = new StringBuilder();
                for (byte b : digest) builder.append(String.format("%02x", b));
                return builder.toString();
            }

            private static String readInput(String html, String name, String fallback) {
                Matcher matcher = Pattern.compile("<input\\b[^>]*name=[\"']" + Pattern.quote(name) + "[\"'][^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
                return matcher.find() ? attr(matcher.group(), "value") : fallback;
            }

            private static Map<String, String> readFormInputs(String html) {
                Map<String, String> result = new LinkedHashMap<>();
                for (String input : matches(html, "<input\\b[^>]*>")) {
                    String name = attr(input, "name");
                    if (!name.isBlank()) result.put(name, attr(input, "value"));
                }
                return result;
            }

            private static boolean isLoginExpired(String html) {
                return html.contains("登录已超时") || html.contains("重新登录");
            }

            private static String decodeJsonHtml(String value) {
                if (value == null) return "";
                String trimmed = value.trim();
                if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("\"")) return value;
                List<String> strings = new ArrayList<>();
                Matcher matcher = Pattern.compile("\"((?:\\\\.|[^\"\\\\])*)\"").matcher(trimmed);
                while (matcher.find()) {
                    strings.add(decodeJsonString(matcher.group(1)));
                }
                return strings.isEmpty() ? value : String.join("\n", strings);
            }

            private static String decodeJsonString(String value) {
                StringBuilder builder = new StringBuilder();
                for (int i = 0; i < value.length(); i++) {
                    char ch = value.charAt(i);
                    if (ch != '\\' || i + 1 >= value.length()) {
                        builder.append(ch);
                        continue;
                    }
                    char next = value.charAt(++i);
                    switch (next) {
                        case 'n' -> builder.append('\n');
                        case 'r' -> builder.append('\r');
                        case 't' -> builder.append('\t');
                        case 'b' -> builder.append('\b');
                        case 'f' -> builder.append('\f');
                        case '"', '\\', '/' -> builder.append(next);
                        case 'u' -> {
                            if (i + 4 < value.length()) {
                                builder.append((char) Integer.parseInt(value.substring(i + 1, i + 5), 16));
                                i += 4;
                            }
                        }
                        default -> builder.append(next);
                    }
                }
                return builder.toString();
            }

            private static String text(String value) {
                return value == null ? "" : value.replaceAll("\\s+", " ").trim();
            }

            private static List<String> matches(String value, String regex) {
                List<String> result = new ArrayList<>();
                Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
                while (matcher.find()) result.add(matcher.group());
                return result;
            }

            private static String first(String value, String regex) {
                Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
                return matcher.find() ? matcher.group() : "";
            }

            private static String firstText(String value, String regex) {
                Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
                return matcher.find() ? matcher.group() : "";
            }

            private static String readSection(String html, String labels) {
                Matcher matcher = Pattern.compile("(" + labels + ")[\\s\\S]{0,200}?<[^>]+>([\\s\\S]{0,2000}?)</[^>]+>", Pattern.CASE_INSENSITIVE).matcher(html == null ? "" : html);
                return matcher.find() ? htmlText(matcher.group(2)) : "";
            }

            private String readSectionHtml(String html, String labels) {
                String source = html == null ? "" : html;
                for (String label : labels.split("\\|")) {
                    String escaped = Pattern.quote(label);
                    List<Pattern> patterns = List.of(
                            Pattern.compile("<th\\b[^>]*>[\\s\\S]*?" + escaped + "[\\s\\S]*?</th>\\s*<td\\b[^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE),
                            Pattern.compile("<td\\b[^>]*>[\\s\\S]*?" + escaped + "[\\s\\S]*?</td>\\s*<td\\b[^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE)
                    );
                    for (Pattern pattern : patterns) {
                        Matcher matcher = pattern.matcher(source);
                        if (matcher.find()) {
                            String value = normalizePreviewContentHtml(matcher.group(1));
                            if (!htmlText(value).isBlank()) return value;
                        }
                    }
                }
                return "";
            }

            private String readBugDescriptionHtml(String html) {
                String source = html == null ? "" : html;
                String content = extractElementInnerHtmlByClass(source, List.of("detail-content", "article-content", "bug-content"));
                if (!content.isBlank()) {
                    String value = normalizePreviewContentHtml(content);
                    if (!htmlText(value).isBlank()) return value;
                }
                return readSectionHtml(html, "描述|Bug描述");
            }

            private static String extractElementInnerHtmlByClass(String html, List<String> classNames) {
                String classPattern = classNames.stream().map(Pattern::quote).reduce((a, b) -> a + "|" + b).orElse("");
                Matcher matcher = Pattern.compile("<([a-z][\\w:-]*)\\b[^>]*class=[\"'][^\"']*(?:" + classPattern + ")[^\"']*[\"'][^>]*>", Pattern.CASE_INSENSITIVE).matcher(html == null ? "" : html);
                while (matcher.find()) {
                    String tagName = matcher.group(1).toLowerCase(Locale.ROOT);
                    int innerStart = matcher.end();
                    int innerEnd = findMatchingCloseTag(html, tagName, innerStart);
                    if (innerEnd > innerStart) {
                        String inner = html.substring(innerStart, innerEnd);
                        if (!htmlText(inner).isBlank()) return inner;
                    }
                }
                return "";
            }

            private static int findMatchingCloseTag(String html, String tagName, int startIndex) {
                Matcher matcher = Pattern.compile("</?" + Pattern.quote(tagName) + "\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html == null ? "" : html);
                matcher.region(Math.max(0, startIndex), html == null ? 0 : html.length());
                int depth = 1;
                while (matcher.find()) {
                    String tag = matcher.group();
                    if (tag.startsWith("</")) {
                        depth--;
                        if (depth == 0) return matcher.start();
                    } else if (!tag.matches("(?s).*/\\s*>$")) {
                        depth++;
                    }
                }
                return -1;
            }

            private DetailSections splitBugDescriptionHtml(String value) {
                if (value == null || value.isBlank()) return new DetailSections("", "", "");
                Marker steps = findSectionMarker(value, List.of("步骤", "重现步骤", "复现步骤"));
                Marker expected = findSectionMarker(value, List.of("期望", "预期结果"));
                int firstMarker = value.length();
                if (steps != null) firstMarker = Math.min(firstMarker, steps.index);
                if (expected != null) firstMarker = Math.min(firstMarker, expected.index);
                String descriptionHtml = firstMarker == value.length() ? value : value.substring(0, firstMarker).trim();
                String reproduceStepsHtml = "";
                if (steps != null) {
                    Marker result = findSectionMarker(value, List.of("结果", "实际结果"));
                    int end = List.of(result, expected).stream().filter(item -> item != null).map(item -> item.index).sorted().findFirst().orElse(value.length());
                    if (steps.end < end) reproduceStepsHtml = value.substring(steps.end, end).trim();
                }
                String expectedResultHtml = expected == null ? "" : value.substring(expected.end).trim();
                return new DetailSections(htmlText(descriptionHtml).isBlank() ? "" : descriptionHtml, reproduceStepsHtml, expectedResultHtml);
            }

            private static Marker findSectionMarker(String value, List<String> labels) {
                String joined = labels.stream().map(Pattern::quote).reduce((a, b) -> a + "|" + b).orElse("");
                Matcher matcher = Pattern.compile("[\\[【]\\s*(?:" + joined + ")\\s*[\\]】]", Pattern.CASE_INSENSITIVE).matcher(value);
                return matcher.find() ? new Marker(matcher.start(), matcher.end()) : null;
            }

            private String normalizePreviewContentHtml(String value) {
                return sanitizePreviewHtml(value)
                        .replaceAll("(?i)<br\\s*/?>", "\n")
                        .replaceAll("(?i)</(?:p|div|li|tr|td|h\\d)>", "\n")
                        .replaceAll("(?i)<(?!img\\b)[^>]+>", " ")
                        .replaceAll("[ \\t]+\n", "\n")
                        .replaceAll("\n{3,}", "\n\n")
                        .trim();
            }

            private String sanitizePreviewHtml(String value) {
                return (value == null ? "" : value)
                        .replaceAll("(?is)<script\\b[\\s\\S]*?</script>", "")
                        .replaceAll("(?is)<style\\b[\\s\\S]*?</style>", "")
                        .replaceAll("(?i)\\son\\w+=[\"'][^\"']*[\"']", "")
                        .replaceAll("(?i)<img\\b((?:(?!src=)[^>])*?)\\sdata-src=[\"']([^\"']+)[\"']([^>]*?)>", "<img$1 src=\"$2\"$3>")
                        .replaceAll("(?i)\\s(src|href)=[\"']/(?!/)", " $1=\"" + baseUrl);
            }

            private static String meaningfulTitle(String html, String id) {
                for (String item : matches(html, "<h1\\b[\\s\\S]*?</h1>|<[^>]*class=[\"'][^\"']*(?:detail-title|bug-title)[^\"']*[\"'][^>]*>[\\s\\S]*?</[^>]+>")) {
                    String text = htmlText(item).replaceFirst("^#?\\d+\\s*", "");
                    if (!text.isBlank() && !text.equals(id) && !text.matches("#?\\d+") && text.length() > 4) return text;
                }
                return "";
            }

            private record DetailSections(String descriptionHtml, String reproduceStepsHtml, String expectedResultHtml) {}
            private record Marker(int index, int end) {}
            private record MemberSource(String path, Map<String, String> params, boolean ajax) {}

            private static List<Attachment> parseAttachments(String html) {
                List<Attachment> result = new ArrayList<>();
                for (String link : matches(html, "<a\\b[^>]*href=[\"'][^\"']*(?:file|download)[^\"']*[\"'][^>]*>[\\s\\S]*?</a>")) result.add(new Attachment(htmlText(link), attr(link, "href")));
                return result;
            }

            private static int indexOf(List<String> cells, String regex) {
                for (int i = 0; i < cells.size(); i++) if (cells.get(i).matches(".*(" + regex + ").*")) return i;
                return -1;
            }

            private static String cell(List<String> cells, int index) {
                return index >= 0 && index < cells.size() ? cells.get(index) : "";
            }

            private static String parsePriority(String value) {
                if (value.matches("(?is).*(严重|高|high|p1).*")) return "high";
                if (value.matches("(?is).*(一般|中|medium|p2).*")) return "medium";
                if (value.matches("(?is).*(低|low|p3).*")) return "low";
                return "unknown";
            }

            private static String parseStatus(String value) {
                if (value.matches("(?is).*(已解决|resolved).*")) return "resolved";
                if (value.matches("(?is).*(关闭|closed).*")) return "closed";
                if (value.matches("(?is).*(激活|active).*")) return "active";
                return "unknown";
            }

            private static String htmlText(String value) {
                return value == null ? "" : value.replaceAll("(?is)<script\\b[\\s\\S]*?</script>", " ").replaceAll("(?is)<style\\b[\\s\\S]*?</style>", " ").replaceAll("<[^>]+>", " ").replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replaceAll("\\s+", " ").trim();
            }

            private static String attr(String html, String name) {
                Matcher matcher = Pattern.compile("\\b" + Pattern.quote(name) + "=[\"']([^\"']*)[\"']", Pattern.CASE_INSENSITIVE).matcher(html == null ? "" : html);
                return matcher.find() ? matcher.group(1) : "";
            }
        }
    }
}
