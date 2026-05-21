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
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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
            JButton refreshProjects = new JButton("刷新项目");
            refreshProjects.addActionListener(event -> loadProjects(true));
            projectRow.add(projectBox, BorderLayout.CENTER);
            projectRow.add(refreshProjects, BorderLayout.EAST);
            addRow(top, c, 5, "项目", projectRow);

            memberBox.setEditable(true);
            memberWrap.add(memberBox, BorderLayout.CENTER);
            JButton refreshMembers = new JButton("刷新成员");
            refreshMembers.addActionListener(event -> loadMembers(true));
            memberWrap.add(refreshMembers, BorderLayout.EAST);
            addRow(top, c, 6, "成员", memberWrap);

            JPanel filters = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
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
                savePreferences();
                refreshBugs();
            });
            memberBox.addActionListener(event -> {
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
                loadProjects(false);
            });
        }

        private void loadProjects(boolean force) {
            if (!force && !projects.isEmpty()) {
                refreshBugs();
                return;
            }
            runAsync("正在获取项目列表...", client::listProjects, items -> {
                projects.clear();
                projects.addAll(items);
                projectBox.removeAllItems();
                for (Item item : projects) projectBox.addItem(item);
                selectItem(projectBox, preferredProjectId);
                savePreferences();
                refreshBugs();
            });
        }

        private void loadMembers(boolean force) {
            if (!force && !members.isEmpty()) return;
            runAsync("正在获取成员列表...", () -> client.listMembers(selectedProjectId()), items -> {
                members.clear();
                members.addAll(items);
                memberBox.removeAllItems();
                for (Item item : members) memberBox.addItem(item);
                selectItem(memberBox, preferredMemberAccount);
                savePreferences();
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
            preferredMemberAccount = properties.getValue("zentao.idea.memberAccount", "");
            Set<String> filters = new LinkedHashSet<>(List.of(properties.getValue("zentao.idea.filters", String.join(",", FILTER_KEYS)).split(",")));
            filterChecks.forEach((key, box) -> box.setSelected(filters.contains(key)));
        }

        private List<String> selectedFilterKeys() {
            List<String> keys = new ArrayList<>();
            filterChecks.forEach((key, box) -> {
                if (box.isSelected()) keys.add(key);
            });
            return keys;
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
            for (BugSummary bug : unresolved(filteredBugs())) aiFix(bug.id);
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
                case "assignTo" -> "指派";
                case "confirmBug" -> "确认";
                case "resolve" -> "解决";
                case "activate" -> "激活";
                default -> action;
            };
            String assignee = "";
            if (action.equals("assignTo")) {
                assignee = Messages.showInputDialog(project, "请输入要指派给的禅道账号：", "禅道助手 - 指派", null);
                if (assignee == null || assignee.isBlank()) return;
            }
            String comment = Messages.showInputDialog(project, title + " Bug #" + bugId + "，可填写备注：", "禅道助手 - " + title, null);
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
                    assign.addActionListener(event -> submitWorkflow(bug.id, "assignTo"));
                    buttons.add(assign);
                    JButton confirm = new JButton("确认");
                    confirm.addActionListener(event -> submitWorkflow(bug.id, "confirmBug"));
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
                String imageText = images.isEmpty() ? "未提供" : images.stream().map(url -> "- " + url).reduce((a, b) -> a + "\n" + b).orElse("未提供");
                String description = textOrFallback(bug.description, bug.title);
                String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                return "【Bug修复任务】\nBug编号：" + bug.id + "\n\nBug描述：\n" + description + "\n\n复现步骤文本：\n" + reproduceText + "\n\n复现步骤图片：\n" + imageText + "\n\n请在当前代码仓库中修复以上 Bug。完成后说明根因、关键修改和验证方式。";
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
            private final CookieManager cookieManager = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
            private final HttpClient http = HttpClient.newBuilder().cookieHandler(cookieManager).connectTimeout(Duration.ofSeconds(10)).build();
            private String baseUrl = DEFAULT_SERVER;

            private boolean loggedIn() {
                return !cookieManager.getCookieStore().getCookies().isEmpty();
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
                String html = get("index.php", Map.of("m", "product", "f", "all"), true) + "\n" + get("index.php", Map.of("m", "product", "f", "ajaxGetDropMenu", "objectID", "0", "module", "bug", "method", "browse"), true);
                Map<String, Item> result = new LinkedHashMap<>();
                for (String link : matches(html, "<a\\b[^>]*>[\\s\\S]*?</a>")) {
                    String href = attr(link, "href") + " " + attr(link, "data-url") + " " + attr(link, "onclick");
                    Matcher matcher = Pattern.compile("productID[=/](\\d+)|productid[=/](\\d+)").matcher(href);
                    if (matcher.find()) {
                        String id = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
                        String name = htmlText(link);
                        if (!name.isBlank()) result.put(id, new Item(id, name));
                    }
                }
                return new ArrayList<>(result.values());
            }

            private List<Item> listMembers(String projectId) throws Exception {
                List<BugSummary> bugRows = listBugs(projectId, "all", "", "");
                Map<String, Item> result = new LinkedHashMap<>();
                for (BugSummary bug : bugRows) if (!bug.assignedTo.isBlank()) result.put(bug.assignedTo, new Item(bug.assignedTo, bug.assignedTo));
                return new ArrayList<>(result.values());
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
                String formHtml = get("index.php", Map.of("m", "bug", "f", action, "bugID", bugId, "onlybody", "yes"), false);
                Map<String, String> form = readFormInputs(formHtml);
                form.put("comment", comment == null ? "" : comment);
                if (action.equals("assignTo")) {
                    form.put("assignedTo", assignee);
                } else if (action.equals("resolve")) {
                    form.putIfAbsent("resolution", "fixed");
                    form.putIfAbsent("resolvedBuild", "trunk");
                } else if (action.equals("confirmBug")) {
                    form.putIfAbsent("confirmed", "1");
                }
                String body = post("index.php?m=bug&f=" + action + "&bugID=" + enc(bugId), form);
                if (body.contains("\"result\":\"fail\"") || body.contains("error")) {
                    throw new IllegalStateException("禅道未接受该工作流提交，请在网页确认必填字段。");
                }
            }

            private List<BugSummary> parseBugs(String html, String assignedTo) {
                List<String> rows = matches(html, "<tr\\b[\\s\\S]*?</tr>");
                List<String> header = rows.stream().filter(row -> htmlText(row).contains("Bug标题")).findFirst().map(row -> matches(row, "<t[dh]\\b[\\s\\S]*?</t[dh]>").stream().map(ZenTaoClient::htmlText).toList()).orElse(List.of());
                int titleIndex = indexOf(header, "Bug标题|标题");
                int openedIndex = indexOf(header, "创建者|提交者");
                int createdIndex = indexOf(header, "创建日期|创建时间");
                int assignedIndex = indexOf(header, "指派给");
                List<BugSummary> result = new ArrayList<>();
                for (String row : rows) {
                    List<String> cells = matches(row, "<td\\b[\\s\\S]*?</td>").stream().map(ZenTaoClient::htmlText).toList();
                    String id = cells.stream().filter(cell -> cell.matches("#?\\d+")).findFirst().orElse("").replace("#", "");
                    if (id.isBlank()) continue;
                    String title = cell(cells, titleIndex);
                    if (title.isBlank() || title.matches("#?\\d+")) title = cells.stream().filter(cell -> cell.length() > 4 && !cell.matches("\\d+")).findFirst().orElse("Bug #" + id);
                    result.add(new BugSummary(id, title, parsePriority(String.join(" ", cells)), parseStatus(String.join(" ", cells)), cell(cells, createdIndex), cell(cells, assignedIndex).isBlank() ? assignedTo : cell(cells, assignedIndex), cell(cells, openedIndex)));
                }
                return result;
            }

            private List<Map<String, String>> bugParams(String projectId, String assignedTo) {
                Map<String, String> base = new LinkedHashMap<>();
                base.put("m", "bug");
                base.put("f", "browse");
                if (!projectId.isBlank()) base.put("productID", projectId);
                if (!assignedTo.isBlank()) base.put("assignedTo", assignedTo);
                List<Map<String, String>> result = new ArrayList<>();
                result.add(base);
                Map<String, String> browser = new LinkedHashMap<>(base);
                browser.remove("productID");
                browser.put("productid", projectId);
                browser.put("branch", "all");
                browser.put("browseType", "unresolved");
                result.add(browser);
                for (String type : List.of("bySearch", "all", "unclosed", "assigntome")) {
                    Map<String, String> next = new LinkedHashMap<>(base);
                    next.put("browseType", type);
                    result.add(next);
                }
                return result;
            }

            private String get(String path, Map<String, String> params, boolean ajax) throws Exception {
                HttpRequest.Builder builder = HttpRequest.newBuilder(buildUri(path, params)).timeout(Duration.ofSeconds(15)).GET().header("User-Agent", "ZenTaoBugAssistant-IDEA/1.0.0").header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
                if (ajax) builder.header("X-Requested-With", "XMLHttpRequest");
                return http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).body();
            }

            private String post(String path, Map<String, String> form) throws Exception {
                return http.send(HttpRequest.newBuilder(buildUri(path, Map.of())).timeout(Duration.ofSeconds(15)).POST(HttpRequest.BodyPublishers.ofString(encode(form))).header("Content-Type", "application/x-www-form-urlencoded").header("X-Requested-With", "XMLHttpRequest").build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).body();
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
