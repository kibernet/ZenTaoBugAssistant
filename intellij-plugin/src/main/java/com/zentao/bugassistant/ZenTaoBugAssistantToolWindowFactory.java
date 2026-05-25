package com.zentao.bugassistant;

import com.intellij.ide.DataManager;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionPlaces;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.ComboBox;
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
import java.awt.Font;
import java.awt.FlowLayout;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Image;
import java.awt.Dimension;
import java.awt.GradientPaint;
import java.awt.RenderingHints;
import java.awt.datatransfer.StringSelection;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.text.Collator;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.ImageIcon;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.SwingWorker;
import javax.swing.border.CompoundBorder;
import javax.swing.border.EmptyBorder;
import javax.swing.border.LineBorder;
import org.jetbrains.annotations.NotNull;

public class ZenTaoBugAssistantToolWindowFactory implements ToolWindowFactory {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        ZenTaoBugAssistantPanel panel = new ZenTaoBugAssistantPanel(project, toolWindow);
        Content content = ContentFactory.SERVICE.getInstance().createContent(panel.root, "", false);
        toolWindow.getContentManager().addContent(content);
    }

    private static final class ZenTaoBugAssistantPanel {
        private static final String DEFAULT_SERVER = "http://zentao.yuwan-game.com:8088/";
        private static final int PAGE_SIZE = 20;
        private static final int DEFAULT_KEEP_ALIVE_MINUTES = 5;
        private static final Duration HTTP_CONNECT_TIMEOUT = Duration.ofSeconds(15);
        private static final Duration HTTP_REQUEST_TIMEOUT = Duration.ofSeconds(45);
        private static final List<String> FILTER_KEYS = List.of("assignedToMe", "unresolved", "resolved", "closed");
        private static final List<String> CLAUDE_ACTION_IDS = List.of("ClaudeCode.Chat", "claude-code.chat", "claudeCode.chat", "ClaudeCode.NewChat", "claude-code.newChat", "claudeCode.newChat", "ClaudeCode.Open", "claude-code.open", "claudeCode.open");
        private static final String SUPPRESS_ERROR_POPUP_KEY = "zentao.idea.suppressErrorPopup";

        private final Project project;
        private final ToolWindow toolWindow;
        private final JPanel root = new JPanel(new BorderLayout(8, 8));
        private final JBTextField serverField = new JBTextField(DEFAULT_SERVER);
        private final JBTextField accountField = new JBTextField();
        private final JBPasswordField passwordField = new JBPasswordField();
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
        private final JButton aiFixAllButton = new GradientButton("✦ AI一键修复");
        private final JButton clearImageCacheButton = new JButton("清理缓存");
        private final ComboBox<String> aiEngineBox = new ComboBox<>(new String[] {"Claude Code"});
        private final JPanel bugListPanel = new JPanel();
        private final JLabel pageLabel = new JLabel("0/0");
        private final JButton firstPageButton = new JButton("|<");
        private final JButton prevPageButton = new JButton("<");
        private final JButton nextPageButton = new JButton(">");
        private final JButton lastPageButton = new JButton(">|");
        private final JTextArea statusArea = new JTextArea("状态：就绪");
        private final List<String> debugEvents = new ArrayList<>();
        private final ZenTaoClient client = new ZenTaoClient();
        private final List<BugSummary> bugs = new ArrayList<>();
        private final List<Item> projects = new ArrayList<>();
        private final List<Item> members = new ArrayList<>();
        private ZenTaoPreviewVirtualFile previewFile;
        private String preferredProjectId = "";
        private String preferredMemberAccount = "";
        private int currentPage = 1;
        private javax.swing.Timer keepAliveTimer;
        private boolean loading = false;
        private boolean hydratingProjects = false;
        private boolean hydratingMembers = false;
        private boolean hydratingFilters = false;
        private static final Color PANEL_BG = new JBColor(new Color(245, 247, 250), new Color(35, 37, 42));
        private static final Color TOOLBAR_BG = new JBColor(new Color(247, 248, 252), new Color(43, 45, 50));
        private static final Color TEXT_MAIN = new JBColor(new Color(36, 40, 45), new Color(226, 229, 234));
        private static final Color TEXT_SUB = new JBColor(new Color(108, 113, 122), new Color(149, 155, 164));
        private static final Font BUTTON_FONT = new Font("Microsoft YaHei UI", Font.BOLD, 12);
        private static final Color BTN_PRIMARY_BG = new Color(37, 99, 168);
        private static final Color BTN_SECONDARY_BG = new Color(95, 99, 104);
        private static final Color BTN_SUCCESS_BG = new Color(47, 125, 70);
        private static final Color BTN_DANGER_BG = new Color(95, 99, 104);
        private static final Color BTN_PURPLE_BG = new Color(124, 58, 237);
        private static final Color BTN_TEXT = new Color(246, 248, 251);

        private ZenTaoBugAssistantPanel(Project project, ToolWindow toolWindow) {
            this.project = project;
            this.toolWindow = toolWindow;
            client.setPromptImageRoot(project.getBasePath());
            cleanupImageCacheOncePerDay();
            root.setBorder(JBUI.Borders.empty(10));
            root.setBackground(PANEL_BG);
            root.add(buildTopPanel(), BorderLayout.NORTH);
            root.add(buildCenterPanel(), BorderLayout.CENTER);
            statusArea.setEditable(false);
            statusArea.setLineWrap(true);
            statusArea.setRows(2);
            statusArea.setBackground(TOOLBAR_BG);
            statusArea.setForeground(TEXT_SUB);
            statusArea.setBorder(new CompoundBorder(new LineBorder(new JBColor(new Color(222, 227, 238), new Color(75, 80, 89)), 1, true), JBUI.Borders.empty(8, 10)));
            root.add(statusArea, BorderLayout.SOUTH);
            applySettingsDefaults();
            restorePreferences();
            bindEvents();
            if (client.loggedIn()) {
                loginState.setText("已恢复会话：" + accountField.getText());
                loginButton.setText("重新登录");
                startSessionKeepAlive();
                loadProjectsAfterLogin(false);
            } else if (autoLoginBox.isSelected() && !accountField.getText().isBlank() && passwordField.getPassword().length > 0) {
                loginAndRefresh();
            }
        }

        private JPanel buildTopPanel() {
            JPanel top = new JPanel(new GridBagLayout());
            top.setOpaque(true);
            top.setBackground(TOOLBAR_BG);
            top.setBorder(new CompoundBorder(new LineBorder(new JBColor(new Color(224, 230, 240), new Color(66, 71, 80)), 1, true), JBUI.Borders.empty(8, 8)));
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
            loginRow.setOpaque(false);
            applyTopButton(loginButton, BTN_PRIMARY_BG);
            loginRow.add(autoLoginBox);
            loginRow.add(loginButton);
            loginRow.add(loginState);
            c.gridx = 1;
            c.gridy = 4;
            top.add(loginRow, c);

            JPanel projectRow = new JPanel(new BorderLayout(6, 0));
            JButton refreshProjects = new JButton("刷新");
            applyTopButton(refreshProjects, BTN_PRIMARY_BG);
            refreshProjects.addActionListener(event -> loadProjects(true));
            projectRow.add(projectBox, BorderLayout.CENTER);
            projectRow.add(refreshProjects, BorderLayout.EAST);
            addRow(top, c, 5, "项目", projectRow);

            memberBox.setEditable(true);
            memberWrap.add(memberBox, BorderLayout.CENTER);
            JButton refreshMembers = new JButton("刷新");
            applyTopButton(refreshMembers, BTN_PRIMARY_BG);
            refreshMembers.addActionListener(event -> loadMembers(true));
            memberWrap.add(refreshMembers, BorderLayout.EAST);
            addRow(top, c, 6, "成员", memberWrap);

            JPanel filters = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            filters.setOpaque(false);
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

        private void cleanupImageCacheOncePerDay() {
            PropertiesComponent properties = projectProperties();
            if (properties == null) return;
            String today = java.time.LocalDate.now().toString();
            if (today.equals(properties.getValue("zentao.idea.lastImageCacheCleanup", ""))) return;
            client.clearPromptImages();
            properties.setValue("zentao.idea.lastImageCacheCleanup", today, "");
        }

        private JComponent buildHeaderLogo() {
            java.net.URL logo = ZenTaoBugAssistantToolWindowFactory.class.getResource("/META-INF/header-logo.png");
            if (logo == null) {
                return new JPanel();
            }
            JPanel panel = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
            panel.setOpaque(false);
            ImageIcon icon = new ImageIcon(logo);
            Image scaled = icon.getImage().getScaledInstance(Math.max(1, icon.getIconWidth() / 2), Math.max(1, icon.getIconHeight() / 2), Image.SCALE_SMOOTH);
            panel.add(new JLabel(new ImageIcon(scaled)));
            return panel;
        }

        private JPanel buildCenterPanel() {
            JPanel center = new JPanel(new BorderLayout(8, 8));
            center.setOpaque(true);
            center.setBackground(PANEL_BG);
            JPanel bar = new JPanel(new BorderLayout(8, 0));
            bar.setOpaque(true);
            bar.setBackground(TOOLBAR_BG);
            bar.setBorder(new CompoundBorder(new LineBorder(new JBColor(new Color(224, 230, 240), new Color(66, 71, 80)), 1, true), JBUI.Borders.empty(8, 10)));
            JPanel actions = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
            actions.setOpaque(false);
            compactButton(refreshButton);
            compactButton(aiFixAllButton);
            compactButton(clearImageCacheButton);
            applyTopButton(refreshButton, BTN_PRIMARY_BG);
            applyPillButton(aiFixAllButton, BTN_PURPLE_BG);
            applyPillButton(clearImageCacheButton, BTN_PRIMARY_BG);
            aiEngineBox.setPrototypeDisplayValue("Claude Code");
            actions.add(refreshButton);
            actions.add(aiFixAllButton);
            actions.add(clearImageCacheButton);
            aiEngineBox.setEnabled(true);
            actions.add(aiEngineBox);
            bar.add(bugCountLabel, BorderLayout.WEST);
            bugCountLabel.setForeground(TEXT_MAIN);
            bugCountLabel.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 14));
            bar.add(actions, BorderLayout.EAST);
            center.add(bar, BorderLayout.NORTH);
            bugListPanel.setLayout(new javax.swing.BoxLayout(bugListPanel, javax.swing.BoxLayout.Y_AXIS));
            bugListPanel.setOpaque(true);
            bugListPanel.setBackground(PANEL_BG);
            center.add(new JBScrollPane(bugListPanel), BorderLayout.CENTER);
            JPanel pager = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
            pager.setOpaque(true);
            pager.setBackground(TOOLBAR_BG);
            pager.setBorder(new CompoundBorder(new LineBorder(new JBColor(new Color(224, 230, 240), new Color(66, 71, 80)), 1, true), JBUI.Borders.empty(6, 8)));
            pager.add(new JLabel("每页 20 项"));
            applyTopButton(firstPageButton, BTN_SECONDARY_BG);
            applyTopButton(prevPageButton, BTN_SECONDARY_BG);
            applyTopButton(nextPageButton, BTN_SECONDARY_BG);
            applyTopButton(lastPageButton, BTN_SECONDARY_BG);
            pageLabel.setForeground(TEXT_MAIN);
            pager.add(firstPageButton);
            pager.add(prevPageButton);
            pager.add(pageLabel);
            pager.add(nextPageButton);
            pager.add(lastPageButton);
            center.add(pager, BorderLayout.SOUTH);
            return center;
        }

        private void compactButton(JButton button) {
            button.setMargin(JBUI.insets(2, 8));
        }

        private void applyPillButton(JButton button, Color background) {
            button.setFocusPainted(false);
            button.setOpaque(!(button instanceof GradientButton));
            button.setBorderPainted(false);
            button.setContentAreaFilled(!(button instanceof GradientButton));
            button.setBackground(background);
            button.setForeground(BTN_TEXT);
            button.setFont(BUTTON_FONT);
            button.setBorder(new CompoundBorder(new LineBorder(background.darker(), 1, true), new EmptyBorder(4, 12, 4, 12)));
            button.setCursor(new java.awt.Cursor(java.awt.Cursor.HAND_CURSOR));
        }

        private void applyTopButton(JButton button, Color background) {
            button.setFocusPainted(false);
            button.setOpaque(true);
            button.setBorderPainted(false);
            button.setContentAreaFilled(true);
            button.setBackground(background);
            button.setForeground(BTN_TEXT);
            button.setFont(BUTTON_FONT);
            button.setBorder(new CompoundBorder(new LineBorder(background.darker(), 1, false), new EmptyBorder(4, 10, 4, 10)));
            button.setCursor(new java.awt.Cursor(java.awt.Cursor.HAND_CURSOR));
        }

        private void applyCardButton(JButton button, Color background) {
            applyTopButton(button, background);
            button.setBorder(new CompoundBorder(new LineBorder(background.brighter(), 1, false), new EmptyBorder(3, 10, 3, 10)));
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
            box.setOpaque(false);
            box.setForeground(TEXT_SUB);
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
            clearImageCacheButton.addActionListener(event -> clearImageCache());
            aiEngineBox.addActionListener(event -> savePreferences());
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
                savePreferences();
                startSessionKeepAlive();
                loadProjectsAfterLogin(false);
            });
        }

        private void applySettingsDefaults() {
            PropertiesComponent properties = PropertiesComponent.getInstance();
            serverField.setText(properties.getValue("zentao.idea.settings.serverUrl", DEFAULT_SERVER));
            autoLoginBox.setSelected(properties.getBoolean("zentao.idea.settings.autoLogin", true));
            aiEngineBox.setSelectedIndex(0);
        }

        private void startSessionKeepAlive() {
            if (keepAliveTimer != null) keepAliveTimer.stop();
            int minutes = Math.max(1, PropertiesComponent.getInstance().getInt("zentao.idea.settings.keepAliveMinutes", DEFAULT_KEEP_ALIVE_MINUTES));
            keepAliveTimer = new javax.swing.Timer(minutes * 60 * 1000, event -> {
                if (project.isDisposed()) {
                    ((javax.swing.Timer)event.getSource()).stop();
                    return;
                }
                if (!client.loggedIn()) return;
                runKeepAlive();
            });
            keepAliveTimer.setInitialDelay(minutes * 60 * 1000);
            keepAliveTimer.start();
        }

        private void loadProjectsAfterLogin(boolean force) {
            loadProjects(force, () -> loadMembers(false, () -> {
                setStatus("登录成功，项目 " + projects.size() + " 个，成员 " + members.size() + " 个，正在自动刷新 Bug 列表...");
                refreshBugs();
            }));
        }

        private void loadProjects(boolean force) {
            loadProjects(force, null);
        }

        private void loadProjects(boolean force, Runnable afterLoaded) {
            if (!force && !projects.isEmpty()) {
                setStatus("项目列表已缓存：" + projects.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
                return;
            }
            runAsync("正在获取项目列表...", client::listProjects, items -> {
                projects.clear();
                projects.addAll(items);
                populateProjectBox();
                savePreferences();
                setStatus(items.isEmpty() ? "项目列表为空，请检查禅道权限或项目入口。" : "项目列表已加载：" + items.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
            });
        }

        private void loadMembers(boolean force) {
            loadMembers(force, null);
        }

        private void loadMembers(boolean force, Runnable afterLoaded) {
            if (!force && !members.isEmpty()) {
                setStatus("成员列表已缓存：" + members.size() + " 个");
                populateMemberBox();
                renderBugs();
                if (afterLoaded != null) afterLoaded.run();
                return;
            }
            runAsync("正在获取成员列表...", () -> client.listMembers(selectedProjectId()), items -> {
                members.clear();
                members.addAll(items);
                populateMemberBox();
                savePreferences();
                renderBugs();
                setStatus(items.isEmpty() ? "成员列表为空，请先选择项目或检查禅道权限。" : "成员列表已加载：" + items.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
            });
        }

        private void refreshBugs() {
            if (!client.loggedIn()) return;
            runAsync("正在获取 Bug 列表...", () -> {
                client.clearPromptImages();
                List<BugSummary> result = client.listBugs(selectedProjectId(), "all", "", accountField.getText());
                return client.enrichVideoFlags(result);
            }, result -> {
                bugs.clear();
                bugs.addAll(result);
                currentPage = 1;
                renderBugs();
                loadMembers(false);
            });
        }

        private void copyBugAccessDiagnostic() {
            if (!client.loggedIn()) return;
            runAsync("正在收集诊断信息...", () -> client.collectBugAccessDiagnostic(selectedProjectId(), snapshotDebugEvents()), text -> {
                CopyPasteManager.getInstance().setContents(new StringSelection(text));
                setStatus("Bug 列表诊断信息已复制到剪贴板。");
                Messages.showInfoMessage(project, "Bug 列表诊断信息已复制到剪贴板，请粘贴给我继续分析。", "禅道助手");
            });
        }

        private void clearImageCache() {
            client.clearPromptImages();
            setStatus("本地图片缓存已清理。");
        }

        private List<String> snapshotDebugEvents() {
            synchronized (debugEvents) {
                return new ArrayList<>(debugEvents);
            }
        }

        private String selectedProjectId() {
            Object item = projectBox.getSelectedItem();
            return item instanceof Item ? ((Item)item).id : "";
        }

        private String selectedMemberAccount() {
            Object editorItem = memberBox.isEditable() && memberBox.getEditor() != null ? memberBox.getEditor().getItem() : null;
            if (editorItem instanceof Item) {
                return ((Item)editorItem).id;
            }
            String editorText = editorItem == null ? "" : editorItem.toString().trim();
            if (editorText.isBlank() || editorText.equals("全部成员")) return "";
            if (!editorText.isBlank()) return editorText.contains("|") ? editorText.substring(editorText.lastIndexOf('|') + 1).trim() : editorText;
            Object item = memberBox.getSelectedItem();
            if (item instanceof Item) {
                return ((Item)item).id;
            }
            String text = item == null ? "" : item.toString().trim();
            if (text.isBlank() || text.equals("全部成员")) return "";
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
            PropertiesComponent properties = projectProperties();
            if (properties == null) return;
            properties.setValue("zentao.idea.serverUrl", serverField.getText(), DEFAULT_SERVER);
            properties.setValue("zentao.idea.account", accountField.getText(), "");
            properties.setValue("zentao.idea.autoLogin", autoLoginBox.isSelected(), true);
            properties.setValue("zentao.idea.aiEngine", "claudeCode", "claudeCode");
            properties.setValue("zentao.idea.password", new String(passwordField.getPassword()), "");
            properties.setValue("zentao.idea.sessionCookies", client.cookieHeader(), "");
            properties.setValue("zentao.idea.projectId", selectedProjectId(), "");
            properties.setValue("zentao.idea.memberAccount", selectedMemberAccount(), "");
            properties.setValue("zentao.idea.projects", encodeItems(projects), "");
            properties.setValue("zentao.idea.members", encodeItems(members), "");
            properties.setValue("zentao.idea.filters", String.join(",", selectedFilterKeys()), String.join(",", FILTER_KEYS));
        }

        private void restorePreferences() {
            PropertiesComponent properties = projectProperties();
            if (properties == null) return;
            serverField.setText(properties.getValue("zentao.idea.serverUrl", DEFAULT_SERVER));
            accountField.setText(properties.getValue("zentao.idea.account", ""));
            autoLoginBox.setSelected(properties.getBoolean("zentao.idea.autoLogin", true));
            aiEngineBox.setSelectedIndex(0);
            passwordField.setText(properties.getValue("zentao.idea.password", ""));
            client.restoreSession(serverField.getText(), properties.getValue("zentao.idea.sessionCookies", ""));
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
            for (Item item : projects) projectBox.addItem(item);
            if (projectBox.getItemCount() > 0) {
                if (preferredProjectId == null || preferredProjectId.isBlank()) {
                    projectBox.setSelectedIndex(0);
                } else {
                    selectItem(projectBox, preferredProjectId);
                }
            }
            hydratingProjects = false;
        }

        private void populateMemberBox() {
            hydratingMembers = true;
            memberBox.removeAllItems();
            for (Item item : members) memberBox.addItem(item);
            if (preferredMemberAccount == null || preferredMemberAccount.isBlank()) {
                memberBox.getEditor().setItem("");
            } else {
                selectItem(memberBox, preferredMemberAccount);
            }
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
            List<BugSummary> memberFiltered = filterBugsBySelectedMember();
            List<BugSummary> filtered = filterBugsByCategory(memberFiltered);
            int totalPages = Math.max(1, (int)Math.ceil(filtered.size() / (double)PAGE_SIZE));
            currentPage = Math.min(Math.max(1, currentPage), totalPages);
            int start = Math.min(filtered.size(), (currentPage - 1) * PAGE_SIZE);
            int end = Math.min(filtered.size(), start + PAGE_SIZE);
            bugListPanel.removeAll();
            if (bugs.isEmpty()) {
                bugListPanel.add(emptyState("暂无 Bug，请先登录或刷新。"));
            } else if (filtered.isEmpty()) {
                bugListPanel.add(emptyState("当前成员或分类暂无 Bug。原始 " + bugs.size() + " 个，成员过滤后 " + memberFiltered.size() + " 个。"));
            } else {
                for (BugSummary bug : filtered.subList(start, end)) bugListPanel.add(new BugCard(bug));
            }
            bugCountLabel.setText("共 " + filtered.size() + " 个 Bug / 总 " + bugs.size() + " 个");
            setStatus("Bug 原始 " + bugs.size() + " 个，成员过滤 " + memberFiltered.size() + " 个，当前显示 " + filtered.size() + " 个。");
            pageLabel.setText(currentPage + "/" + totalPages);
            aiFixAllButton.setText("AI一键修复 " + unresolved(filtered).size());
            aiFixAllButton.setEnabled(!unresolved(filtered).isEmpty());
            bugListPanel.revalidate();
            bugListPanel.repaint();
        }

        private List<BugSummary> filteredBugs() {
            return filterBugsByCategory(filterBugsBySelectedMember());
        }

        private List<BugSummary> filterBugsByCategory(List<BugSummary> scopedBugs) {
            if (allFilterBox.isSelected()) return scopedBugs;
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

        private JComponent emptyState(String text) {
            JLabel label = new JLabel(text);
            label.setBorder(JBUI.Borders.empty(16));
            label.setForeground(JBColor.GRAY);
            return label;
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
            return aliases.stream().map(item -> item.toLowerCase(Locale.ROOT)).filter(item -> !item.isBlank()).collect(Collectors.toList());
        }

        private void aiFixAll() {
            List<BugSummary> targets = unresolved(filteredBugs());
            if (targets.isEmpty()) return;
            runAsync("正在构建 " + targets.size() + " 个 Bug 的批量修复提示词...", () -> {
                client.cleanupOldPromptImages(Duration.ofDays(1));
                List<BugDetail> details = new ArrayList<>();
                for (BugSummary bug : targets) {
                    details.add(client.getBugDetail(bug.id));
                }
                return details;
            }, details -> {
                try {
                    String prompt = details.size() == 1 ? PromptBuilder.build(details.get(0)) : PromptBuilder.buildBatch(details);
                    sendToClaudeCode(prompt);
                    setStatus(details.size() + " 个 Bug 已合并发送给 Claude Code with GUI");
                } catch (Throwable error) {
                    showDetailedError("AI一键修复失败", error);
                }
            });
        }

        private void aiFix(String bugId) {
            runAsync("正在构建 Bug #" + bugId + " 修复提示词...", () -> {
                client.cleanupOldPromptImages(Duration.ofDays(1));
                return client.getBugDetail(bugId);
            }, detail -> {
                try {
                    sendToClaudeCode(PromptBuilder.build(detail));
                    setStatus("Bug #" + bugId + " 已发送给 Claude Code with GUI");
                } catch (Throwable error) {
                    showDetailedError("AI修复失败", error);
                }
            });
        }

        private void preview(String bugId) {
            runAsync("正在加载 Bug #" + bugId + " 预览...", () -> client.getBugDetail(bugId), this::openPreviewEditorTab);
        }

        private void openPreviewEditorTab(BugDetail detail) {
            String previewTitle = detail.description == null || detail.description.isBlank() ? detail.title : detail.description;
            String contentHtml = previewHtml(detail, previewTitle);
            if (previewFile == null) {
                previewFile = new ZenTaoPreviewVirtualFile();
            }
            previewFile.update(detail.id, contentHtml);
            FileEditorManager editorManager = FileEditorManager.getInstance(project);
            FileEditor[] editors = editorManager.openFile(previewFile, true);
            for (FileEditor editor : editors) {
                if (editor instanceof ZenTaoPreviewFileEditor) {
                    ((ZenTaoPreviewFileEditor) editor).updateHtml(contentHtml);
                }
            }
            setStatus("Bug #" + detail.id + " 预览已在编辑区标签页打开");
        }

        private void submitWorkflow(String bugId, String action) {
            String title;
            switch (action) {
                case "assign": title = "指派"; break;
                case "confirm": title = "确认"; break;
                case "resolve": title = "解决"; break;
                case "close": title = "关闭"; break;
                case "activate": title = "激活"; break;
                default: title = action;
            }
            String assignee = "";
            String solution = "fixed";
            if (action.equals("assign")) {
                assignee = selectAssignee();
                if (assignee == null || assignee.isBlank()) return;
            } else if (action.equals("resolve")) {
                Object selected = javax.swing.JOptionPane.showInputDialog(
                        root,
                        "选择解决方案：",
                        "禅道助手 - 解决方案",
                        javax.swing.JOptionPane.QUESTION_MESSAGE,
                        null,
                        new String[] {"已解决", "重复 Bug", "无法重现", "延期处理", "不予解决", "设计如此", "外部原因"},
                        "已解决"
                );
                if (selected == null) return;
                switch (selected.toString()) {
                    case "重复 Bug": solution = "duplicate"; break;
                    case "无法重现": solution = "notReproducible"; break;
                    case "延期处理": solution = "postponed"; break;
                    case "不予解决": solution = "willNotFix"; break;
                    case "设计如此": solution = "byDesign"; break;
                    case "外部原因": solution = "external"; break;
                    default: solution = "fixed";
                }
            }
            String defaultComment = action.equals("resolve") ? "已修复，请验证。" : action.equals("activate") ? "重新激活，请继续处理。" : "";
            String comment = Messages.showInputDialog(project, title + " Bug #" + bugId + "，可填写备注：", "禅道助手 - " + title, null, defaultComment, null);
            if (comment == null) return;
            String finalAssignee = assignee;
            String finalSolution = solution;
            runAsync("正在" + title + " Bug #" + bugId + "...", () -> {
                client.submitWorkflow(bugId, action, finalAssignee, finalSolution, comment, members);
                return true;
            }, ignored -> {
                setStatus("Bug #" + bugId + " 已提交" + title);
                refreshBugs();
            });
        }

        private String selectAssignee() {
            if (members.isEmpty() && client.loggedIn()) {
                try {
                    List<Item> loaded = client.listMembers(selectedProjectId());
                    members.clear();
                    members.addAll(loaded);
                    populateMemberBox();
                    savePreferences();
                } catch (Exception error) {
                    Messages.showErrorDialog(project, "成员列表获取失败：" + readableError(rootCause(error)), "禅道助手");
                }
            }
            if (members.isEmpty()) {
                return Messages.showInputDialog(project, "成员列表为空，请输入要指派给的禅道账号：", "禅道助手 - 指派", null);
            }
            ComboBox<Item> assigneeBox = new ComboBox<>();
            assigneeBox.setEditable(true);
            for (Item member : members) assigneeBox.addItem(member);
            Object selected = javax.swing.JOptionPane.showInputDialog(
                    root,
                    "请选择要指派给的成员：",
                    "禅道助手 - 指派",
                    javax.swing.JOptionPane.QUESTION_MESSAGE,
                    null,
                    members.toArray(),
                    members.get(0)
            );
            if (selected == null) return null;
            if (selected instanceof Item) return ((Item) selected).id;
            String text = selected.toString().trim();
            return text.contains("|") ? text.substring(text.lastIndexOf('|') + 1).trim() : text;
        }

        private void sendToClaudeCode(String prompt) {
            putPromptOnClipboard(prompt);
            ActionManager manager = ActionManager.getInstance();
            for (String actionId : CLAUDE_ACTION_IDS) {
                try {
                    AnAction action = manager.getAction(actionId);
                    if (action != null) {
                        AnActionEvent event = AnActionEvent.createFromAnAction(
                                action,
                                null,
                                ActionPlaces.UNKNOWN,
                                DataManager.getInstance().getDataContext(root)
                        );
                        action.actionPerformed(event);
                        pastePromptIntoClaudeChat(prompt);
                        return;
                    }
                } catch (Throwable error) {
                    debugLog("claude-action-failed", actionId + ": " + readableError(rootCause(error)));
                }
            }
            Messages.showInfoMessage(project, "修复提示词已复制到剪贴板，请粘贴到 Claude Code with GUI。", "禅道助手");
        }

        private void pastePromptIntoClaudeChat(String prompt) {
            javax.swing.Timer timer = new javax.swing.Timer(1200, event -> {
                ((javax.swing.Timer)event.getSource()).stop();
                if (project.isDisposed()) return;
                putPromptOnClipboard(prompt);
                nativePastePrompt();
            });
            timer.setRepeats(false);
            timer.start();
        }

        private void putPromptOnClipboard(String prompt) {
            StringSelection selection = new StringSelection(prompt == null ? "" : prompt);
            try {
                CopyPasteManager.getInstance().setContents(selection);
            } catch (Exception ignored) {
                // Fall back to the system clipboard below.
            }
            try {
                java.awt.Toolkit.getDefaultToolkit().getSystemClipboard().setContents(selection, null);
            } catch (Exception ignored) {
                // IDEA's own clipboard is enough for manual paste fallback.
            }
        }

        private void nativePastePrompt() {
            try {
                java.awt.Robot robot = new java.awt.Robot();
                robot.setAutoDelay(40);
                int mask = java.awt.Toolkit.getDefaultToolkit().getMenuShortcutKeyMaskEx();
                int modifierKey = (mask & java.awt.event.InputEvent.META_DOWN_MASK) != 0 ? java.awt.event.KeyEvent.VK_META : java.awt.event.KeyEvent.VK_CONTROL;
                robot.keyPress(modifierKey);
                robot.keyPress(java.awt.event.KeyEvent.VK_V);
                robot.keyRelease(java.awt.event.KeyEvent.VK_V);
                robot.keyRelease(modifierKey);
            } catch (Exception error) {
                if (project.isDisposed()) return;
                Messages.showInfoMessage(project, "修复提示词已复制到剪贴板，但自动粘贴失败：" + error.getMessage(), "禅道助手");
            }
        }

        private void runKeepAlive() {
            if (project.isDisposed() || !client.loggedIn()) {
                return;
            }
            new SwingWorker<Boolean, Void>() {
                @Override
                protected Boolean doInBackground() {
                    try {
                        if (client.isSessionValid()) {
                            return true;
                        }
                        if (canRetryLogin()) {
                            client.login(serverField.getText(), accountField.getText(), new String(passwordField.getPassword()));
                            return true;
                        }
                        return false;
                    } catch (Exception error) {
                        debugLog("keepalive-failed", readableError(rootCause(error)));
                        return false;
                    }
                }

                @Override
                protected void done() {
                    if (project.isDisposed()) {
                        return;
                    }
                    try {
                        if (Boolean.TRUE.equals(get())) {
                            setStatus("禅道会话保活成功");
                            savePreferences();
                        } else {
                            setStatus("会话保活跳过：网络超时或禅道暂不可达，将在下次间隔重试");
                        }
                    } catch (Exception ignored) {
                        setStatus("会话保活跳过：网络超时或禅道暂不可达，将在下次间隔重试");
                    }
                }
            }.execute();
        }

        private <T> void runAsync(String status, ThrowingSupplier<T> supplier, java.util.function.Consumer<T> onSuccess) {
            if (project.isDisposed()) return;
            setLoading(true, status);
            new SwingWorker<T, Void>() {
                @Override
                protected T doInBackground() throws Exception {
                    try {
                        return supplier.get();
                    } catch (Exception error) {
                        if (!status.contains("登录") && isSessionExpiredError(error) && canRetryLogin()) {
                            client.login(serverField.getText(), accountField.getText(), new String(passwordField.getPassword()));
                            return supplier.get();
                        }
                        throw error;
                    }
                }

                @Override
                protected void done() {
                    if (project.isDisposed()) return;
                    try {
                        onSuccess.accept(get());
                    } catch (Throwable error) {
                        Throwable cause = rootCause(error);
                        setStatus("失败：" + briefStatusError(cause));
                        showErrorPopupWithOptOut("禅道助手", detailedError(cause));
                    } finally {
                        try {
                            setLoading(false, null);
                        } catch (Exception error) {
                            setStatus("失败：" + briefStatusError(rootCause(error)));
                        }
                    }
                }
            }.execute();
        }

        private void setLoading(boolean value, String status) {
            loading = value;
            if (status != null) setStatus(status);
            refreshButton.setEnabled(!value);
            clearImageCacheButton.setEnabled(!value);
            boolean hasAiTargets = false;
            try {
                hasAiTargets = !unresolved(filteredBugs()).isEmpty();
            } catch (Exception ignored) {
                // UI state recalculation should never hide the original async result.
            }
            aiFixAllButton.setEnabled(!value && hasAiTargets);
            loginButton.setEnabled(!value);
            projectBox.setEnabled(!value);
            memberBox.setEnabled(!value);
        }

        private void setStatus(String status) {
            if (project.isDisposed()) return;
            String text = status == null ? "未知错误" : status;
            String normalized = text.startsWith("状态：") || text.startsWith("失败：") ? text : "状态：" + text;
            statusArea.setText(normalized);
            debugLog("status", normalized);
        }

        private PropertiesComponent projectProperties() {
            if (project.isDisposed()) return null;
            try {
                return PropertiesComponent.getInstance(project);
            } catch (RuntimeException ignored) {
                return null;
            }
        }

        private static Throwable rootCause(Throwable error) {
            Throwable current = error;
            while (current instanceof java.util.concurrent.ExecutionException && current.getCause() != null) {
                current = current.getCause();
            }
            return current == null ? new IllegalStateException("未知错误") : current;
        }

        private static String readableError(Throwable error) {
            String message = error.getMessage();
            if (message == null || message.isBlank()) {
                return error.getClass().getName();
            }
            return error.getClass().getName() + ": " + message;
        }

        private void showDetailedError(String title, Throwable error) {
            Throwable cause = rootCause(error);
            String message = detailedError(cause);
            setStatus("失败：" + briefStatusError(cause));
            showErrorPopupWithOptOut(title, message);
        }

        private void showErrorPopupWithOptOut(String title, String message) {
            if (project.isDisposed() || isErrorPopupSuppressed()) return;
            String[] options = {"查看详情", "不再弹出", "关闭"};
            int choice = Messages.showDialog(
                    project,
                    "操作失败。可查看详情，或关闭后续失败弹框提醒。",
                    title,
                    options,
                    2,
                    Messages.getErrorIcon()
            );
            if (choice == 0) {
                Messages.showErrorDialog(project, message, title);
            } else if (choice == 1) {
                setErrorPopupSuppressed(true);
                setStatus("已关闭失败弹框提醒");
                Messages.showInfoMessage(project, "后续失败将仅显示在底部状态栏。", "禅道助手");
            }
        }

        private boolean isErrorPopupSuppressed() {
            PropertiesComponent properties = projectProperties();
            return properties != null && properties.getBoolean(SUPPRESS_ERROR_POPUP_KEY, false);
        }

        private void setErrorPopupSuppressed(boolean value) {
            PropertiesComponent properties = projectProperties();
            if (properties != null) {
                properties.setValue(SUPPRESS_ERROR_POPUP_KEY, value, false);
            }
        }

        private static String briefStatusError(Throwable error) {
            if (isTransientNetworkError(error)) {
                return "网络请求超时，请检查禅道地址或网络连接";
            }
            String message = error.getMessage();
            if (message == null || message.isBlank()) {
                return "操作失败";
            }
            message = message.trim();
            for (String marker : List.of("。当前状态", "，当前状态", "当前状态", "。响应摘要", "，响应摘要", "响应摘要")) {
                int index = message.indexOf(marker);
                if (index > 0) {
                    message = message.substring(0, index).replaceAll("[。；;，,\\s]+$", "");
                    break;
                }
            }
            if (message.length() > 60) {
                message = message.substring(0, 57) + "...";
            }
            return message.isBlank() ? "操作失败" : message;
        }

        private static String detailedError(Throwable error) {
            String message = readableError(error);
            String detail = formatErrorDetail(message);
            StringWriter writer = new StringWriter();
            error.printStackTrace(new PrintWriter(writer));
            String stack = writer.toString();
            String[] lines = stack.split("\\R");
            StringBuilder builder = new StringBuilder(detail);
            builder.append("\n\n堆栈摘要：");
            for (int i = 1; i < Math.min(lines.length, 8); i++) {
                builder.append("\n").append(lines[i].trim());
            }
            return builder.toString();
        }

        private static String formatErrorDetail(String value) {
            if (value == null || value.isBlank()) {
                return "未知错误";
            }
            Matcher alertMatcher = Pattern.compile("alert\\s*\\(\\s*['\"]([^'\"]+)['\"]", Pattern.CASE_INSENSITIVE).matcher(value);
            if (alertMatcher.find()) {
                return alertMatcher.group(1).replace("\\n", "\n").trim();
            }
            String cleaned = value
                    .replaceAll("(?is)<script\\b[\\s\\S]*?</script>", " ")
                    .replaceAll("(?is)<style\\b[\\s\\S]*?</style>", " ")
                    .replaceAll("<[^>]+>", " ")
                    .replaceAll("\\s+", " ")
                    .trim();
            if (cleaned.isBlank()) {
                return value.length() > 800 ? value.substring(0, 797) + "..." : value;
            }
            return cleaned.length() > 800 ? cleaned.substring(0, 797) + "..." : cleaned;
        }

        private void debugLog(String event, String message) {
            synchronized (debugEvents) {
                debugEvents.add("{\"time\":" + System.currentTimeMillis() + ",\"event\":\"" + event + "\",\"message\":\"" + escapeForLog(message) + "\"}");
                if (debugEvents.size() > 200) debugEvents.remove(0);
            }
        }

        private static String escapeForLog(String value) {
            return (value == null ? "" : value).replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
        }

        private boolean canRetryLogin() {
            return !accountField.getText().isBlank() && passwordField.getPassword().length > 0;
        }

        private static boolean isSessionExpiredError(Throwable error) {
            Throwable current = error;
            while (current != null) {
                String message = current.getMessage();
                if (message != null && (message.contains("登录已超时") || message.contains("重新登录"))) return true;
                current = current.getCause();
            }
            return false;
        }

        private static boolean isTransientNetworkError(Throwable error) {
            Throwable current = error;
            while (current != null) {
                if (current instanceof java.net.http.HttpTimeoutException
                        || current instanceof java.net.ConnectException
                        || current instanceof java.net.UnknownHostException) {
                    return true;
                }
                String message = current.getMessage();
                if (message != null && message.toLowerCase(Locale.ROOT).contains("timed out")) {
                    return true;
                }
                current = current.getCause();
            }
            return false;
        }

        private final class BugCard extends JPanel {
            private BugCard(BugSummary bug) {
                super(new BorderLayout(6, 6));
                setBorder(new CompoundBorder(new LineBorder(statusColor(bug.status), 1, true), JBUI.Borders.empty(8, 10)));
                setBackground(statusBackground(bug.status));
                setOpaque(true);
                setAlignmentX(LEFT_ALIGNMENT);
                setMaximumSize(new Dimension(Integer.MAX_VALUE, getPreferredSize().height + 96));
                JPanel title = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
                title.setOpaque(false);
                JLabel id = new JLabel("#" + bug.id);
                id.setForeground(new JBColor(new Color(33, 88, 192), new Color(112, 166, 255)));
                id.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 13));
                title.add(id);
                JLabel status = new JLabel(statusText(bug.status));
                status.setForeground(statusColor(bug.status));
                status.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 12));
                title.add(status);
                JLabel assigned = new JLabel("指派给：" + assigneeText(bug.assignedTo));
                assigned.setForeground(TEXT_SUB);
                title.add(assigned);
                if (!bug.priority.equals("unknown")) title.add(new JLabel(priorityText(bug.priority)));
                if (bug.hasVideo) title.add(new JLabel("🎬 视频"));
                add(title, BorderLayout.NORTH);
                JLabel summary = new JLabel("<html>" + html(bug.title) + "</html>");
                summary.setForeground(TEXT_MAIN);
                summary.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 14));
                add(summary, BorderLayout.CENTER);
                JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
                buttons.setOpaque(false);
                JButton preview = new JButton("预览");
                applyCardButton(preview, BTN_SECONDARY_BG);
                preview.addActionListener(event -> preview(bug.id));
                buttons.add(preview);
                if (!bug.status.equals("resolved") && !bug.status.equals("closed")) {
                    JButton assign = new JButton("指派");
                    applyCardButton(assign, new Color(57, 129, 255));
                    assign.addActionListener(event -> submitWorkflow(bug.id, "assign"));
                    buttons.add(assign);
                    if (!bug.confirmed) {
                        JButton confirm = new JButton("确认");
                        applyCardButton(confirm, new Color(35, 170, 135));
                        confirm.addActionListener(event -> submitWorkflow(bug.id, "confirm"));
                        buttons.add(confirm);
                    }
                    JButton resolve = new JButton("解决");
                    applyCardButton(resolve, BTN_SUCCESS_BG);
                    resolve.addActionListener(event -> submitWorkflow(bug.id, "resolve"));
                    buttons.add(resolve);
                    JButton close = new JButton("关闭");
                    applyCardButton(close, BTN_DANGER_BG);
                    close.addActionListener(event -> submitWorkflow(bug.id, "close"));
                    buttons.add(close);
                    JButton aiFix = new GradientButton("✦ AI修复");
                    applyCardButton(aiFix, BTN_PURPLE_BG);
                    aiFix.addActionListener(event -> aiFix(bug.id));
                    buttons.add(aiFix);
                } else if (bug.status.equals("resolved")) {
                    JButton activate = new JButton("激活");
                    applyCardButton(activate, new Color(235, 141, 49));
                    activate.addActionListener(event -> submitWorkflow(bug.id, "activate"));
                    buttons.add(activate);
                    JButton close = new JButton("关闭");
                    applyCardButton(close, BTN_DANGER_BG);
                    close.addActionListener(event -> submitWorkflow(bug.id, "close"));
                    buttons.add(close);
                } else {
                    JButton activate = new JButton("激活");
                    applyCardButton(activate, new Color(235, 141, 49));
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

        private static String previewHtml(BugDetail detail, String previewTitle) {
            return "<html><head><meta charset='UTF-8'><style>"
                    + ":root{color-scheme:dark;}"
                    + "body{margin:0;background:#1e1f22;color:#dfe1e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.65;padding:22px;}"
                    + ".page{max-width:1080px;margin:0 auto;}"
                    + ".hero,.section{background:#2b2d30;border:1px solid #45484d;border-radius:10px;margin:12px 0;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.25);}"
                    + ".bug-id{color:#6aa9ff;font-weight:700;font-size:13px;}"
                    + "h1{font-size:20px;line-height:1.45;margin:6px 0 0;color:#f0f2f5;}"
                    + ".section-title{font-weight:700;margin-bottom:8px;color:#f0f2f5;}"
                    + ".section-body{color:#dfe1e5;}"
                    + ".section-body *{max-width:100%;color:inherit!important;background:transparent!important;}"
                    + "img{max-width:100%;height:auto;border:1px solid #555b63;border-radius:8px;display:block;margin:8px 0;}"
                    + "a{color:#6aa9ff;}"
                    + ".video-list{display:grid;gap:10px;}.video-link{align-items:center;border:1px solid #555b63;border-radius:8px;color:#6aa9ff!important;display:inline-flex;font-weight:700;gap:8px;padding:10px 12px;text-decoration:none;width:fit-content;}.video-link:before{content:'▶';border:1px solid currentColor;border-radius:999px;display:inline-grid;height:26px;place-items:center;width:26px;}"
                    + "pre,code{background:#1b1c1f!important;color:#dfe1e5!important;border-radius:6px;padding:2px 4px;}"
                    + "</style></head><body><main class='page'><section class='hero'><div class='bug-id'>#" + html(detail.id) + "</div><h1>" + html(previewTitle) + "</h1></section>" + previewSection("描述", detail.descriptionHtml, detail.description) + previewSection("重现步骤", detail.reproduceStepsHtml, detail.reproduceSteps) + previewSection("期望", detail.expectedResultHtml, detail.expectedResult) + previewSection("实际结果", "", detail.actualResult) + videoSection(detail.attachments) + "</main></body></html>";
        }

        private static String previewSection(String title, String htmlValue, String textValue) {
            String body = htmlValue == null || htmlValue.isBlank() ? html(textValue == null || textValue.isBlank() ? "未提供" : textValue) : htmlValue;
            return "<section class='section'><div class='section-title'>" + html(title) + "</div><div class='section-body'>" + body + "</div></section>";
        }

        private static String videoSection(List<Attachment> attachments) {
            List<Attachment> videos = attachments == null ? List.of() : attachments.stream().filter(item -> "video".equals(item.kind)).collect(Collectors.toList());
            if (videos.isEmpty()) return "";
            List<String> links = new ArrayList<>();
            for (int i = 0; i < videos.size(); i++) {
                Attachment video = videos.get(i);
                links.add("<a class='video-link' href='" + html(video.url) + "'>播放视频 " + (i + 1) + (video.name == null || video.name.isBlank() ? "" : "：" + html(video.name)) + "</a>");
            }
            return "<section class='section'><div class='section-title'>视频附件</div><div class='section-body video-list'>" + String.join("", links) + "</div></section>";
        }

        private static boolean containsIgnoreCase(String value, String needle) {
            return value != null && needle != null && value.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
        }

        private static List<BugSummary> unresolved(List<BugSummary> values) {
            if (values == null) return List.of();
            return values.stream()
                    .filter(bug -> bug != null && !"resolved".equals(bug.status) && !"closed".equals(bug.status))
                    .collect(Collectors.toList());
        }

        private static Color statusColor(String status) {
            switch (status) {
                case "resolved": return new Color(31, 122, 58);
                case "closed": return Color.GRAY;
                case "active": return new Color(180, 35, 24);
                default: return new Color(161, 92, 0);
            }
        }

        private static Color statusBackground(String status) {
            switch (status) {
                case "resolved": return new JBColor(new Color(237, 248, 241), new Color(31, 50, 38));
                case "closed": return new JBColor(new Color(245, 245, 245), new Color(48, 48, 48));
                case "active": return new JBColor(new Color(255, 242, 241), new Color(55, 35, 35));
                default: return new JBColor(new Color(255, 248, 235), new Color(55, 45, 30));
            }
        }

        private static String statusText(String status) {
            switch (status) {
                case "active": return "激活";
                case "resolved": return "已解决";
                case "closed": return "已关闭";
                default: return "未知";
            }
        }

        private static String priorityText(String priority) {
            switch (priority) {
                case "high": return "高";
                case "medium": return "中";
                case "low": return "低";
                default: return "未知";
            }
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

        private static final class GradientButton extends JButton {
            private GradientButton(String text) {
                super(text);
                setContentAreaFilled(false);
                setOpaque(false);
            }

            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                GradientPaint paint = new GradientPaint(0, 0, new Color(124, 58, 237), getWidth() / 2f, getHeight(), new Color(6, 182, 212), true);
                g2.setPaint(paint);
                g2.fillRoundRect(0, 0, getWidth(), getHeight(), getHeight(), getHeight());
                g2.dispose();
                super.paintComponent(g);
            }
        }

        private static final class Item {
            final String id;
            final String name;

            Item(String id, String name) {
                this.id = id;
                this.name = name;
            }

            @Override
            public String toString() {
                return name.equals(id) ? id : name + " | " + id;
            }
        }

        private static final class BugSummary {
            final String id;
            final String title;
            final String priority;
            final String status;
            final String createdAt;
            final String assignedTo;
            final String openedBy;
            final boolean hasVideo;
            final boolean confirmed;

            BugSummary(String id, String title, String priority, String status, String createdAt, String assignedTo, String openedBy, boolean hasVideo, boolean confirmed) {
                this.id = id;
                this.title = title;
                this.priority = priority;
                this.status = status;
                this.createdAt = createdAt;
                this.assignedTo = assignedTo;
                this.openedBy = openedBy;
                this.hasVideo = hasVideo;
                this.confirmed = confirmed;
            }
        }

        private static final class Attachment {
            final String name;
            final String url;
            final String kind;

            Attachment(String name, String url, String kind) {
                this.name = name;
                this.url = url;
                this.kind = kind;
            }
        }

        private static final class BugDetail {
            final String id;
            final String title;
            final String priority;
            final String status;
            final String createdAt;
            final String assignedTo;
            final String openedBy;
            final String description;
            final String descriptionHtml;
            final String reproduceSteps;
            final String reproduceStepsHtml;
            final String expectedResult;
            final String expectedResultHtml;
            final String actualResult;
            final List<Attachment> attachments;
            final List<String> promptImages;

            BugDetail(String id, String title, String priority, String status, String createdAt, String assignedTo, String openedBy, String description, String descriptionHtml, String reproduceSteps, String reproduceStepsHtml, String expectedResult, String expectedResultHtml, String actualResult, List<Attachment> attachments, List<String> promptImages) {
                this.id = id;
                this.title = title;
                this.priority = priority;
                this.status = status;
                this.createdAt = createdAt;
                this.assignedTo = assignedTo;
                this.openedBy = openedBy;
                this.description = description;
                this.descriptionHtml = descriptionHtml;
                this.reproduceSteps = reproduceSteps;
                this.reproduceStepsHtml = reproduceStepsHtml;
                this.expectedResult = expectedResult;
                this.expectedResultHtml = expectedResultHtml;
                this.actualResult = actualResult;
                this.attachments = attachments;
                this.promptImages = promptImages;
            }
        }

        private static final class PromptBuilder {
            private static String build(BugDetail bug) {
                List<String> images = safePromptImages(bug).stream().limit(32).collect(Collectors.toList());
                String imageText = images.isEmpty() ? "未提供" : indexedImages(images, "");
                String description = textOrFallback(bug.description, bug.title);
                String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                return "【Bug修复任务】\nBug编号：" + bug.id + "\n\nBug描述：\n" + description + "\n\n复现步骤文本：\n" + reproduceText + "\n\n复现步骤图片：\n" + imageText + "\n\n说明：图片已由 IDEA 使用当前禅道登录态下载为本地文件，Claude Code 可直接读取上述本地路径，不需要访问禅道链接。\n\n请在当前代码仓库中修复以上 Bug。完成后请说明：\n1. 根因是什么\n2. 修改了哪些关键位置\n3. 如何验证修复";
            }

            private static String buildBatch(List<BugDetail> bugs) {
                List<String> sections = new ArrayList<>();
                for (int i = 0; i < bugs.size(); i++) {
                    BugDetail bug = bugs.get(i);
                    List<String> images = safePromptImages(bug).stream().limit(32).collect(Collectors.toList());
                    String imageText = images.isEmpty() ? "  未提供" : indexedImages(images, "  ");
                    String description = textOrFallback(bug.description, bug.title);
                    String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                    sections.add("## " + (i + 1) + ". Bug #" + bug.id + "\n\nBug描述：\n" + description + "\n\n复现步骤文本：\n" + reproduceText + "\n\n复现步骤图片：\n" + imageText);
                }
                return "【批量Bug修复任务】\n以下是当前列表中的未解决 Bug，请在当前代码仓库中依次分析并修复。\n\n" + String.join("\n\n---\n\n", sections) + "\n\n说明：图片已由 IDEA 使用当前禅道登录态下载为本地文件，Claude Code 可直接读取上述本地路径，不需要访问禅道链接。\n\n完成后请按 Bug 编号分别说明：\n1. 根因是什么\n2. 修改了哪些关键位置\n3. 如何验证修复";
            }

            private static List<String> safePromptImages(BugDetail bug) {
                return bug == null || bug.promptImages == null ? List.of() : bug.promptImages;
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
                    .connectTimeout(HTTP_CONNECT_TIMEOUT)
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();
            private String baseUrl = DEFAULT_SERVER;
            private String promptImageRoot = System.getProperty("user.dir");

            private void setPromptImageRoot(String value) {
                if (value != null && !value.isBlank()) promptImageRoot = value;
            }

            private void cleanupOldPromptImages(Duration maxAge) {
                if (maxAge == null) return;
                Path imageDir = Path.of(promptImageRoot, ".zentao-bug-assistant", "bug-images");
                if (!Files.isDirectory(imageDir)) return;
                long expireBefore = System.currentTimeMillis() - maxAge.toMillis();
                try (java.util.stream.Stream<Path> paths = Files.list(imageDir)) {
                    paths.filter(Files::isRegularFile).forEach(path -> {
                        try {
                            if (Files.getLastModifiedTime(path).toMillis() < expireBefore) {
                                Files.deleteIfExists(path);
                            }
                        } catch (Exception ignored) {
                            // Old image cleanup should not block AI prompt generation.
                        }
                    });
                } catch (Exception ignored) {
                    // Ignore cleanup failures; the next AI run can try again.
                }
            }

            private void clearPromptImages() {
                Path imageDir = Path.of(promptImageRoot, ".zentao-bug-assistant", "bug-images");
                if (!Files.isDirectory(imageDir)) return;
                try (java.util.stream.Stream<Path> paths = Files.list(imageDir)) {
                    paths.filter(Files::isRegularFile).forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (Exception ignored) {
                            // Cache cleanup should not block refreshing bugs.
                        }
                    });
                } catch (Exception ignored) {
                    // Ignore cleanup failures; refresh should still continue.
                }
            }

            private boolean loggedIn() {
                return !cookieJar.isEmpty();
            }

            private void restoreSession(String serverUrl, String cookies) {
                baseUrl = normalizeBaseUrl(serverUrl);
                cookieJar.clear();
                for (String part : (cookies == null ? "" : cookies).split(";")) {
                    String[] pair = part.trim().split("=", 2);
                    if (pair.length == 2 && !pair[0].isBlank() && !pair[1].isBlank()) {
                        cookieJar.put(pair[0], pair[1]);
                    }
                }
            }

            private String cookieHeader() {
                return cookieJar.entrySet().stream().map(entry -> entry.getKey() + "=" + entry.getValue()).reduce((a, b) -> a + "; " + b).orElse("");
            }

            private boolean isSessionValid() {
                try {
                    get("index.php", Map.of("m", "bug", "f", "browse"), true);
                    return true;
                } catch (Exception ignored) {
                    return false;
                }
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
                return result.values().stream().sorted((left, right) -> collator.compare(left.name, right.name)).collect(Collectors.toList());
            }

            private List<BugSummary> listBugs(String projectId, String scope, String assignee, String account) throws Exception {
                String assignedTo;
                switch (scope) {
                    case "all": assignedTo = ""; break;
                    case "member": assignedTo = assignee; break;
                    default: assignedTo = account;
                }
                for (Map<String, String> param : bugParams(projectId, assignedTo)) {
                    List<BugSummary> parsed = parseBugs(get("index.php", param, false), assignedTo);
                    if (!parsed.isEmpty()) return parsed;
                }
                return List.of();
            }

            private List<BugSummary> enrichVideoFlags(List<BugSummary> bugs) {
                List<BugSummary> result = new ArrayList<>();
                for (BugSummary bug : bugs) {
                    if (bug.hasVideo) {
                        result.add(bug);
                        continue;
                    }
                    boolean hasVideo = false;
                    try {
                        String html = get("index.php", Map.of("m", "bug", "f", "view", "bugID", bug.id), false);
                        hasVideo = parseAttachments(html).stream().anyMatch(item -> "video".equals(item.kind));
                    } catch (Exception ignored) {
                        // Keep list rendering fast and resilient if one detail page is not accessible.
                    }
                    result.add(new BugSummary(bug.id, bug.title, bug.priority, bug.status, bug.createdAt, bug.assignedTo, bug.openedBy, hasVideo, bug.confirmed));
                }
                return result;
            }

            private String collectBugAccessDiagnostic(String projectId, List<String> uiDebugEvents) throws Exception {
                StringBuilder builder = new StringBuilder();
                builder.append("{\n");
                builder.append("  \"projectId\": \"").append(escapeJson(projectId == null ? "" : projectId)).append("\",\n");
                builder.append("  \"baseUrl\": \"").append(escapeJson(baseUrl)).append("\",\n");
                builder.append("  \"hasCookie\": ").append(!cookieJar.isEmpty()).append(",\n");
                builder.append("  \"cookieNames\": \"").append(escapeJson(String.join(",", cookieJar.keySet()))).append("\",\n");
                builder.append("  \"attempts\": [\n");
                List<Map<String, String>> params = bugParams(projectId, "");
                for (int i = 0; i < params.size(); i++) {
                    Map<String, String> param = params.get(i);
                    try {
                        String html = get("index.php", param, false);
                        List<BugSummary> parsed = parseBugs(html, "");
                        String text = htmlText(html);
                        builder.append("    {\"params\":\"").append(escapeJson(param.toString())).append("\",\"length\":").append(html.length()).append(",\"parsedBugCount\":").append(parsed.size()).append(",\"preview\":\"").append(escapeJson(text.substring(0, Math.min(300, text.length())))).append("\"}");
                    } catch (Exception error) {
                        builder.append("    {\"params\":\"").append(escapeJson(param.toString())).append("\",\"error\":\"").append(escapeJson(error.getMessage())).append("\"}");
                    }
                    builder.append(i == params.size() - 1 ? "\n" : ",\n");
                }
                builder.append("  ],\n");
                builder.append("  \"uiDebugLog\": [\n");
                for (int i = 0; i < uiDebugEvents.size(); i++) {
                    builder.append("    ").append(uiDebugEvents.get(i));
                    builder.append(i == uiDebugEvents.size() - 1 ? "\n" : ",\n");
                }
                builder.append("  ]\n}");
                return builder.toString();
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
                title = stripBugIdPrefix(title, id);
                descriptionHtml = inlinePreviewImages(descriptionHtml);
                reproduceStepsHtml = inlinePreviewImages(reproduceStepsHtml);
                expectedResultHtml = inlinePreviewImages(expectedResultHtml);
                List<Attachment> attachments = parseAttachments(html);
                List<String> promptImages = preparePromptImages(id, descriptionHtml, reproduceStepsHtml, expectedResultHtml);
                String detailText = htmlText(html);
                String assignedTo = firstNonBlank(readDetailFieldHtml(html, "当前指派", "指派给"));
                String status = parseDetailStatusFromHtml(html);
                return new BugDetail(id, title.isBlank() ? "Bug #" + id : title, parsePriority(detailText), status, firstText(html, "\\d{4}-\\d{2}-\\d{2}"), assignedTo, "", description, descriptionHtml, htmlText(reproduceStepsHtml), reproduceStepsHtml, htmlText(expectedResultHtml), expectedResultHtml, htmlText(readSectionHtml(html, "实际结果|结果")), attachments, promptImages);
            }

            private String readDetailFieldHtml(String html, String... labels) {
                String raw = readSectionHtml(html, String.join("|", labels));
                return raw.isBlank() ? "" : normalizeDetailField(htmlText(raw));
            }

            private String parseDetailStatusFromHtml(String html) {
                String field = readDetailFieldHtml(html, "Bug状态");
                return field.isBlank() ? "unknown" : parseStatus(field);
            }

            private static String normalizeDetailField(String value) {
                if (value == null || value.isBlank()) return "";
                return value.replaceAll("\\s*于\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?", "").replaceAll("\\s+", " ").trim();
            }

            private static boolean matchesAssignee(String currentAssignee, String expectedAccount, List<Item> members) {
                if (expectedAccount == null || expectedAccount.isBlank()) return false;
                if (containsPerson(currentAssignee, expectedAccount)) return true;
                if (members == null) return false;
                for (Item member : members) {
                    if (!member.id.equalsIgnoreCase(expectedAccount) && !expectedAccount.equalsIgnoreCase(member.name)) continue;
                    if (containsPerson(currentAssignee, member.id) || containsPerson(currentAssignee, member.name)) return true;
                }
                return false;
            }

            private void submitWorkflow(String bugId, String action, String assignee, String solution, String comment, List<Item> members) throws Exception {
                String endpoint;
                switch (action) {
                    case "assign": endpoint = "assignTo"; break;
                    case "confirm": endpoint = "confirmBug"; break;
                    default: endpoint = action;
                }
                String formPath = "index.php?m=bug&f=" + endpoint + "&bugID=" + enc(bugId) + "&onlybody=yes";
                String formHtml = get("index.php", Map.of("m", "bug", "f", endpoint, "bugID", bugId, "onlybody", "yes"), false);
                String submitPath = readFormAction(formHtml, "index.php?m=bug&f=" + endpoint + "&bugID=" + enc(bugId));
                Map<String, String> form = readFormInputs(formHtml);
                String safeComment = comment == null ? "" : comment;
                String submittedAssignee = assignee;
                if (action.equals("assign")) {
                    submittedAssignee = resolveAssigneeForForm(assignee, members, formHtml);
                    // Match web submit payload: assignedTo/status/comment/uid.
                    Map<String, String> assignForm = new LinkedHashMap<>();
                    if (form.containsKey("status")) assignForm.put("status", form.get("status"));
                    if (form.containsKey("uid")) assignForm.put("uid", form.get("uid"));
                    assignForm.put("assignedTo", submittedAssignee);
                    assignForm.put("comment", safeComment);
                    form = assignForm;
                } else if (action.equals("resolve")) {
                    // Match web submit payload: resolution/duplicateBug/buildExecution/resolvedBuild/buildName/resolvedDate/assignedTo/status/comment/uid.
                    Map<String, String> resolveForm = new LinkedHashMap<>();
                    resolveForm.put("resolution", nonBlank(solution) != null ? solution : form.getOrDefault("resolution", "fixed"));
                    resolveForm.put("duplicateBug", form.getOrDefault("duplicateBug", "0"));
                    resolveForm.put("buildExecution", form.getOrDefault("buildExecution", "0"));
                    String resolvedBuild = nonBlank(form.get("resolvedBuild"));
                    if (resolvedBuild == null) {
                        resolvedBuild = readSelectFieldValue(formHtml, "resolvedBuild");
                    }
                    resolveForm.put("resolvedBuild", resolvedBuild == null || resolvedBuild.isBlank() ? "trunk" : resolvedBuild);
                    resolveForm.put("buildName", form.getOrDefault("buildName", ""));
                    resolveForm.put("resolvedDate", formatZenTaoDate(new java.util.Date()));
                    if (form.containsKey("assignedTo")) resolveForm.put("assignedTo", form.get("assignedTo"));
                    resolveForm.put("status", "resolved");
                    if (form.containsKey("uid")) resolveForm.put("uid", form.get("uid"));
                    resolveForm.put("comment", safeComment);
                    form = resolveForm;
                } else if (action.equals("confirm")) {
                    // Match web submit payload: assignedTo/type/pri/status/comment/uid.
                    Map<String, String> confirmForm = new LinkedHashMap<>();
                    for (String key : new String[] {"assignedTo", "type", "pri", "status", "uid"}) {
                        if (form.containsKey(key)) confirmForm.put(key, form.get(key));
                    }
                    confirmForm.put("comment", safeComment);
                    form = confirmForm;
                } else if (action.equals("activate")) {
                    // Match web submit payload: assignedTo/status/openedBuild[]/comment/uid.
                    Map<String, String> activateForm = new LinkedHashMap<>();
                    if (form.containsKey("assignedTo")) activateForm.put("assignedTo", form.get("assignedTo"));
                    activateForm.put("status", "active");
                    if (form.containsKey("openedBuild[]")) activateForm.put("openedBuild[]", form.get("openedBuild[]"));
                    if (form.containsKey("uid")) activateForm.put("uid", form.get("uid"));
                    activateForm.put("comment", safeComment);
                    form = activateForm;
                } else if (action.equals("close")) {
                    form.put("comment", safeComment);
                    form.put("remark", safeComment);
                    form.put("comment[]", safeComment);
                    form.putIfAbsent("mailto", "");
                    form.putIfAbsent("closedDate", formatZenTaoDate(new java.util.Date()));
                } else {
                    form.put("comment", safeComment);
                    form.put("remark", safeComment);
                    form.put("comment[]", safeComment);
                    form.putIfAbsent("mailto", "");
                }
                Map<String, String> submitParams = readActionParams(submitPath);
                if (!submitParams.containsKey("m") || !submitParams.containsKey("f")) {
                    submitParams = new LinkedHashMap<>();
                    submitParams.put("m", "bug");
                    submitParams.put("f", endpoint);
                    submitParams.put("bugID", bugId);
                } else if (!submitParams.containsKey("bugID") && !submitParams.containsKey("id")) {
                    submitParams = new LinkedHashMap<>(submitParams);
                    submitParams.put("bugID", bugId);
                }
                boolean ajax = !action.equals("assign") && !action.equals("confirm") && !action.equals("resolve") && !action.equals("activate");
                String body = post(submitPath, submitParams, form, formPath, ajax);
                String workflowError = extractWorkflowResponseError(body);
                if (workflowError != null) {
                    throw new IllegalStateException("禅道未接受该工作流提交：" + workflowError);
                }
                if (body.contains("\"result\":\"fail\"") || body.contains("error")) {
                    throw new IllegalStateException("禅道未接受该工作流提交，请在网页确认必填字段。");
                }
                verifyWorkflowEffect(bugId, action, assignee, submittedAssignee, body, members);
            }

            private void verifyWorkflowEffect(String bugId, String action, String assignee, String submittedAssignee, String responseBody, List<Item> members) throws Exception {
                BugDetail detail = getBugDetail(bugId);
                String currentStatus = detail.status;
                String currentAssignee = detail.assignedTo;
                boolean ok;
                switch (action) {
                    case "assign":
                        ok = matchesAssignee(currentAssignee, assignee, members) || matchesAssignee(currentAssignee, submittedAssignee, members);
                        break;
                    case "resolve":
                        ok = "resolved".equals(currentStatus);
                        break;
                    case "close":
                        ok = "closed".equals(currentStatus);
                        break;
                    case "activate":
                        ok = "active".equals(currentStatus);
                        break;
                    case "confirm":
                        ok = htmlText(get("index.php", Map.of("m", "bug", "f", "view", "bugID", bugId), false)).matches("(?is).*已确认.*|.*confirmed.*");
                        break;
                    default:
                        ok = true;
                }
                if (!ok) {
                    String hint = extractWorkflowResponseError(responseBody);
                    throw new IllegalStateException("禅道" + workflowActionName(action) + "后校验未生效。当前状态：" + statusText(currentStatus) + "，当前指派：" + (currentAssignee.isBlank() ? "未知" : normalizeDetailField(currentAssignee)) + "，目标指派：" + (assignee == null ? "" : assignee) + "，提交值：" + (submittedAssignee == null ? "" : submittedAssignee) + (hint == null ? "" : "。" + hint));
                }
            }

            private static String resolveAssigneeForForm(String requested, List<Item> members, String formHtml) {
                String value = requested == null ? "" : requested.trim();
                if (value.isBlank()) return "";
                Set<String> candidates = new LinkedHashSet<>(personAliases(value));
                if (members != null) {
                    for (Item member : members) {
                        if (member == null) continue;
                        Set<String> aliases = new LinkedHashSet<>(personAliases(member.id));
                        aliases.addAll(personAliases(member.name));
                        if (aliases.stream().anyMatch(alias -> candidates.stream().anyMatch(candidate -> candidate.equals(alias) || candidate.contains(alias) || alias.contains(candidate)))) {
                            candidates.addAll(aliases);
                        }
                    }
                }
                List<Item> options = parseAssigneeOptionsFromForm(formHtml);
                for (Item option : options) {
                    Set<String> aliases = new LinkedHashSet<>(personAliases(option.id));
                    aliases.addAll(personAliases(option.name));
                    boolean matched = aliases.stream().anyMatch(alias -> candidates.stream().anyMatch(candidate -> candidate.equals(alias) || candidate.contains(alias) || alias.contains(candidate)));
                    if (matched && option.id != null && !option.id.isBlank()) {
                        return option.id.trim();
                    }
                }
                return value;
            }

            private static List<Item> parseAssigneeOptionsFromForm(String html) {
                List<Item> result = new ArrayList<>();
                for (String select : matches(html, "<select\\b[^>]*\\bname=[\"']assignedTo(?:\\[\\])?[\"'][^>]*>[\\s\\S]*?</select>")) {
                    for (String option : matches(select, "<option\\b[^>]*>[\\s\\S]*?</option>")) {
                        String account = attr(option, "value").trim();
                        String name = htmlText(option).trim();
                        if (account.isBlank() || name.isBlank()) continue;
                        if (account.matches("(?i)all|0|closed|ditto") || name.matches("全部|所有|选择|空|无|closed")) continue;
                        result.add(new Item(account, name));
                    }
                }
                return result;
            }

            private static Map<String, String> readActionParams(String actionPath) {
                Map<String, String> result = new LinkedHashMap<>();
                if (actionPath == null || actionPath.isBlank()) return result;
                int queryIndex = actionPath.indexOf('?');
                if (queryIndex < 0 || queryIndex + 1 >= actionPath.length()) return result;
                String query = actionPath.substring(queryIndex + 1);
                for (String part : query.split("&")) {
                    if (part == null || part.isBlank()) continue;
                    int equalIndex = part.indexOf('=');
                    String rawKey = equalIndex >= 0 ? part.substring(0, equalIndex) : part;
                    String rawValue = equalIndex >= 0 ? part.substring(equalIndex + 1) : "";
                    String key = urlDecode(rawKey).trim();
                    if (!key.isBlank()) result.put(key, urlDecode(rawValue));
                }
                return result;
            }

            private List<BugSummary> parseBugs(String html, String assignedTo) {
                List<String> rows = matches(html, "<tr\\b[\\s\\S]*?</tr>");
                List<String> header = rows.stream().filter(row -> htmlText(row).matches(".*(Bug标题|标题|指派给|创建者|提交者).*")).findFirst().map(row -> matches(row, "<t[dh]\\b[\\s\\S]*?</t[dh]>").stream().map(ZenTaoClient::htmlText).collect(Collectors.toList())).orElse(List.of());
                int titleIndex = indexOf(header, "Bug标题|标题");
                int openedIndex = indexOf(header, "创建者|由谁创建|提交者");
                int createdIndex = indexOf(header, "创建日期|创建时间");
                int assignedIndex = indexOf(header, "指派给");
                int confirmedIndex = indexOf(header, "确认");
                List<BugSummary> result = new ArrayList<>();
                for (String row : rows) {
                    List<String> cells = matches(row, "<td\\b[\\s\\S]*?</td>").stream().map(ZenTaoClient::htmlText).collect(Collectors.toList());
                    String id = cells.stream().filter(cell -> cell.matches("#?\\d+")).findFirst().orElse("").replace("#", "");
                    if (id.isBlank()) continue;
                    String bugLink = matches(row, "<a\\b[^>]*href=[\"'][^\"']*(?:m=bug[^\"']*f=view|bug[-/]view|bug-view)[^\"']*[\"'][^>]*>[\\s\\S]*?</a>").stream().findFirst().orElse("");
                    String linkText = htmlText(bugLink);
                    String title = cell(cells, titleIndex);
                    if (title.isBlank() || title.matches("#?\\d+")) title = !linkText.isBlank() && !linkText.equals(id) && !linkText.matches("#?\\d+") ? linkText : cells.stream().filter(cell -> isLikelyBugTitleCell(cell, id)).findFirst().orElse("Bug #" + id);
                    boolean confirmed = isConfirmedText(cell(cells, confirmedIndex)) || cells.stream().anyMatch(ZenTaoClient::isConfirmedText);
                    result.add(new BugSummary(id, title, parsePriority(String.join(" ", cells)), parseStatus(String.join(" ", cells)), cell(cells, createdIndex), cell(cells, assignedIndex).isBlank() ? assignedTo : cell(cells, assignedIndex), cell(cells, openedIndex), looksLikeVideo(String.join(" ", cells)), confirmed));
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
                    List<String> cells = matches(row, "<td\\b[\\s\\S]*?</td>").stream().map(ZenTaoClient::htmlText).collect(Collectors.toList());
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
                HttpRequest.Builder builder = HttpRequest.newBuilder(buildUri(path, params)).timeout(HTTP_REQUEST_TIMEOUT).GET().header("User-Agent", "ZenTaoBugAssistant-IDEA/1.0.0").header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
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
                return post(path, Map.of(), form, "index.php?m=user&f=login", true);
            }

            private String post(String path, Map<String, String> form, String refererPath) throws Exception {
                return post(path, Map.of(), form, refererPath, true);
            }

            private String post(String path, Map<String, String> params, Map<String, String> form, String refererPath) throws Exception {
                return post(path, params, form, refererPath, true);
            }

            private String post(String path, Map<String, String> params, Map<String, String> form, String refererPath, boolean ajax) throws Exception {
                HttpRequest.Builder builder = HttpRequest.newBuilder(buildUri(path, params))
                        .timeout(HTTP_REQUEST_TIMEOUT)
                        .POST(HttpRequest.BodyPublishers.ofString(encode(form)))
                        .header("Accept", ajax ? "application/json, text/javascript, */*; q=0.01" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("Origin", baseUrl.replaceFirst("/$", ""))
                        .header("Referer", buildUri(refererPath, Map.of()).toString());
                if (ajax) {
                    builder.header("X-Requested-With", "XMLHttpRequest");
                }
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
                URI base = URI.create(baseUrl);
                URI uri = path.matches("(?i)^https?://.*") ? URI.create(path) : base.resolve(path);
                String value = uri.toString();
                return URI.create(value + (query.isBlank() ? "" : (value.contains("?") ? "&" : "?") + query));
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

            private static String nonBlank(String value) {
                if (value == null || value.isBlank()) return null;
                return value.trim();
            }

            private static String readSelectFieldValue(String html, String name) {
                for (String select : matches(html, "<select\\b[^>]*\\bname=[\"']" + Pattern.quote(name) + "[\"'][^>]*>[\\s\\S]*?</select>")) {
                    String fallback = "";
                    for (String option : matches(select, "<option\\b[^>]*>[\\s\\S]*?</option>")) {
                        String value = attr(option, "value");
                        if (value == null || value.isBlank()) continue;
                        if (option.matches("(?is).*\\sselected(?:\\s|=|>).*")) {
                            return value.trim();
                        }
                        if (fallback.isBlank()) fallback = value.trim();
                    }
                    if (!fallback.isBlank()) return fallback;
                }
                return null;
            }

            private static String extractWorkflowResponseError(String body) {
                if (body == null || body.isBlank()) return null;
                Matcher alertMatcher = Pattern.compile("alert\\s*\\(\\s*['\"]([^'\"]+)['\"]", Pattern.CASE_INSENSITIVE).matcher(body);
                if (alertMatcher.find()) {
                    return alertMatcher.group(1).replace("\\n", " ").replaceAll("\\s+", " ").trim();
                }
                if (body.contains("\"result\":\"fail\"")) {
                    return "禅道返回失败结果";
                }
                String text = htmlText(body);
                if (text.matches("(?is).*(不能为空|必填|请选择|失败|错误).*") && text.length() <= 240) {
                    return text;
                }
                return null;
            }

            private static Map<String, String> readFormInputs(String html) {
                Map<String, String> result = new LinkedHashMap<>();
                for (String input : matches(html, "<input\\b[^>]*>")) {
                    String name = attr(input, "name");
                    if (!name.isBlank()) result.put(name, attr(input, "value"));
                }
                for (String textarea : matches(html, "<textarea\\b[\\s\\S]*?</textarea>")) {
                    String name = attr(textarea, "name");
                    if (!name.isBlank()) result.putIfAbsent(name, htmlText(textarea));
                }
                for (String select : matches(html, "<select\\b[\\s\\S]*?</select>")) {
                    String name = attr(select, "name");
                    if (name.isBlank()) continue;
                    String value = "";
                    for (String option : matches(select, "<option\\b[^>]*>[\\s\\S]*?</option>")) {
                        if (option.matches("(?is).*\\sselected(?:\\s|=|>).*")) {
                            value = attr(option, "value");
                            break;
                        }
                        if (value.isBlank()) value = attr(option, "value");
                    }
                    result.putIfAbsent(name, value);
                }
                return result;
            }

            private static String readFormAction(String html, String fallback) {
                for (String form : matches(html, "<form\\b[^>]*>")) {
                    String action = attr(form, "action").replace("&amp;", "&").trim();
                    if (!action.isBlank()) return action;
                }
                return fallback;
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
                        case 'n':
                            builder.append('\n');
                            break;
                        case 'r':
                            builder.append('\r');
                            break;
                        case 't':
                            builder.append('\t');
                            break;
                        case 'b':
                            builder.append('\b');
                            break;
                        case 'f':
                            builder.append('\f');
                            break;
                        case '"':
                        case '\\':
                        case '/':
                            builder.append(next);
                            break;
                        case 'u':
                            if (i + 4 < value.length()) {
                                builder.append((char) Integer.parseInt(value.substring(i + 1, i + 5), 16));
                                i += 4;
                            }
                            break;
                        default:
                            builder.append(next);
                    }
                }
                return builder.toString();
            }

            private static String text(String value) {
                return value == null ? "" : value.replaceAll("\\s+", " ").trim();
            }

            private static String escapeJson(String value) {
                return (value == null ? "" : value)
                        .replace("\\", "\\\\")
                        .replace("\"", "\\\"")
                        .replace("\r", "\\r")
                        .replace("\n", "\\n");
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
                    int end = value.length();
                    if (result != null) end = Math.min(end, result.index);
                    if (expected != null) end = Math.min(end, expected.index);
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
                        .replaceAll("(?i)<img\\b((?:(?!src=)[^>])*?)\\sdata-original-src=[\"']([^\"']+)[\"']([^>]*?)>", "<img$1 src=\"$2\"$3>")
                        .replaceAll("(?i)\\s(src|href)=[\"']/(?!/)", " $1=\"" + baseUrl);
            }

            private String inlinePreviewImages(String value) {
                if (value == null || value.isBlank()) return value;
                String result = value;
                Matcher matcher = Pattern.compile("<img\\b[^>]*\\ssrc=[\"']([^\"']+)[\"'][^>]*>", Pattern.CASE_INSENSITIVE).matcher(value);
                while (matcher.find()) {
                    String tag = matcher.group();
                    String src = matcher.group(1);
                    if (src == null || src.isBlank() || src.matches("(?i)^data:.*")) continue;
                    try {
                        String dataUrl = downloadPreviewImage(src.replace("&amp;", "&"));
                        String nextTag = tag.replace(src, dataUrl);
                        if (!nextTag.matches("(?is)<img\\b[^>]*\\bdata-original-src=.*")) {
                            nextTag = nextTag.replaceFirst("(?i)<img\\b", "<img data-original-src=\"" + html(src) + "\"");
                        }
                        result = result.replace(tag, nextTag);
                    } catch (Exception ignored) {
                        // Keep the preview usable even if one image cannot be downloaded.
                    }
                }
                return result;
            }

            private List<String> preparePromptImages(String bugId, String... htmlValues) {
                Set<String> sources = new LinkedHashSet<>();
                for (String htmlValue : htmlValues) {
                    sources.addAll(PromptBuilder.extractReproduceStepImages(htmlValue));
                }
                List<String> result = new ArrayList<>();
                for (String source : sources) {
                    if (result.size() >= 32) break;
                    try {
                        String localPath = downloadPromptImage(bugId, source.replace("&amp;", "&"));
                        if (!localPath.isBlank()) result.add(localPath);
                    } catch (Exception ignored) {
                        // Keep the AI prompt useful even if a single image cannot be materialized.
                    }
                }
                return result;
            }

            private String downloadPromptImage(String bugId, String src) throws Exception {
                URI uri = resolveResourceUri(src);
                HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                        .timeout(HTTP_REQUEST_TIMEOUT)
                        .GET()
                        .header("User-Agent", "ZenTaoBugAssistant-IDEA/1.0.0")
                        .header("Accept", "image/*");
                addCookieHeader(builder);
                HttpResponse<byte[]> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
                mergeSetCookie(response);
                if (response.statusCode() < 200 || response.statusCode() >= 400) throw new IllegalStateException("图片请求失败：HTTP " + response.statusCode());
                String contentType = response.headers().firstValue("content-type").orElse("image/png");
                if (contentType.contains(";")) contentType = contentType.substring(0, contentType.indexOf(';')).trim();
                if (!contentType.toLowerCase(Locale.ROOT).startsWith("image/")) throw new IllegalStateException("不是图片响应：" + contentType);
                Path imageDir = Path.of(promptImageRoot, ".zentao-bug-assistant", "bug-images");
                Files.createDirectories(imageDir);
                String extension = imageExtension(contentType);
                String digest = sha1(src).substring(0, 12);
                Path file = imageDir.resolve("bug-" + safeFilePart(bugId) + "-" + digest + extension);
                Files.write(file, response.body());
                return file.toAbsolutePath().toString();
            }

            private String downloadPreviewImage(String src) throws Exception {
                URI uri = resolveResourceUri(src);
                HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                        .timeout(HTTP_REQUEST_TIMEOUT)
                        .GET()
                        .header("User-Agent", "ZenTaoBugAssistant-IDEA/1.0.0")
                        .header("Accept", "image/*,*/*;q=0.8");
                addCookieHeader(builder);
                HttpResponse<byte[]> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
                mergeSetCookie(response);
                if (response.statusCode() < 200 || response.statusCode() >= 400) throw new IllegalStateException("图片请求失败：HTTP " + response.statusCode());
                String contentType = response.headers().firstValue("content-type").orElse("image/png");
                if (contentType.contains(";")) contentType = contentType.substring(0, contentType.indexOf(';')).trim();
                if (!contentType.toLowerCase(Locale.ROOT).startsWith("image/")) contentType = "image/png";
                return "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(response.body());
            }

            private static String imageExtension(String contentType) {
                String value = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
                if (value.contains("jpeg") || value.contains("jpg")) return ".jpg";
                if (value.contains("gif")) return ".gif";
                if (value.contains("webp")) return ".webp";
                return ".png";
            }

            private static String safeFilePart(String value) {
                return (value == null ? "" : value).replaceAll("[^a-zA-Z0-9._-]", "_");
            }

            private static String sha1(String value) throws Exception {
                MessageDigest digest = MessageDigest.getInstance("SHA-1");
                byte[] bytes = digest.digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
                StringBuilder builder = new StringBuilder();
                for (byte item : bytes) builder.append(String.format("%02x", item));
                return builder.toString();
            }

            private URI resolveResourceUri(String src) {
                if (src.matches("(?i)^https?://.*")) return URI.create(src);
                return URI.create(baseUrl).resolve(src);
            }

            private static String meaningfulTitle(String html, String id) {
                for (String item : matches(html, "<div\\b[^>]*class=[\"'][^\"']*page-title[^\"']*[\"'][^>]*>[\\s\\S]*?</div>|<h1\\b[\\s\\S]*?</h1>|<[^>]*class=[\"'][^\"']*(?:detail-title|bug-title)[^\"']*[\"'][^>]*>[\\s\\S]*?</[^>]+>")) {
                    String text = stripBugIdPrefix(htmlText(item), id);
                    if (!text.isBlank() && !text.equals(id) && !text.matches("#?\\d+") && text.length() > 4) return text;
                }
                return "";
            }

            private static String stripBugIdPrefix(String value, String id) {
                return (value == null ? "" : value)
                        .replaceFirst("(?i)^(?:BUG\\s*)?#?" + Pattern.quote(id) + "(?:\\s+|\\s*[-:：#]\\s*)", "")
                        .replaceFirst("(?i)^(?:BUG\\s*)?#?" + Pattern.quote(id) + "$", "")
                        .trim();
            }

            private static String readDetailField(String text, String label) {
                Matcher matcher = Pattern.compile(Pattern.quote(label) + "\\s*[:：]?\\s*([^\\n\\r]+)", Pattern.CASE_INSENSITIVE).matcher(text == null ? "" : text);
                return matcher.find() ? matcher.group(1).trim() : "";
            }

            private static String parseDetailStatus(String text) {
                String field = readDetailField(text, "Bug状态");
                return field.isBlank() ? parseStatus(text) : parseStatus(field);
            }

            private static String firstNonBlank(String... values) {
                for (String value : values) {
                    if (value != null && !value.isBlank()) return value;
                }
                return "";
            }

            private static boolean containsPerson(String value, String expected) {
                if (expected == null || expected.isBlank()) return false;
                Set<String> actual = new LinkedHashSet<>(personAliases(value));
                Set<String> target = new LinkedHashSet<>(personAliases(expected));
                return target.stream().anyMatch(item -> actual.stream().anyMatch(candidate -> candidate.equals(item) || candidate.contains(item) || item.contains(candidate)));
            }

            private static String workflowActionName(String action) {
                switch (action) {
                    case "assign": return "指派";
                    case "confirm": return "确认";
                    case "resolve": return "解决";
                    case "close": return "关闭";
                    case "activate": return "激活";
                    default: return action;
                }
            }

            private static final class DetailSections {
                final String descriptionHtml;
                final String reproduceStepsHtml;
                final String expectedResultHtml;

                DetailSections(String descriptionHtml, String reproduceStepsHtml, String expectedResultHtml) {
                    this.descriptionHtml = descriptionHtml;
                    this.reproduceStepsHtml = reproduceStepsHtml;
                    this.expectedResultHtml = expectedResultHtml;
                }
            }

            private static final class Marker {
                final int index;
                final int end;

                Marker(int index, int end) {
                    this.index = index;
                    this.end = end;
                }
            }

            private static final class MemberSource {
                final String path;
                final Map<String, String> params;
                final boolean ajax;

                MemberSource(String path, Map<String, String> params, boolean ajax) {
                    this.path = path;
                    this.params = params;
                    this.ajax = ajax;
                }
            }

            private List<Attachment> parseAttachments(String html) {
                List<Attachment> result = new ArrayList<>();
                for (String link : matches(html, "<a\\b[^>]*href=[\"'][^\"']*(?:file|download)[^\"']*[\"'][^>]*>[\\s\\S]*?</a>")) {
                    String name = htmlText(link);
                    String url = attr(link, "href");
                    if (url != null && !url.isBlank()) url = resolveResourceUri(url.replace("&amp;", "&")).toString();
                    result.add(new Attachment(name, url, attachmentKind(name, url)));
                }
                return result;
            }

            private static String attachmentKind(String name, String url) {
                String value = ((name == null ? "" : name) + " " + (url == null ? "" : url)).toLowerCase(Locale.ROOT);
                if (value.matches("(?s).*\\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#\\s].*)?$")) return "image";
                if (looksLikeVideo(value)) return "video";
                return "file";
            }

            private static boolean looksLikeVideo(String value) {
                String text = value == null ? "" : value.toLowerCase(Locale.ROOT);
                return text.matches("(?s).*\\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv)(?:[?#\\s].*)?$");
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

            private static boolean isConfirmedText(String value) {
                if (value == null || value.isBlank()) return false;
                return value.matches("(?is).*(已确认|confirmed).*");
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
