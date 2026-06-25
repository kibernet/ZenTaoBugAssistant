package com.zentao.bugassistant;

import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.credentialStore.Credentials;
import com.intellij.ide.DataManager;
import com.intellij.ide.passwordSafe.PasswordSafe;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionPlaces;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.roots.ProjectFileIndex;
import com.intellij.openapi.ui.ComboBox;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBPasswordField;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.components.JBTextField;
import com.intellij.ui.content.Content;
import com.intellij.util.ui.JBUI;
import java.awt.BasicStroke;
import java.awt.Component;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Cursor;
import java.awt.Font;
import java.awt.FlowLayout;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Image;
import java.awt.Dimension;
import java.awt.LinearGradientPaint;
import java.awt.RenderingHints;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.datatransfer.StringSelection;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.SocketTimeoutException;
import java.net.http.HttpConnectTimeoutException;
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
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.event.KeyAdapter;
import java.awt.event.KeyEvent;
import javax.swing.Icon;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.ImageIcon;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.event.PopupMenuEvent;
import javax.swing.event.PopupMenuListener;
import javax.swing.text.JTextComponent;
import javax.swing.border.CompoundBorder;
import javax.swing.border.EmptyBorder;
import javax.swing.border.LineBorder;
import org.jetbrains.annotations.NotNull;

public class ZenTaoBugAssistantToolWindowFactory implements ToolWindowFactory {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        ZenTaoBugAssistantPanel panel = new ZenTaoBugAssistantPanel(project, toolWindow);
        Content content = ZenTaoPlatformCompat.contentFactory().createContent(panel.root, "", false);
        toolWindow.getContentManager().addContent(content);
    }

    static List<Map<String, String>> parseBugListForTest(String html) {
        ZenTaoBugAssistantPanel.ZenTaoClient client = new ZenTaoBugAssistantPanel.ZenTaoClient();
        List<Map<String, String>> result = new ArrayList<>();
        for (ZenTaoBugAssistantPanel.BugSummary bug : client.parseBugs(html, "")) {
            Map<String, String> item = new LinkedHashMap<>();
            item.put("id", bug.id);
            item.put("title", bug.title);
            item.put("priority", bug.priority);
            item.put("status", bug.status);
            item.put("assignedTo", bug.assignedTo);
            item.put("openedBy", bug.openedBy);
            item.put("confirmed", String.valueOf(bug.confirmed));
            result.add(item);
        }
        return result;
    }

    static Map<String, Integer> parseBugPagerForTest(String html) {
        ZenTaoBugAssistantPanel.ZenTaoClient.BugListPager pager = ZenTaoBugAssistantPanel.ZenTaoClient.parseBugListPager(html);
        Map<String, Integer> result = new LinkedHashMap<>();
        if (pager == null) return result;
        result.put("recTotal", pager.recTotal);
        result.put("recPerPage", pager.recPerPage);
        result.put("pageID", pager.pageID);
        result.put("pageTotal", pager.pageTotal);
        return result;
    }

    static List<Map<String, String>> bugParamsForTest(String projectId) {
        return new ZenTaoBugAssistantPanel.ZenTaoClient().bugParams(projectId, "");
    }

    static String buildPromptForTest() {
        ZenTaoBugAssistantPanel.BugDetail detail = new ZenTaoBugAssistantPanel.BugDetail(
                "183099",
                "渔场激光技能触发斩杀时索敌结束",
                "medium",
                "active",
                "06-02 10:55",
                "王强强",
                "石挺现",
                "触发斩杀时索敌时间结束，没有用激光但是在发炮。",
                "",
                "进入渔场，触发激光技能斩杀。",
                "",
                "技能表现和发炮状态一致。",
                "",
                "没有用激光但是在发炮。",
                List.of(
                        new ZenTaoBugAssistantPanel.Attachment("repro.mp4", "http://zentao.example/file.mp4", "video"),
                        new ZenTaoBugAssistantPanel.Attachment("screen.png", "C:/tmp/screen.png", "image")
                ),
                List.of("C:/tmp/screen.png")
        );
        return ZenTaoBugAssistantPanel.PromptBuilder.build(detail);
    }

    private static final class ZenTaoBugAssistantPanel {
        private static final String DEFAULT_SERVER = "http://zentao.yuwan-game.com:8088/";
        private static final String LEGACY_PLACEHOLDER_SERVER = "http://your-zentao-server";
        private static final String MEMBER_SEARCH_PLACEHOLDER = "搜索成员姓名或账号，留空显示全部成员";
        private static final String REPAIR_MODE_CHAT = "chat";
        private static final String REPAIR_MODE_CLI = "cli";
        private static final String PASSWORD_MASK = "********";
        private static final int PAGE_SIZE = 20;
        private static final int DEFAULT_KEEP_ALIVE_MINUTES = 5;
        private static final Duration HTTP_CONNECT_TIMEOUT = Duration.ofSeconds(15);
        private static final Duration HTTP_REQUEST_TIMEOUT = Duration.ofSeconds(45);
        private static final int MAX_EDITOR_WORKSPACE_FILES = 20000;
        private static final int MAX_CANDIDATE_EVIDENCE_FILES = 48;
        private static final long MAX_CANDIDATE_EVIDENCE_BYTES = 512L * 1024L;
        private static final List<String> FILTER_KEYS = List.of("assignedToMe", "unresolved", "resolved", "closed");
        private static final List<String> DEFAULT_FILTER_KEYS = List.of("unresolved", "resolved", "closed");
        private static final String OFFICIAL_CLAUDE_TERMINAL_ACTION_ID = "com.anthropic.code.plugin.actions.OpenClaudeInTerminalAction";
        private static final List<String> CLAUDE_ACTION_IDS = List.of("ClaudeCode.Chat", "claude-code.chat", "claudeCode.chat", "ClaudeCode.NewChat", "claude-code.newChat", "claudeCode.newChat", "ClaudeCode.Open", "claude-code.open", "claudeCode.open");
        private static final List<String> TERMINAL_ACTION_IDS = List.of("ActivateTerminalToolWindow", "Terminal.OpenInTerminal", "Terminal.OpenInTerminalProject");
        private static final String SUPPRESS_ERROR_POPUP_KEY = "zentao.idea.suppressErrorPopup";
        private static final Set<String> COMMON_BUG_TERMS = Set.of(
                "bug",
                "issue",
                "error",
                "null",
                "undefined",
                "true",
                "false",
                "http",
                "https",
                "image",
                "video",
                "button",
                "click",
                "page",
                "测试",
                "测试用",
                "显示",
                "问题",
                "页面",
                "时候",
                "没有",
                "需要",
                "后台",
                "回来"
        );

        private final Project project;
        private final ToolWindow toolWindow;
        private final JPanel root = new JPanel(new BorderLayout(8, 8));
        private final JBTextField serverField = new JBTextField(DEFAULT_SERVER);
        private final JBTextField accountField = new JBTextField();
        private final JBPasswordField passwordField = new JBPasswordField();
        private final JCheckBox autoLoginBox = new JCheckBox("自动登录", true);
        private final SolidButton loginButton = solidButton("登录", BTN_PRIMARY_BG, ARC_DEFAULT);
        private final PillBadge loginState = new PillBadge("未登录");
        private final ComboBox<Item> projectBox = new ComboBox<>();
        private final ComboBox<Item> memberBox = new ComboBox<>();
        private final JPanel memberWrap = new JPanel(new BorderLayout(6, 0));
        private final Map<String, JCheckBox> filterChecks = new LinkedHashMap<>();
        private final SolidButton refreshButton = solidButton("刷新", BTN_PRIMARY_BG, ARC_DEFAULT);
        private final GradientButton aiFixAllButton = new GradientButton("AI一键修复", true, true);
        private final SolidButton clearImageCacheButton = solidButton("清理缓存", BTN_PRIMARY_BG, ARC_PILL);
        private final ComboBox<String> aiEngineBox = new ComboBox<>(new String[] {"Claude"});
        private final ComboBox<String> repairModeBox = new ComboBox<>(new String[] {"Chat", "CLI"});
        private final JPanel bugListPanel = new JPanel();
        private final JLabel pageLabel = new JLabel("0/0");
        private final SolidButton firstPageButton = solidButton("|<", BTN_SECONDARY_BG, ARC_DEFAULT, 3, 8);
        private final SolidButton prevPageButton = solidButton("<", BTN_SECONDARY_BG, ARC_DEFAULT, 3, 8);
        private final SolidButton nextPageButton = solidButton(">", BTN_SECONDARY_BG, ARC_DEFAULT, 3, 8);
        private final SolidButton lastPageButton = solidButton(">|", BTN_SECONDARY_BG, ARC_DEFAULT, 3, 8);
        private final JTextArea statusArea = new JTextArea("状态：就绪");
        private final List<String> debugEvents = new ArrayList<>();
        private final ZenTaoClient client = new ZenTaoClient();
        private final List<BugSummary> bugs = new ArrayList<>();
        private final List<Item> projects = new ArrayList<>();
        private final List<Item> members = new ArrayList<>();
        private final Map<String, List<Item>> membersByProject = new LinkedHashMap<>();
        private String membersLoadedForProjectId = "";
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
        private static final int ARC_PILL = -1;
        private static final int ARC_DEFAULT = 8;
        private static final Font BUTTON_FONT = new Font("Microsoft YaHei UI", Font.BOLD, 12);
        private static final Font CHIP_FONT = new Font("Microsoft YaHei UI", Font.PLAIN, 12);
        private static final Color BTN_PRIMARY_BG = new Color(37, 99, 168);
        private static final Color BTN_PREVIEW_BG = new Color(75, 100, 122);
        private static final Color BTN_ASSIGN_BG = new Color(37, 99, 168);
        private static final Color BTN_CONFIRM_BG = new Color(8, 124, 133);
        private static final Color BTN_RESOLVE_BG = new Color(47, 125, 70);
        private static final Color BTN_CLOSE_BG = new Color(95, 99, 104);
        private static final Color BTN_ACTIVATE_BG = new Color(182, 106, 22);
        private static final Color BTN_SECONDARY_BG = BTN_CLOSE_BG;
        private static final Color BTN_TEXT = Color.WHITE;
        private static final Color ACCENT_BLUE = new Color(59, 130, 246);
        private static final Color PANEL_BORDER = new JBColor(new Color(224, 230, 240), new Color(66, 71, 80));
        private static final Color FILTER_CHIP_BG = new JBColor(new Color(248, 250, 252), new Color(40, 43, 49));

        private ZenTaoBugAssistantPanel(Project project, ToolWindow toolWindow) {
            this.project = project;
            this.toolWindow = toolWindow;
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
                updateLoginState(true);
                startSessionKeepAlive();
                loadProjectsAfterLogin(false);
            } else {
                updateLoginState(false);
            }
            if (!client.loggedIn() && autoLoginBox.isSelected() && canRetryLogin()) {
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
            addRow(top, c, 2, "禅道账号", buildCredentialRow());
            JPanel loginRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 0));
            loginRow.setOpaque(false);
            loginRow.add(autoLoginBox);
            loginRow.add(loginButton);
            loginRow.add(loginState);
            c.gridx = 0;
            c.gridy = 3;
            c.gridwidth = 2;
            c.weightx = 1;
            c.fill = GridBagConstraints.HORIZONTAL;
            c.anchor = GridBagConstraints.WEST;
            top.add(loginRow, c);
            c.gridwidth = 1;
            c.anchor = GridBagConstraints.CENTER;

            JPanel projectRow = new JPanel(new BorderLayout(6, 0));
            SolidButton refreshProjects = solidButton("刷新", BTN_PRIMARY_BG, ARC_DEFAULT);
            refreshProjects.addActionListener(event -> loadProjects(true));
            projectRow.add(projectBox, BorderLayout.CENTER);
            projectRow.add(refreshProjects, BorderLayout.EAST);
            addRow(top, c, 4, "项目", projectRow);

            memberBox.setEditable(true);
            memberBox.setMaximumRowCount(12);
            memberWrap.removeAll();
            memberWrap.setOpaque(false);
            memberWrap.add(memberBox, BorderLayout.CENTER);
            SolidButton refreshMembers = solidButton("刷新", BTN_PRIMARY_BG, ARC_DEFAULT);
            refreshMembers.addActionListener(event -> loadMembers(true));
            memberWrap.add(refreshMembers, BorderLayout.EAST);
            addRow(top, c, 5, "成员", memberWrap);

            JPanel filters = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            filters.setOpaque(false);
            addFilter(filters, "assignedToMe", "仅看我的");
            addFilter(filters, "unresolved", "未解决");
            addFilter(filters, "resolved", "已解决");
            addFilter(filters, "closed", "已关闭");
            addRow(top, c, 6, "分类", filters);
            return top;
        }

        private JPanel buildCredentialRow() {
            JPanel row = new JPanel(new GridBagLayout());
            row.setOpaque(false);
            GridBagConstraints cc = new GridBagConstraints();
            cc.insets = JBUI.insets(0, 0, 0, 8);
            cc.gridy = 0;
            cc.gridx = 0;
            cc.weightx = 0;
            row.add(new JLabel("账号"), cc);
            cc.gridx = 1;
            cc.weightx = 1;
            cc.fill = GridBagConstraints.HORIZONTAL;
            row.add(accountField, cc);
            cc.gridx = 2;
            cc.weightx = 0;
            cc.fill = GridBagConstraints.NONE;
            row.add(new JLabel("密码"), cc);
            cc.gridx = 3;
            cc.weightx = 1;
            cc.fill = GridBagConstraints.HORIZONTAL;
            row.add(passwordField, cc);
            return row;
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
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            bar.setOpaque(true);
            bar.setBackground(TOOLBAR_BG);
            bar.setBorder(new CompoundBorder(new LineBorder(new JBColor(new Color(224, 230, 240), new Color(66, 71, 80)), 1, true), JBUI.Borders.empty(8, 10)));
            bar.add(refreshButton);
            bar.add(aiFixAllButton);
            bar.add(clearImageCacheButton);
            aiEngineBox.setPrototypeDisplayValue("Claude");
            aiEngineBox.setEnabled(true);
            bar.add(aiEngineBox);
            repairModeBox.setPrototypeDisplayValue("CLI");
            setRepairMode(REPAIR_MODE_CLI);
            repairModeBox.setEnabled(false);
            bar.add(repairModeBox);
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
            pageLabel.setForeground(TEXT_MAIN);
            pager.add(firstPageButton);
            pager.add(prevPageButton);
            pager.add(pageLabel);
            pager.add(nextPageButton);
            pager.add(lastPageButton);
            center.add(pager, BorderLayout.SOUTH);
            return center;
        }

        private static SolidButton solidButton(String text, Color background, int arc) {
            return solidButton(text, background, arc, 4, 10);
        }

        private static SolidButton solidButton(String text, Color background, int arc, int padY, int padX) {
            SolidButton button = new SolidButton(text, background, arc);
            button.setBorder(new EmptyBorder(padY, padX, padY, padX));
            return button;
        }

        private static void onPress(JButton button, Runnable action) {
            button.addMouseListener(new MouseAdapter() {
                @Override
                public void mousePressed(MouseEvent e) {
                    if (SwingUtilities.isLeftMouseButton(e) && button.isEnabled()) {
                        action.run();
                    }
                }
            });
        }

        private static Color brighten(Color color, float factor) {
            return new Color(
                    Math.min(255, Math.round(color.getRed() * factor)),
                    Math.min(255, Math.round(color.getGreen() * factor)),
                    Math.min(255, Math.round(color.getBlue() * factor)),
                    color.getAlpha());
        }

        private static Color darken(Color color, float factor) {
            return new Color(
                    Math.max(0, Math.round(color.getRed() * factor)),
                    Math.max(0, Math.round(color.getGreen() * factor)),
                    Math.max(0, Math.round(color.getBlue() * factor)),
                    color.getAlpha());
        }

        private static Color withAlpha(Color color, int alpha) {
            return new Color(color.getRed(), color.getGreen(), color.getBlue(), Math.max(0, Math.min(255, alpha)));
        }

        private static Color mixColors(Color base, Color accent, float accentWeight) {
            float baseWeight = 1f - accentWeight;
            return new Color(
                    Math.round(base.getRed() * baseWeight + accent.getRed() * accentWeight),
                    Math.round(base.getGreen() * baseWeight + accent.getGreen() * accentWeight),
                    Math.round(base.getBlue() * baseWeight + accent.getBlue() * accentWeight));
        }

        private static void setupPaintQuality(Graphics2D g2) {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_LCD_HRGB);
            g2.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g2.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        }

        private static int cornerRadius(int arc, int height) {
            return arc < 0 ? height : arc;
        }

        private static void paintChipSurface(
                Graphics2D g2, int x, int y, int w, int h, int radius, boolean selected, boolean hover, Color accent) {
            g2.setColor(selected ? mixColors(FILTER_CHIP_BG, accent, 0.14f) : FILTER_CHIP_BG);
            g2.fillRoundRect(x, y, w, h, radius, radius);
            g2.setColor(selected ? withAlpha(accent, 190) : withAlpha(PANEL_BORDER, hover ? 200 : 160));
            g2.setStroke(new BasicStroke(1f));
            g2.drawRoundRect(x, y, w - 1, h - 1, radius, radius);
        }

        private void addRow(JPanel panel, GridBagConstraints c, int y, String label, JComponent component) {
            c.gridy = y;
            c.gridx = 0;
            c.weightx = 0;
            c.anchor = GridBagConstraints.WEST;
            panel.add(new JLabel(label), c);
            c.gridx = 1;
            c.weightx = 1;
            c.fill = GridBagConstraints.HORIZONTAL;
            panel.add(component, c);
        }

        private static String normalizeServerUrl(String value) {
            if (value == null || value.isBlank()) {
                return DEFAULT_SERVER;
            }
            String trimmed = value.trim();
            if (isPlaceholderServerUrl(trimmed)) {
                return DEFAULT_SERVER;
            }
            return trimmed.endsWith("/") ? trimmed : trimmed + "/";
        }

        private static boolean isPlaceholderServerUrl(String value) {
            return LEGACY_PLACEHOLDER_SERVER.equalsIgnoreCase(value)
                    || (LEGACY_PLACEHOLDER_SERVER + "/").equalsIgnoreCase(value);
        }

        private void addFilter(JPanel filters, String key, String text) {
            JCheckBox box = new JCheckBox(text, !"assignedToMe".equals(key));
            box.setOpaque(false);
            box.setForeground(TEXT_SUB);
            box.setFont(new Font("Microsoft YaHei UI", Font.PLAIN, 12));
            box.addActionListener(event -> {
                if (hydratingFilters) return;
                if ("assignedToMe".equals(key) && box.isSelected() && !preferredMemberAccount.isBlank()) {
                    commitMemberFilter("", "");
                    return;
                }
                refreshAllFilterState();
                savePreferences();
                currentPage = 1;
                renderBugs();
            });
            filterChecks.put(key, box);
            filters.add(wrapFilterChip(box));
        }

        private JPanel wrapFilterChip(JCheckBox box) {
            JPanel chip = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0)) {
                private boolean hovered;

                {
                    setOpaque(false);
                    setBorder(new EmptyBorder(1, 2, 3, 2));
                    addMouseListener(new MouseAdapter() {
                        @Override
                        public void mouseEntered(MouseEvent event) {
                            hovered = true;
                            repaint();
                        }

                        @Override
                        public void mouseExited(MouseEvent event) {
                            hovered = false;
                            repaint();
                        }
                    });
                }

                @Override
                protected void paintComponent(Graphics g) {
                    Graphics2D g2 = (Graphics2D) g.create();
                    setupPaintQuality(g2);
                    int radius = getHeight();
                    if (!box.isEnabled()) {
                        g2.setColor(FILTER_CHIP_BG);
                        g2.fillRoundRect(0, 0, getWidth(), getHeight() - 1, radius, radius);
                        g2.setColor(withAlpha(PANEL_BORDER, 120));
                        g2.setStroke(new BasicStroke(1f));
                        g2.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 1, radius, radius);
                    } else {
                        paintChipSurface(g2, 0, 0, getWidth(), getHeight() - 1, radius, box.isSelected(), hovered, ACCENT_BLUE);
                    }
                    g2.dispose();
                    super.paintComponent(g);
                }
            };
            box.setOpaque(false);
            box.setForeground(box.isSelected() ? TEXT_MAIN : TEXT_SUB);
            box.setFont(CHIP_FONT);
            box.addActionListener(event -> {
                box.setForeground(box.isSelected() ? TEXT_MAIN : TEXT_SUB);
                chip.repaint();
            });
            chip.add(box);
            return chip;
        }

        private void bindEvents() {
            loginButton.addActionListener(event -> loginAndRefresh());
            loginState.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
            loginState.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent event) {
                    loginAndRefresh();
                }
            });
            passwordField.addFocusListener(new FocusAdapter() {
                @Override
                public void focusGained(FocusEvent event) {
                    if (PASSWORD_MASK.equals(visiblePasswordText())) {
                        passwordField.setText("");
                    }
                }
            });
            refreshButton.addActionListener(event -> refreshBugs());
            aiFixAllButton.addActionListener(event -> aiFixAll());
            clearImageCacheButton.addActionListener(event -> clearImageCache());
            aiEngineBox.addActionListener(event -> savePreferences());
            repairModeBox.addActionListener(event -> savePreferences());
            setupMemberSearchBox();
            projectBox.addActionListener(event -> {
                if (hydratingProjects) return;
                preferredMemberAccount = "";
                clearMemberSearchField();
                applyMembersCacheForProject(selectedProjectId());
                savePreferences();
                refreshBugs();
            });
            memberBox.addActionListener(event -> {
                if (hydratingMembers || programmaticMemberUpdate) return;
                Object selected = memberBox.getSelectedItem();
                if (selected instanceof Item) {
                    commitMemberFilter(((Item) selected).id, selected.toString());
                } else {
                    applyMemberFilterSelection(false);
                }
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

        private JTextComponent memberSearchEditor() {
            return (JTextComponent) memberBox.getEditor().getEditorComponent();
        }

        private boolean programmaticMemberUpdate = false;

        private void setupMemberSearchBox() {
            JTextComponent editor = memberSearchEditor();
            editor.setToolTipText(null);
            editor.putClientProperty("JTextField.placeholderText", MEMBER_SEARCH_PLACEHOLDER);
            if (editor instanceof JBTextField) {
                ((JBTextField)editor).getEmptyText().setText(MEMBER_SEARCH_PLACEHOLDER);
            }
            DocumentListener searchListener = new DocumentListener() {
                private void refresh() {
                    if (hydratingMembers || programmaticMemberUpdate) return;
                    SwingUtilities.invokeLater(() -> {
                        if (hydratingMembers || programmaticMemberUpdate) return;
                        String text = editor.getText();
                        filterMemberDropdown(text);
                        if (text.trim().isBlank() && !preferredMemberAccount.isBlank()) {
                            preferredMemberAccount = "";
                            syncMineFilterAvailability();
                            currentPage = 1;
                            renderBugs();
                        }
                    });
                }

                @Override
                public void insertUpdate(DocumentEvent event) {
                    refresh();
                }

                @Override
                public void removeUpdate(DocumentEvent event) {
                    refresh();
                }

                @Override
                public void changedUpdate(DocumentEvent event) {
                    refresh();
                }
            };
            editor.getDocument().addDocumentListener(searchListener);
            editor.addFocusListener(new FocusAdapter() {
                @Override
                public void focusLost(FocusEvent event) {
                    if (hydratingMembers || event.isTemporary()) return;
                    applyMemberFilterSelection(false);
                }
            });
            editor.addKeyListener(new KeyAdapter() {
                @Override
                public void keyPressed(KeyEvent event) {
                    if (event.getKeyCode() == KeyEvent.VK_ENTER) {
                        applyMemberFilterSelection(true);
                        event.consume();
                    } else if (event.getKeyCode() == KeyEvent.VK_DOWN && memberBox.getItemCount() > 0) {
                        memberBox.showPopup();
                    } else if (event.getKeyCode() == KeyEvent.VK_ESCAPE) {
                        memberBox.hidePopup();
                    }
                }
            });
            memberBox.getEditor().addActionListener(event -> {
                if (hydratingMembers || programmaticMemberUpdate) return;
                applyMemberFilterSelection(true);
            });
            memberBox.addPopupMenuListener(new PopupMenuListener() {
                @Override
                public void popupMenuWillBecomeVisible(PopupMenuEvent event) {
                    if (hydratingMembers || programmaticMemberUpdate) return;
                    String text = memberSearchEditor().getText().trim();
                    if (text.isBlank() || isCommittedMemberDisplay(text)) {
                        repopulateMemberDropdownItems("");
                    }
                }

                @Override
                public void popupMenuWillBecomeInvisible(PopupMenuEvent event) {
                }

                @Override
                public void popupMenuCanceled(PopupMenuEvent event) {
                }
            });
        }

        private void setMemberEditorText(String text) {
            if (!programmaticMemberUpdate) {
                programmaticMemberUpdate = true;
                try {
                    writeMemberEditorText(text);
                } finally {
                    programmaticMemberUpdate = false;
                }
            } else {
                writeMemberEditorText(text);
            }
        }

        private void writeMemberEditorText(String text) {
            String value = text == null ? "" : text;
            memberSearchEditor().setText(value);
            memberBox.getEditor().setItem(value);
        }

        private void restoreMemberEditorDisplay() {
            if (preferredMemberAccount == null || preferredMemberAccount.isBlank()) {
                setMemberEditorText("");
                filterMemberDropdown("");
                return;
            }
            Item matched = findMemberItem(preferredMemberAccount);
            String display = matched != null ? matched.toString() : preferredMemberAccount;
            setMemberEditorText(display);
            repopulateMemberDropdownItems("");
        }

        private boolean isCommittedMemberDisplay(String text) {
            if (text == null || text.isBlank() || preferredMemberAccount.isBlank()) return false;
            Item matched = findMemberItem(preferredMemberAccount);
            String display = matched != null ? matched.toString() : preferredMemberAccount;
            return text.equals(display);
        }

        private Item findMemberBySearchText(String raw) {
            String text = raw == null ? "" : raw.trim();
            if (text.isBlank()) return null;
            for (Item member : members) {
                if (member.toString().equals(text)
                        || member.id.equalsIgnoreCase(text)
                        || member.name.equalsIgnoreCase(text)) {
                    return member;
                }
            }
            String account = resolveMemberAccount(text);
            return findMemberItem(account);
        }

        private void clearMemberComboSelection() {
            setMemberEditorText("");
            memberBox.setSelectedIndex(-1);
        }

        private void clearMemberSearchField() {
            hydratingMembers = true;
            preferredMemberAccount = "";
            memberBox.setSelectedIndex(-1);
            setMemberEditorText("");
            filterMemberDropdown("");
            hydratingMembers = false;
            syncMineFilterAvailability();
        }

        private void filterMemberDropdown(String query) {
            filterMemberDropdown(query, true);
        }

        private void filterMemberDropdown(String query, boolean allowPopup) {
            repopulateMemberDropdownItems(query);
            String needle = query == null ? "" : query.trim();
            if (allowPopup && !needle.isBlank() && memberBox.getItemCount() > 0) {
                SwingUtilities.invokeLater(() -> {
                    memberSearchEditor().requestFocusInWindow();
                    memberBox.showPopup();
                });
            } else if (!allowPopup) {
                memberBox.hidePopup();
            }
        }

        private void repopulateMemberDropdownItems(String query) {
            String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
            String preserve = memberSearchEditor().getText();
            programmaticMemberUpdate = true;
            hydratingMembers = true;
            try {
                memberBox.removeAllItems();
                for (Item item : members) {
                    if (needle.isBlank() || matchesMemberSearch(item, needle)) {
                        memberBox.addItem(item);
                    }
                }
                writeMemberEditorText(preserve);
                if (preserve.trim().isBlank()) {
                    memberBox.setSelectedIndex(-1);
                }
            } finally {
                hydratingMembers = false;
                programmaticMemberUpdate = false;
            }
        }

        private static boolean matchesMemberSearch(Item member, String needle) {
            if (member == null || needle == null || needle.isBlank()) return true;
            return member.id.toLowerCase(Locale.ROOT).contains(needle)
                    || member.name.toLowerCase(Locale.ROOT).contains(needle)
                    || member.toString().toLowerCase(Locale.ROOT).contains(needle);
        }

        private Item findMemberItem(String account) {
            if (account == null || account.isBlank()) return null;
            for (Item item : members) {
                if (item.id.equalsIgnoreCase(account)) return item;
            }
            return null;
        }

        private String resolveMemberAccount(String value) {
            String text = value == null ? "" : value.trim();
            if (text.isBlank()) return "";
            String explicitAccount = text.contains("|") ? text.substring(text.lastIndexOf('|') + 1).trim() : text;
            for (Item member : members) {
                if (member.toString().equals(text)
                        || member.id.equalsIgnoreCase(explicitAccount)
                        || member.name.equalsIgnoreCase(text)) {
                    return member.id;
                }
            }
            return explicitAccount;
        }

        private void applyMemberFilterSelection(boolean fromEnter) {
            Object editorItem = memberBox.getEditor().getItem();
            if (editorItem instanceof Item) {
                commitMemberFilter(((Item) editorItem).id, ((Item) editorItem).toString());
                return;
            }
            String raw = memberSearchEditor().getText().trim();
            if (raw.isBlank()) {
                commitMemberFilter("", "");
                return;
            }
            Item matched = findMemberBySearchText(raw);
            if (matched != null) {
                commitMemberFilter(matched.id, matched.toString());
                return;
            }
            restoreMemberEditorDisplay();
            if (fromEnter) {
                memberSearchEditor().transferFocus();
            }
        }

        private void commitMemberFilter(String account, String display) {
            preferredMemberAccount = account == null ? "" : account.trim();
            programmaticMemberUpdate = true;
            hydratingMembers = true;
            try {
                if (preferredMemberAccount.isBlank()) {
                    memberBox.setSelectedIndex(-1);
                    setMemberEditorText("");
                } else {
                    setMemberEditorText(display == null || display.isBlank() ? preferredMemberAccount : display);
                }
                repopulateMemberDropdownItems("");
            } finally {
                hydratingMembers = false;
                programmaticMemberUpdate = false;
            }
            syncMineFilterAvailability();
            savePreferences();
            currentPage = 1;
            renderBugs();
        }

        private void syncMineFilterAvailability() {
            updateMineFilterAvailability();
        }

        private void updateLoginState(boolean loggedIn) {
            String account = accountField.getText().trim();
            loginState.setLoggedIn(loggedIn);
            loginState.setText(loggedIn ? "已登录：" + account : "未登录");
            loginState.setToolTipText(loggedIn ? "点击重新登录" : "点击登录");
            loginButton.setVisible(!loggedIn);
            showPasswordMaskIfLoggedIn(loggedIn);
        }

        private void loginAndRefresh() {
            savePreferences();
            String password = resolvedPasswordForLogin();
            if (accountField.getText().trim().isBlank() || password.isBlank()) {
                clearPasswordMaskIfNoSavedPassword();
                setStatus("请输入禅道账号和密码。");
                return;
            }
            runAsync("正在登录禅道...", () -> {
                client.login(serverField.getText(), accountField.getText(), password);
                return "已登录：" + accountField.getText();
            }, message -> {
                updateLoginState(true);
                preferredMemberAccount = "";
                memberBox.setSelectedIndex(-1);
                savePreferences();
                startSessionKeepAlive();
                loadProjectsAfterLogin(false);
            });
        }

        private void applySettingsDefaults() {
            PropertiesComponent properties = PropertiesComponent.getInstance();
            serverField.setText(normalizeServerUrl(properties.getValue("zentao.idea.settings.serverUrl", DEFAULT_SERVER)));
            autoLoginBox.setSelected(properties.getBoolean("zentao.idea.settings.autoLogin", true));
            aiEngineBox.setSelectedIndex(0);
            setRepairMode(REPAIR_MODE_CLI);
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
            String projectId = selectedProjectId();
            if (!force && projectId.equals(membersLoadedForProjectId) && !members.isEmpty()) {
                setStatus("成员列表已缓存：" + members.size() + " 个");
                populateMemberBox();
                renderBugs();
                if (afterLoaded != null) afterLoaded.run();
                return;
            }
            List<Item> cached = membersByProject.get(projectCacheKey(projectId));
            if (!force && cached != null && !cached.isEmpty()) {
                members.clear();
                members.addAll(cached);
                membersLoadedForProjectId = projectId;
                populateMemberBox();
                renderBugs();
                setStatus("成员列表已缓存：" + members.size() + " 个");
                if (afterLoaded != null) afterLoaded.run();
                return;
            }
            runAsync("正在获取成员列表...", () -> client.listMembers(projectId), items -> {
                members.clear();
                members.addAll(items);
                membersLoadedForProjectId = projectId;
                rememberMembersCache(projectId);
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
                return client.listBugs(selectedProjectId(), "all", "", accountField.getText());
            }, result -> {
                bugs.clear();
                bugs.addAll(result);
                currentPage = 1;
                renderBugs();
                loadMembers(false);
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
            return preferredMemberAccount == null ? "" : preferredMemberAccount.trim();
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
            properties.setValue("zentao.idea.repairMode", REPAIR_MODE_CLI, REPAIR_MODE_CLI);
            savePasswordSecurely();
            properties.unsetValue("zentao.idea.password");
            properties.setValue("zentao.idea.sessionCookies", client.cookieHeader(), "");
            properties.setValue("zentao.idea.projectId", selectedProjectId(), "");
            properties.setValue("zentao.idea.memberAccount", "", "");
            properties.setValue("zentao.idea.projects", encodeItems(projects), "");
            rememberMembersCache(selectedProjectId());
            properties.setValue("zentao.idea.membersByProject", encodeMembersByProject(membersByProject), "");
            properties.setValue("zentao.idea.filters", String.join(",", selectedFilterKeys()), String.join(",", DEFAULT_FILTER_KEYS));
        }

        private void restorePreferences() {
            PropertiesComponent properties = projectProperties();
            if (properties == null) return;
            serverField.setText(normalizeServerUrl(properties.getValue("zentao.idea.serverUrl", DEFAULT_SERVER)));
            accountField.setText(properties.getValue("zentao.idea.account", ""));
            autoLoginBox.setSelected(properties.getBoolean("zentao.idea.autoLogin", true));
            aiEngineBox.setSelectedIndex(0);
            setRepairMode(REPAIR_MODE_CLI);
            String legacyPassword = properties.getValue("zentao.idea.password", "");
            if (legacyPassword != null && !legacyPassword.isBlank()) {
                passwordField.setText(legacyPassword);
                savePasswordSecurely();
                properties.unsetValue("zentao.idea.password");
            } else {
                passwordField.setText(loadPasswordSecurely(serverField.getText(), accountField.getText()));
            }
            client.restoreSession(serverField.getText(), properties.getValue("zentao.idea.sessionCookies", ""));
            preferredProjectId = properties.getValue("zentao.idea.projectId", "");
            preferredMemberAccount = "";
            projects.clear();
            projects.addAll(decodeItems(properties.getValue("zentao.idea.projects", "")));
            membersByProject.clear();
            membersByProject.putAll(decodeMembersByProject(properties.getValue("zentao.idea.membersByProject", "")));
            String legacyMembers = properties.getValue("zentao.idea.members", "");
            if (!legacyMembers.isBlank() && !preferredProjectId.isBlank()) {
                membersByProject.putIfAbsent(projectCacheKey(preferredProjectId), decodeItems(legacyMembers));
            }
            populateProjectBox();
            applyMembersCacheForProject(preferredProjectId);
            populateMemberBox();
            Set<String> filters = new LinkedHashSet<>(List.of(properties.getValue("zentao.idea.filters", String.join(",", DEFAULT_FILTER_KEYS)).split(",")));
            filters.remove("assignedToMe");
            filterChecks.forEach((key, box) -> box.setSelected(filters.contains(key)));
            refreshAllFilterState();
        }

        private void savePasswordSecurely() {
            String account = accountField.getText().trim();
            if (account.isBlank()) return;
            String password = visiblePasswordText();
            if (PASSWORD_MASK.equals(password)) {
                return;
            }
            CredentialAttributes attributes = passwordAttributes(serverField.getText(), account);
            PasswordSafe.getInstance().set(attributes, password.isBlank() ? null : new Credentials(account, password));
        }

        private String loadPasswordSecurely(String serverUrl, String account) {
            String normalizedAccount = account == null ? "" : account.trim();
            if (normalizedAccount.isBlank()) return "";
            Credentials credentials = PasswordSafe.getInstance().get(passwordAttributes(serverUrl, normalizedAccount));
            return credentials == null || credentials.getPasswordAsString() == null ? "" : credentials.getPasswordAsString();
        }

        private static CredentialAttributes passwordAttributes(String serverUrl, String account) {
            String serviceName = "ZenTao Bug Assistant/" + normalizeServerUrl(serverUrl);
            String userName = account == null ? "" : account.trim();
            return new CredentialAttributes(serviceName, userName, ZenTaoBugAssistantToolWindowFactory.class);
        }

        private String visiblePasswordText() {
            return new String(passwordField.getPassword()).trim();
        }

        private String resolvedPasswordForLogin() {
            String visible = visiblePasswordText();
            if (!PASSWORD_MASK.equals(visible)) {
                return visible;
            }
            return loadPasswordSecurely(serverField.getText(), accountField.getText());
        }

        private void showPasswordMaskIfLoggedIn(boolean loggedIn) {
            if (!loggedIn || !visiblePasswordText().isBlank()) {
                return;
            }
            passwordField.setText(PASSWORD_MASK);
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
            String display = "";
            if (preferredMemberAccount != null && !preferredMemberAccount.isBlank()) {
                Item matched = findMemberItem(preferredMemberAccount);
                display = matched != null ? matched.toString() : preferredMemberAccount;
            }
            setMemberEditorText(display);
            repopulateMemberDropdownItems("");
            hydratingMembers = false;
            syncMineFilterAvailability();
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

        private static String projectCacheKey(String projectId) {
            return projectId == null ? "" : projectId;
        }

        private void rememberMembersCache(String projectId) {
            if (members.isEmpty()) return;
            membersByProject.put(projectCacheKey(projectId), new ArrayList<>(members));
        }

        private void applyMembersCacheForProject(String projectId) {
            List<Item> cached = membersByProject.get(projectCacheKey(projectId));
            members.clear();
            if (cached != null) {
                members.addAll(cached);
            }
            membersLoadedForProjectId = projectCacheKey(projectId);
        }

        private static String encodeMembersByProject(Map<String, List<Item>> values) {
            StringBuilder builder = new StringBuilder();
            for (Map.Entry<String, List<Item>> entry : values.entrySet()) {
                if (entry.getValue() == null || entry.getValue().isEmpty()) continue;
                if (builder.length() > 0) builder.append("\n---\n");
                builder.append(projectCacheKey(entry.getKey())).append("\n");
                builder.append(encodeItems(entry.getValue()));
            }
            return builder.toString();
        }

        private static Map<String, List<Item>> decodeMembersByProject(String value) {
            Map<String, List<Item>> result = new LinkedHashMap<>();
            if (value == null || value.isBlank()) return result;
            for (String block : value.split("\n---\n")) {
                int splitAt = block.indexOf('\n');
                if (splitAt < 0) continue;
                String projectId = block.substring(0, splitAt).trim();
                List<Item> items = decodeItems(block.substring(splitAt + 1));
                if (!items.isEmpty()) {
                    result.put(projectCacheKey(projectId), items);
                }
            }
            return result;
        }

        private List<String> selectedFilterKeys() {
            List<String> keys = new ArrayList<>();
            filterChecks.forEach((key, box) -> {
                if (box.isSelected() && !"assignedToMe".equals(key)) keys.add(key);
            });
            return keys.isEmpty() ? DEFAULT_FILTER_KEYS : keys;
        }

        private void refreshAllFilterState() {
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
                bugListPanel.add(emptyState("当前筛选条件下暂无 Bug（共 " + bugs.size() + " 个）。"));
            } else {
                for (BugSummary bug : filtered.subList(start, end)) {
                    BugCard card = new BugCard(bug);
                    card.setAlignmentX(Component.LEFT_ALIGNMENT);
                    bugListPanel.add(card);
                    bugListPanel.add(javax.swing.Box.createVerticalStrut(8));
                }
            }
            setStatus(buildBugStatusSummary(filtered));
            pageLabel.setText(currentPage + "/" + totalPages);
            int aiFixCount = unresolved(filtered).size();
            aiFixAllButton.setText(aiFixCount > 0 ? "AI一键修复 " + aiFixCount : "AI一键修复");
            aiFixAllButton.setEnabled(aiFixCount > 0);
            bugListPanel.revalidate();
            bugListPanel.repaint();
        }

        private List<BugSummary> filteredBugs() {
            return filterBugsByCategory(filterBugsBySelectedMember());
        }

        private String buildBugStatusSummary(List<BugSummary> filtered) {
            int total = bugs.size();
            int shown = filtered.size();
            if (total == 0) {
                return "共 0 个 Bug";
            }
            if (shown == total) {
                return "共 " + total + " 个 Bug";
            }
            return "显示 " + shown + " / " + total + " 个 Bug";
        }

        private List<BugSummary> filterBugsByCategory(List<BugSummary> scopedBugs) {
            JCheckBox mineBox = filterChecks.get("assignedToMe");
            boolean mineOnly = mineBox != null && mineBox.isSelected();
            List<String> statusKeys = List.of("unresolved", "resolved", "closed");
            Set<String> activeStatus = new LinkedHashSet<>();
            filterChecks.forEach((key, box) -> {
                if (statusKeys.contains(key) && box.isSelected()) activeStatus.add(key);
            });
            boolean allStatusActive = activeStatus.containsAll(statusKeys);
            if (!mineOnly && (activeStatus.isEmpty() || allStatusActive)) return scopedBugs;
            Set<String> mineCandidates = new LinkedHashSet<>();
            if (mineOnly) {
                mineCandidates.addAll(personAliases(accountField.getText()));
                members.stream()
                        .filter(member -> member.id.equalsIgnoreCase(accountField.getText()))
                        .findFirst()
                        .ifPresent(member -> {
                            mineCandidates.addAll(personAliases(member.id));
                            mineCandidates.addAll(personAliases(member.name));
                        });
            }
            List<BugSummary> result = new ArrayList<>();
            for (BugSummary bug : scopedBugs) {
                if (mineOnly) {
                    Set<String> assignedToValues = new LinkedHashSet<>(personAliases(bug.assignedTo));
                    boolean matchesMine = mineCandidates.stream().anyMatch(candidate ->
                            assignedToValues.stream().anyMatch(assignedTo ->
                                    assignedTo.equals(candidate) || assignedTo.contains(candidate) || candidate.contains(assignedTo)));
                    if (!matchesMine) continue;
                }
                if (!activeStatus.isEmpty() && !allStatusActive) {
                    boolean matchesStatus =
                            (activeStatus.contains("unresolved") && !bug.status.equals("resolved") && !bug.status.equals("closed"))
                            || (activeStatus.contains("resolved") && bug.status.equals("resolved"))
                            || (activeStatus.contains("closed") && bug.status.equals("closed"));
                    if (!matchesStatus) continue;
                }
                result.add(bug);
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
                    .filter(member -> member.id.equalsIgnoreCase(selectedMemberAccount()))
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
            boolean nonSelfSelected = isMineFilterDisabled();
            hydratingFilters = true;
            if (nonSelfSelected && mine.isSelected()) {
                mine.setSelected(false);
            }
            mine.setEnabled(true);
            mine.setForeground(mine.isSelected() ? TEXT_MAIN : TEXT_SUB);
            hydratingFilters = false;
            if (mine.getParent() != null) {
                mine.getParent().repaint();
            }
            refreshAllFilterState();
        }

        private boolean isMineFilterDisabled() {
            String selectedAccount = selectedMemberAccount();
            if (selectedAccount.isBlank()) return false;
            Set<String> accountValues = new LinkedHashSet<>(personAliases(accountField.getText()));
            Set<String> candidates = new LinkedHashSet<>(personAliases(selectedAccount));
            members.stream()
                    .filter(member -> member.id.equalsIgnoreCase(selectedAccount))
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
                    String basePrompt = details.size() == 1 ? PromptBuilder.build(details.get(0)) : PromptBuilder.buildBatch(details);
                    String diagnosticPackage = collectWorkspaceDiagnosticPackage(details);
                    String prompt = combinePromptWithDiagnostics(basePrompt, diagnosticPackage);
                    Path sessionFile = sendPromptForRepair(prompt, details.stream().map(detail -> detail.id).collect(Collectors.toList()));
                    setStatus(details.size() + " 个 Bug 已发送到 " + selectedRepairTargetLabel() + "；会话包：" + sessionFile);
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
                    String diagnosticPackage = collectWorkspaceDiagnosticPackage(List.of(detail));
                    String prompt = combinePromptWithDiagnostics(PromptBuilder.build(detail), diagnosticPackage);
                    Path sessionFile = sendPromptForRepair(prompt, List.of(bugId));
                    setStatus("Bug #" + bugId + " 已发送到 " + selectedRepairTargetLabel() + "；会话包：" + sessionFile);
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
            String defaultComment = buildWorkflowCommentDraft(bugId, action);
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
                    String projectId = selectedProjectId();
                    List<Item> cached = membersByProject.get(projectCacheKey(projectId));
                    if (cached != null && !cached.isEmpty()) {
                        members.clear();
                        members.addAll(cached);
                        membersLoadedForProjectId = projectId;
                        populateMemberBox();
                    } else {
                        List<Item> loaded = client.listMembers(projectId);
                        members.clear();
                        members.addAll(loaded);
                        membersLoadedForProjectId = projectId;
                        rememberMembersCache(projectId);
                        populateMemberBox();
                        savePreferences();
                    }
                } catch (Exception error) {
                    Throwable cause = rootCause(error);
                    if (isTransientNetworkError(cause)) {
                        Messages.showWarningDialog(project, briefStatusError(cause), "禅道助手");
                    } else {
                        Messages.showErrorDialog(project, "成员列表获取失败：" + readableError(cause), "禅道助手");
                    }
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

        private String combinePromptWithDiagnostics(String basePrompt, String diagnosticPackage) {
            if (REPAIR_MODE_CLI.equals(selectedRepairMode())) {
                return cliFastExecutionProtocol() + "\n\n"
                        + diagnosticPackage + "\n\n"
                        + "---\n\n"
                        + basePrompt;
            }
            return basePrompt + "\n\n---\n\n" + diagnosticPackage;
        }

        private static String cliFastExecutionProtocol() {
            return "【CLI快速修复协议】\n"
                    + "你正在 Cursor Agent CLI/headless 模式中修复禅道 Bug。CLI 比聊天窗口更容易过度搜索，所以必须按以下策略执行：\n"
                    + "1. 先阅读本文件里的【AI诊断包】，优先使用“疑似相关文件候选”“代码命中证据”“当前编辑器上下文”和本地截图路径。\n"
                    + "2. 首轮定位最多读取 6 个候选文件，最多追加 8 次 grep/glob；不要先做全仓库泛搜索。\n"
                    + "3. 不要重复搜索同一组关键词；不要搜索 button/page/bug/error/null/http/image/video 等泛词。\n"
                    + "4. 如果诊断包已经给出足够候选文件，直接在这些文件里做最小修复，不要继续扩大搜索范围。\n"
                    + "5. 只有候选文件全部无法解释 Bug 时，才追加小范围搜索，并在输出里说明为什么需要扩大范围。\n"
                    + "6. 目标是快速完成最小可信修复：定位根因、改最少文件、给出验证方式和剩余风险。";
        }

        private String buildWorkflowCommentDraft(String bugId, String action) {
            if ("activate".equals(action)) {
                return "重新激活，请继续处理。";
            }
            if (!"resolve".equals(action) && !"close".equals(action)) {
                return "";
            }
            String cwd = project.getBasePath();
            if (cwd == null || cwd.isBlank()) {
                return "resolve".equals(action) ? "已修复，请验证。" : "已验证，关闭。";
            }

            String branch = oneLine(runGit(cwd, "rev-parse", "--abbrev-ref", "HEAD"));
            String diffNames = runGit(cwd, "diff", "--name-only", "HEAD", "--");
            String shortstat = runGit(cwd, "diff", "--shortstat", "HEAD", "--");
            String status = runGit(cwd, "status", "--short");
            String sessionPath = findLatestRepairSessionForBug(bugId);
            List<String> verificationCommands = collectVerificationCommands(cwd);
            List<String> fileCandidates = new ArrayList<>();
            fileCandidates.addAll(splitLines(diffNames));
            fileCandidates.addAll(parseGitStatusFiles(status));
            List<String> files = uniqueStrings(fileCandidates).stream().limit(8).collect(Collectors.toList());
            String fileText = files.isEmpty() ? "请补充改动文件" : String.join(", ", files);
            String statText = oneLine(shortstat);
            if (statText.isBlank()) {
                statText = files.isEmpty() ? "未检测到 Git 改动" : files.size() + " 个文件有改动";
            }
            String actionText = "resolve".equals(action) ? "已修复，请验证" : "已验证，关闭";
            String verificationText = verificationCommands.isEmpty()
                    ? "请补充已执行命令/结果"
                    : verificationCommands.stream().limit(3).collect(Collectors.joining(" / "));
            String sessionText = sessionPath.isBlank() ? "" : "；AI会话包：" + sessionPath;
            return "【AI修复回写】Bug #" + bugId + " " + actionText
                    + "；分支：" + (branch.isBlank() ? "未知" : branch)
                    + "；改动文件：" + fileText
                    + "；变更统计：" + statText
                    + "；验证建议：" + verificationText
                    + "；验证结果：请补充已执行命令/结果"
                    + "；风险：请补充剩余风险"
                    + sessionText + "。";
        }

        private String findLatestRepairSessionForBug(String bugId) {
            String safeId = bugId == null ? "" : bugId.replaceAll("[^A-Za-z0-9._-]", "_");
            List<Path> candidates = new ArrayList<>();
            for (Path dir : repairSessionSearchDirs()) {
                if (!Files.isDirectory(dir)) continue;
                try (java.util.stream.Stream<Path> paths = Files.list(dir)) {
                    paths.filter(Files::isRegularFile)
                            .filter(path -> path.getFileName().toString().endsWith(".md"))
                            .filter(path -> isRepairSessionForBug(path, bugId, safeId))
                            .forEach(candidates::add);
                } catch (Exception ignored) {
                    // ignore missing or unreadable session directories
                }
            }
            return candidates.stream()
                    .sorted((left, right) -> {
                        try {
                            return Files.getLastModifiedTime(right).compareTo(Files.getLastModifiedTime(left));
                        } catch (Exception ignored) {
                            return 0;
                        }
                    })
                    .map(path -> path.toAbsolutePath().toString())
                    .findFirst()
                    .orElse("");
        }

        private static boolean isRepairSessionForBug(Path path, String bugId, String safeId) {
            String fileName = path.getFileName().toString();
            if (!safeId.isBlank() && (fileName.contains("bug-" + safeId) || fileName.contains("bugs-" + safeId))) {
                return true;
            }
            try {
                String content = Files.readString(path, StandardCharsets.UTF_8);
                String preview = content.length() > 4096 ? content.substring(0, 4096) : content;
                return preview.contains("#" + bugId) || preview.contains("Bug编号：" + bugId);
            } catch (Exception ignored) {
                return false;
            }
        }

        private String collectWorkspaceDiagnosticPackage(List<BugDetail> details) {
            String bugIds = details.stream().map(detail -> "#" + detail.id).collect(Collectors.joining(", "));
            int imageCount = details.stream().mapToInt(detail -> detail.promptImages == null ? 0 : detail.promptImages.size()).sum();
            List<String> lines = new ArrayList<>();
            lines.add("【AI诊断包】");
            lines.add("Bug 范围：" + (bugIds.isBlank() ? "未提供" : bugIds));
            lines.add("本地截图数量：" + imageCount);
            lines.add("目标：请先用本诊断包判断可能影响范围，再改代码；不要只根据 Bug 文本猜测。");

            String cwd = project.getBasePath();
            if (cwd == null || cwd.isBlank()) {
                AiContextReview contextReview = buildAiContextReview(false, imageCount, List.of(), List.of(), List.of(), List.of(), List.of());
                lines.add("");
                lines.add("AI 上下文质量：");
                lines.add(formatAiContextReview(contextReview));
                lines.add("");
                lines.add("工作区：未打开 IntelliJ 项目目录，无法附加仓库上下文。");
                lines.add("");
                lines.add("建议验证：");
                lines.add("- 根据项目实际技术栈运行相关单元测试、构建或冒烟流程。");
                return String.join("\n", lines);
            }

            String branch = oneLine(runGit(cwd, "rev-parse", "--abbrev-ref", "HEAD"));
            String status = runGit(cwd, "status", "--short");
            String recentCommits = runGit(cwd, "log", "-5", "--oneline", "--decorate");
            String editorWorkspaceFiles = collectEditorWorkspaceFiles(cwd);
            List<String> trackedFileList = new ArrayList<>(splitLines(editorWorkspaceFiles));
            if (trackedFileList.isEmpty() || trackedFileList.size() >= MAX_EDITOR_WORKSPACE_FILES) {
                trackedFileList.addAll(splitLines(collectWorkspaceFiles(cwd)));
            }
            String trackedFiles = String.join("\n", uniqueStrings(trackedFileList));
            List<String> changedFiles = collectChangedFiles(cwd, status).stream().limit(24).collect(Collectors.toList());
            List<String> relevantFiles = rankRelevantFiles(trackedFiles, details, changedFiles).stream().limit(16).collect(Collectors.toList());
            List<String> codeEvidence = collectCodeEvidence(cwd, collectBugSearchTerms(details).stream().limit(8).collect(Collectors.toList()), relevantFiles);
            List<String> verificationCommands = collectVerificationCommands(cwd);
            List<String> activeEditorContext = collectActiveEditorContext(cwd);
            AiContextReview contextReview = buildAiContextReview(
                    true,
                    imageCount,
                    activeEditorContext,
                    relevantFiles,
                    codeEvidence,
                    verificationCommands,
                    splitLines(recentCommits)
            );

            lines.add("");
            lines.add("AI 上下文质量：");
            lines.add(formatAiContextReview(contextReview));
            lines.add("");
            lines.add("仓库上下文：");
            lines.add("- 工作区：" + cwd);
            lines.add("- Git 分支：" + (branch.isBlank() ? "未知" : branch));
            lines.add("");
            lines.add("当前改动文件：");
            lines.add(formatBulletList(changedFiles, "工作区暂无未提交文件"));
            lines.add("");
            lines.add("当前编辑器上下文：");
            lines.add(formatBlockList(activeEditorContext, "未检测到当前工作区内的活动代码文件或选区"));
            lines.add("");
            lines.add("最近提交：");
            lines.add(formatBulletList(splitLines(recentCommits).stream().limit(5).collect(Collectors.toList()), "无法读取最近提交"));
            lines.add("");
            lines.add("疑似相关文件候选：");
            lines.add(formatBulletList(relevantFiles, "未能从 Bug 文本匹配到候选文件，请先用全文搜索定位模块"));
            lines.add("");
            lines.add("代码命中证据：");
            lines.add(formatBulletList(codeEvidence, "未从仓库内容命中 Bug 关键词，建议 AI 先使用全文搜索定位"));
            lines.add("");
            lines.add("推荐验证命令：");
            lines.add(formatBulletList(verificationCommands, "未识别到项目验证命令，请根据项目技术栈补充"));
            lines.add("");
            lines.add("建议验证清单：");
            lines.add("- 优先运行与候选文件/模块相关的最小测试。");
            lines.add("- 若没有测试，至少运行项目构建或类型检查。");
            lines.add("- 修复后说明根因、关键改动、验证命令和剩余风险。");
            lines.add("- 如果需要回写禅道备注，请包含根因、改动文件、验证结果和风险说明。");
            return String.join("\n", lines);
        }

        private List<String> collectActiveEditorContext(String cwd) {
            Editor editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
            if (editor == null) return List.of();

            Document document = editor.getDocument();
            VirtualFile file = FileDocumentManager.getInstance().getFile(document);
            if (file == null || !file.isInLocalFileSystem()) return List.of();

            Path root = Path.of(cwd).toAbsolutePath().normalize();
            Path filePath = Path.of(file.getPath()).toAbsolutePath().normalize();
            if (!filePath.startsWith(root)) return List.of();

            String relativePath = root.relativize(filePath).toString().replace('\\', '/');
            int lineCount = document.getLineCount();
            if (lineCount <= 0) return List.of();

            boolean hasSelection = editor.getSelectionModel().hasSelection();
            int startLine;
            int endLine;
            if (hasSelection) {
                int selectionStart = editor.getSelectionModel().getSelectionStart();
                int selectionEnd = editor.getSelectionModel().getSelectionEnd();
                startLine = document.getLineNumber(selectionStart);
                endLine = document.getLineNumber(Math.max(selectionStart, selectionEnd - 1));
            } else {
                int caretLine = editor.getCaretModel().getLogicalPosition().line;
                startLine = Math.max(0, caretLine - 40);
                endLine = Math.min(lineCount - 1, caretLine + 40);
            }

            int cappedEndLine = Math.min(endLine, startLine + 119);
            String snippet = formatDocumentLines(document, startLine, cappedEndLine);
            if (snippet.isBlank()) return List.of();

            List<String> result = new ArrayList<>();
            result.add("文件：" + relativePath);
            result.add((hasSelection ? "选区" : "光标附近") + "：第 " + (startLine + 1) + "-" + (cappedEndLine + 1) + " 行");
            result.add("```" + languageFromFile(relativePath));
            result.add(snippet);
            result.add("```");
            return result;
        }

        private List<String> collectCodeEvidence(String cwd, List<String> terms, List<String> candidateFiles) {
            List<String> evidence = new ArrayList<>();
            for (String term : terms) {
                if (evidence.size() >= 20) break;
                if (!isUsefulSearchTerm(term) || COMMON_BUG_TERMS.contains(term)) continue;
                List<String> candidateEvidence = collectCandidateCodeEvidence(cwd, term, candidateFiles);
                for (String line : candidateEvidence) {
                    evidence.add(line);
                    if (evidence.size() >= 20) break;
                }
                if (!candidateEvidence.isEmpty()) continue;
                String result = runGit(cwd, "grep", "-n", "-I", "-i", "-e", term, "--", ".");
                if (result.isBlank()) {
                    result = runCommand(cwd, 8, "rg",
                            "--line-number",
                            "--ignore-case",
                            "--fixed-strings",
                            "--glob",
                            "!{.git,.svn,Library,Temp,UserSettings,workspace,writable,simulator,obj,Logs,AssetBundles,AssetBundles_Back}/**",
                            term
                    );
                }
                for (String line : splitLines(result).stream().limit(4).collect(Collectors.toList())) {
                    String normalized = line.length() > 220 ? line.substring(0, 217) + "..." : line;
                    evidence.add(term + ": " + normalized);
                    if (evidence.size() >= 20) break;
                }
            }
            return uniqueStrings(evidence);
        }

        private List<String> collectCandidateCodeEvidence(String cwd, String term, List<String> candidateFiles) {
            if (candidateFiles == null || candidateFiles.isEmpty()) return List.of();
            List<String> evidence = new ArrayList<>();
            String lowerTerm = term.toLowerCase(Locale.ROOT);
            Path root = Path.of(cwd).toAbsolutePath().normalize();
            for (String file : candidateFiles.stream().limit(MAX_CANDIDATE_EVIDENCE_FILES).collect(Collectors.toList())) {
                if (evidence.size() >= 4 || !isTextEvidenceFile(file)) continue;
                try {
                    Path path = root.resolve(file).normalize();
                    if (!path.startsWith(root) || !Files.isRegularFile(path) || Files.size(path) > MAX_CANDIDATE_EVIDENCE_BYTES) continue;
                    List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
                    for (int index = 0; index < lines.size() && evidence.size() < 4; index++) {
                        String line = lines.get(index);
                        if (line.toLowerCase(Locale.ROOT).contains(lowerTerm)) {
                            String normalized = line.trim();
                            if (normalized.length() > 180) normalized = normalized.substring(0, 177) + "...";
                            evidence.add(term + ": " + file.replace('\\', '/') + ":" + (index + 1) + ":" + normalized);
                        }
                    }
                } catch (Exception ignored) {
                }
            }
            return evidence;
        }

        private static boolean isUsefulSearchTerm(String term) {
            if (term == null || term.isBlank()) return false;
            if (Pattern.compile("\\p{IsHan}").matcher(term).find()) {
                return term.length() >= 2;
            }
            return term.length() >= 4;
        }

        private static boolean isTextEvidenceFile(String file) {
            if (file == null) return false;
            return Pattern.compile("(?i).*\\.(ts|tsx|js|jsx|java|kt|cs|lua|py|go|rs|cpp|c|h|hpp|json|xml|md|txt|yml|yaml|ini|cfg|shader|cginc)$").matcher(file).matches();
        }

        private static boolean isIgnoredWorkspaceRelativePath(String file) {
            if (file == null || file.isBlank()) return true;
            String normalized = file.replace('\\', '/');
            return normalized.startsWith(".git/")
                    || normalized.startsWith(".svn/")
                    || normalized.startsWith("Library/")
                    || normalized.startsWith("Temp/")
                    || normalized.startsWith("UserSettings/")
                    || normalized.startsWith("workspace/")
                    || normalized.startsWith("writable/")
                    || normalized.startsWith("simulator/")
                    || normalized.startsWith("obj/")
                    || normalized.startsWith("Logs/")
                    || normalized.startsWith("AssetBundles/")
                    || normalized.startsWith("AssetBundles_Back/");
        }

        private static List<String> collectVerificationCommands(String cwd) {
            List<String> commands = new ArrayList<>();

            if (hasFile(cwd, "package.json")) {
                try {
                    String packageJson = Files.readString(Path.of(cwd, "package.json"), StandardCharsets.UTF_8);
                    String packageManager = packageManager(cwd);
                    if (hasPackageScript(packageJson, "test")) commands.add(packageScriptCommand(packageManager, "test"));
                    if (hasPackageScript(packageJson, "typecheck")) commands.add(packageScriptCommand(packageManager, "typecheck"));
                    if (hasPackageScript(packageJson, "check")) commands.add(packageScriptCommand(packageManager, "check"));
                    if (hasPackageScript(packageJson, "lint")) commands.add(packageScriptCommand(packageManager, "lint"));
                    if (hasPackageScript(packageJson, "build")) commands.add(packageScriptCommand(packageManager, "build"));
                } catch (Exception ignored) {
                    commands.add("npm test");
                }
            }

            if (hasFile(cwd, "build.bat")) commands.add("build.bat");
            if (hasFile(cwd, "gradlew.bat")) commands.add("gradlew.bat test");
            if (hasFile(cwd, "gradlew")) commands.add("./gradlew test");
            if (hasFile(cwd, "pom.xml")) commands.add("mvn test");
            if (hasFile(cwd, "go.mod")) commands.add("go test ./...");
            if (hasFile(cwd, "Cargo.toml")) commands.add("cargo test");
            if (hasFile(cwd, "pyproject.toml") || hasFile(cwd, "pytest.ini")) commands.add("pytest");
            if (hasFile(cwd, "ProjectSettings/ProjectVersion.txt")) commands.add("Unity Test Runner: EditMode/PlayMode tests");
            if (hasSolutionFile(cwd)) commands.add("dotnet test");

            return uniqueStrings(commands).stream().limit(8).collect(Collectors.toList());
        }

        private static boolean hasFile(String cwd, String relativePath) {
            try {
                return Files.exists(Path.of(cwd, relativePath));
            } catch (Exception ignored) {
                return false;
            }
        }

        private static boolean hasSolutionFile(String cwd) {
            try (java.util.stream.Stream<Path> entries = Files.list(Path.of(cwd))) {
                return entries.anyMatch(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".sln"));
            } catch (Exception ignored) {
                return false;
            }
        }

        private static boolean hasPackageScript(String packageJson, String scriptName) {
            return Pattern.compile("\"" + Pattern.quote(scriptName) + "\"\\s*:").matcher(packageJson).find();
        }

        private static String packageManager(String cwd) {
            if (hasFile(cwd, "pnpm-lock.yaml")) return "pnpm";
            if (hasFile(cwd, "yarn.lock")) return "yarn";
            return "npm";
        }

        private static String packageScriptCommand(String packageManager, String scriptName) {
            if ("pnpm".equals(packageManager) || "yarn".equals(packageManager)) {
                return packageManager + " " + scriptName;
            }
            return "test".equals(scriptName) ? "npm test" : "npm run " + scriptName;
        }

        private static AiContextReview buildAiContextReview(
                boolean workspaceAttached,
                int imageCount,
                List<String> activeEditorContext,
                List<String> relevantFiles,
                List<String> codeEvidence,
                List<String> verificationCommands,
                List<String> recentCommits
        ) {
            int score = 0;
            List<String> signals = new ArrayList<>();
            List<String> gaps = new ArrayList<>();

            if (workspaceAttached) {
                score += 20;
                signals.add("已附加当前工程路径和 Git 分支");
            } else {
                gaps.add("未打开工程目录，AI 无法获得仓库上下文");
            }

            if (relevantFiles != null && !relevantFiles.isEmpty()) {
                score += 20;
                signals.add("已给出 " + relevantFiles.size() + " 个疑似相关文件候选");
            } else {
                gaps.add("缺少疑似相关文件，建议先用全文搜索定位模块");
            }

            if (activeEditorContext != null && !activeEditorContext.isEmpty()) {
                score += 10;
                signals.add("已附加当前编辑器文件/选区上下文");
            } else {
                gaps.add("未附加当前编辑器上下文；若已打开相关代码，可选中关键片段后再发送");
            }

            if (codeEvidence != null && !codeEvidence.isEmpty()) {
                score += 25;
                signals.add("已命中 " + codeEvidence.size() + " 条代码证据");
            } else {
                gaps.add("缺少代码命中证据，AI 需要先自行搜索再判断改动点");
            }

            if (verificationCommands != null && !verificationCommands.isEmpty()) {
                score += 15;
                signals.add("已识别 " + verificationCommands.size() + " 条可运行验证命令");
            } else {
                gaps.add("未识别验证命令，建议补充构建、测试或冒烟入口");
            }

            if (imageCount > 0) {
                score += 10;
                signals.add("已附加 " + imageCount + " 张本地截图");
            } else {
                gaps.add("禅道未提供截图，AI 将主要依赖文本和代码证据");
            }

            if (recentCommits != null && !recentCommits.isEmpty()) {
                score += 10;
                signals.add("已附加最近提交，便于判断近期改动影响");
            } else {
                gaps.add("无法读取最近提交，缺少近期变更背景");
            }

            int normalizedScore = Math.min(score, 100);
            String label = normalizedScore >= 85 ? "高可信" : normalizedScore >= 65 ? "可用" : normalizedScore >= 45 ? "偏弱" : "不足";
            return new AiContextReview(
                    normalizedScore,
                    label,
                    signals.isEmpty() ? List.of("暂无强上下文信号") : signals,
                    gaps.isEmpty() ? List.of("暂无明显缺口") : gaps
            );
        }

        private static String formatAiContextReview(AiContextReview review) {
            return "- 评分：" + review.score + "/100（" + review.label + "）"
                    + "\n- 已具备：" + String.join("；", review.signals)
                    + "\n- 待补强：" + String.join("；", review.gaps);
        }

        private String runGit(String cwd, String... args) {
            List<String> command = new ArrayList<>();
            command.add("git");
            command.addAll(List.of(args));
            return runCommand(cwd, 5, command.toArray(new String[0]));
        }

        private String runCommand(String cwd, int timeoutSeconds, String... args) {
            try {
                Process process = new ProcessBuilder(List.of(args))
                        .directory(Path.of(cwd).toFile())
                        .redirectErrorStream(true)
                        .start();
                if (!process.waitFor(timeoutSeconds, java.util.concurrent.TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                    return "";
                }
                if (process.exitValue() != 0) return "";
                return new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            } catch (Exception ignored) {
                return "";
            }
        }

        private String collectWorkspaceFiles(String cwd) {
            String gitFiles = runGit(cwd, "ls-files");
            if (!splitLines(gitFiles).isEmpty()) {
                return gitFiles;
            }
            return runCommand(cwd, 12, "rg",
                    "--files",
                    "--hidden",
                    "--glob",
                    "!{.git,.svn,Library,Temp,UserSettings,workspace,writable,simulator,obj,Logs,AssetBundles,AssetBundles_Back}/**"
            );
        }

        private String collectEditorWorkspaceFiles(String cwd) {
            List<String> files = new ArrayList<>();
            try {
                Path root = Path.of(cwd).toRealPath();
                ProjectFileIndex index = ProjectFileIndex.getInstance(project);
                index.iterateContent(file -> {
                    if (files.size() >= MAX_EDITOR_WORKSPACE_FILES) return false;
                    if (file == null || file.isDirectory()) return true;
                    try {
                        Path path = Path.of(file.getPath()).toRealPath();
                        if (!path.startsWith(root)) return true;
                        String relative = root.relativize(path).toString().replace('\\', '/');
                        if (!relative.isBlank() && !isIgnoredWorkspaceRelativePath(relative)) {
                            files.add(relative);
                        }
                    } catch (Exception ignored) {
                    }
                    return true;
                });
            } catch (Exception ignored) {
                return "";
            }
            return String.join("\n", uniqueStrings(files));
        }

        private List<String> collectChangedFiles(String cwd, String gitStatus) {
            List<String> gitFiles = parseGitStatusFiles(gitStatus);
            if (!gitFiles.isEmpty()) {
                return gitFiles;
            }
            return parseSvnStatusFiles(runCommand(cwd, 8, "svn", "status"));
        }

        private static List<String> parseGitStatusFiles(String status) {
            List<String> files = new ArrayList<>();
            for (String line : splitLines(status)) {
                String file = line.length() > 3 ? line.substring(3).trim() : line.trim();
                if (file.contains(" -> ")) {
                    file = file.substring(file.lastIndexOf(" -> ") + 4).trim();
                }
                if (!file.isBlank()) files.add(file);
            }
            return files;
        }

        private static List<String> parseSvnStatusFiles(String status) {
            List<String> files = new ArrayList<>();
            for (String line : splitLines(status)) {
                String file = line.length() > 8 ? line.substring(8).trim() : "";
                if (!file.isBlank() && !file.startsWith(".cursor") && !file.startsWith("UserSettings")) {
                    files.add(file.replace('\\', '/'));
                }
            }
            return files;
        }

        private static List<String> rankRelevantFiles(String trackedFiles, List<BugDetail> details, List<String> changedFiles) {
            Set<String> terms = collectBugSearchTerms(details);
            Set<String> changed = new LinkedHashSet<>(changedFiles);
            return splitLines(trackedFiles).stream()
                    .map(file -> new FileScore(file, scoreFile(file, terms, changed.contains(file))))
                    .filter(item -> item.score > 0)
                    .sorted((left, right) -> {
                        int scoreCompare = Integer.compare(right.score, left.score);
                        return scoreCompare != 0 ? scoreCompare : left.file.compareTo(right.file);
                    })
                    .map(item -> item.file)
                    .collect(Collectors.toList());
        }

        private static Set<String> collectBugSearchTerms(List<BugDetail> details) {
            Set<String> terms = new LinkedHashSet<>();
            Pattern pattern = Pattern.compile("[A-Za-z][A-Za-z0-9_.-]{2,}");
            Pattern hanPattern = Pattern.compile("\\p{IsHan}{2,}");
            for (BugDetail detail : details) {
                String source = String.join(" ", List.of(
                        nullToEmpty(detail.id),
                        nullToEmpty(detail.title),
                        nullToEmpty(detail.description),
                        nullToEmpty(detail.reproduceSteps),
                        nullToEmpty(detail.expectedResult),
                        nullToEmpty(detail.actualResult)
                ));
                Matcher matcher = pattern.matcher(source);
                while (matcher.find()) {
                    String value = matcher.group().toLowerCase(Locale.ROOT);
                    if (!COMMON_BUG_TERMS.contains(value)) terms.add(value);
                }
                Matcher hanMatcher = hanPattern.matcher(source);
                while (hanMatcher.find()) {
                    String value = hanMatcher.group();
                    if (!COMMON_BUG_TERMS.contains(value)) {
                        terms.add(value.length() <= 10 ? value : value.substring(0, 10));
                    }
                    int maxSize = Math.min(4, value.length());
                    for (int size = 2; size <= maxSize; size++) {
                        for (int index = 0; index + size <= value.length(); index++) {
                            String token = value.substring(index, index + size);
                            if (!COMMON_BUG_TERMS.contains(token)) {
                                terms.add(token);
                            }
                            if (terms.size() >= 40) return terms;
                        }
                    }
                }
            }
            return terms;
        }

        private static int scoreFile(String file, Set<String> terms, boolean changed) {
            String normalized = file.toLowerCase(Locale.ROOT);
            int score = changed ? 20 : 0;
            for (String term : terms) {
                if (normalized.contains(term)) {
                    score += term.length() > 5 ? 8 : 4;
                }
            }
            if (file.matches("(?i).*\\.(ts|tsx|js|jsx|java|kt|cs|lua|py|go|rs|cpp|h|hpp)$")) {
                score += 2;
            }
            if (file.matches("(?i).*(test|spec|__tests__|tests?).*")) {
                score += 1;
            }
            return score;
        }

        private static List<String> splitLines(String value) {
            if (value == null || value.isBlank()) return List.of();
            return Pattern.compile("\\R").splitAsStream(value)
                    .map(String::trim)
                    .filter(line -> !line.isBlank())
                    .collect(Collectors.toList());
        }

        private static String formatBulletList(List<String> items, String fallback) {
            if (items == null || items.isEmpty()) return "- " + fallback;
            return items.stream().map(item -> "- " + item).collect(Collectors.joining("\n"));
        }

        private static String formatBlockList(List<String> items, String fallback) {
            if (items == null || items.isEmpty()) return "- " + fallback;
            return String.join("\n", items);
        }

        private static String formatDocumentLines(Document document, int startLine, int endLine) {
            List<String> lines = new ArrayList<>();
            for (int index = startLine; index <= endLine; index++) {
                int startOffset = document.getLineStartOffset(index);
                int endOffset = document.getLineEndOffset(index);
                String line = document.getCharsSequence().subSequence(startOffset, endOffset).toString();
                lines.add(String.format(Locale.ROOT, "%4d: %s", index + 1, line));
            }
            String value = String.join("\n", lines);
            return value.length() > 12000 ? value.substring(0, 12000) + "\n..." : value;
        }

        private static String languageFromFile(String file) {
            String lower = file == null ? "" : file.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".ts")) return "typescript";
            if (lower.endsWith(".tsx")) return "tsx";
            if (lower.endsWith(".js")) return "javascript";
            if (lower.endsWith(".jsx")) return "jsx";
            if (lower.endsWith(".java")) return "java";
            if (lower.endsWith(".kt")) return "kotlin";
            if (lower.endsWith(".cs")) return "csharp";
            if (lower.endsWith(".lua")) return "lua";
            if (lower.endsWith(".py")) return "python";
            if (lower.endsWith(".go")) return "go";
            if (lower.endsWith(".rs")) return "rust";
            if (lower.endsWith(".cpp") || lower.endsWith(".h") || lower.endsWith(".hpp")) return "cpp";
            if (lower.endsWith(".json")) return "json";
            if (lower.endsWith(".xml")) return "xml";
            if (lower.endsWith(".md")) return "markdown";
            return "";
        }

        private static List<String> uniqueStrings(List<String> items) {
            if (items == null || items.isEmpty()) return List.of();
            return items.stream()
                    .map(String::trim)
                    .filter(item -> !item.isBlank())
                    .distinct()
                    .collect(Collectors.toList());
        }

        private static String oneLine(String value) {
            List<String> lines = splitLines(value);
            return lines.isEmpty() ? "" : lines.get(0);
        }

        private static String nullToEmpty(String value) {
            return value == null ? "" : value;
        }

        private Path sendPromptForRepair(String prompt, List<String> bugIds) throws Exception {
            Path sessionFile = writeRepairSessionPackage(prompt, bugIds);
            if (REPAIR_MODE_CLI.equals(selectedRepairMode())) {
                sendPromptToCli(prompt, bugIds, sessionFile);
                return sessionFile;
            }
            sendToClaudeCode(prompt);
            return sessionFile;
        }

        private void sendPromptToCli(String prompt, List<String> bugIds, Path promptFile) throws Exception {
            if (openOfficialClaudeCodeAndPasteInstruction(promptFile, bugIds)) {
                setStatus("AI 修复指令已发送到 Claude Code 插件，会话包：" + promptFile);
                return;
            }
            String command = buildCliCommand(promptFile, bugIds);
            putPromptOnClipboard(command);
            if (openTerminalAndPasteCommand(command)) {
                setStatus("CLI 命令已发送到 Terminal，AI 修复会话包：" + promptFile);
                return;
            }
            Messages.showInfoMessage(project, "CLI 命令已复制到剪贴板，请在终端执行。\n\nAI 修复会话包：" + promptFile, "禅道助手");
        }

        private Path writeRepairSessionPackage(String prompt, List<String> bugIds) throws Exception {
            Path dir = repairSessionWriteDir();
            Files.createDirectories(dir);
            String idPart = bugIds == null || bugIds.isEmpty()
                    ? "bugs"
                    : String.join("-", bugIds).replaceAll("[^A-Za-z0-9._-]", "_");
            if (idPart.length() > 80) {
                idPart = idPart.substring(0, 80);
            }
            String stamp = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
            String prefix = bugIds == null || bugIds.size() <= 1 ? "bug-" : "bugs-";
            Path promptFile = dir.resolve(stamp + "-" + prefix + idPart + "-session.md");
            String ids = bugIds == null || bugIds.isEmpty()
                    ? "unknown"
                    : bugIds.stream().map(id -> "#" + id).collect(Collectors.joining(", "));
            String workspace = project.getBasePath() == null || project.getBasePath().isBlank() ? "未打开项目目录" : project.getBasePath();
            String content = "# ZenTao AI Repair Session\n\n"
                    + "- Created: " + java.time.OffsetDateTime.now() + "\n"
                    + "- Bugs: " + ids + "\n"
                    + "- Target: " + selectedRepairTargetLabel() + "\n"
                    + "- Engine: claudeCode\n"
                    + "- Repair Mode: " + selectedRepairMode() + "\n"
                    + "- Workspace: " + workspace + "\n\n"
                    + "---\n\n"
                    + "## Prompt\n\n"
                    + (prompt == null ? "" : prompt);
            Files.writeString(promptFile, content, StandardCharsets.UTF_8);
            return promptFile;
        }

        private Path workspaceRepairTempRoot() {
            String basePath = project.getBasePath();
            if (basePath == null || basePath.isBlank()) {
                return null;
            }
            return Path.of(basePath, "zentao_bug_assistant");
        }

        private Path workspaceRepairSessionDir() {
            Path tempRoot = workspaceRepairTempRoot();
            return tempRoot == null ? null : tempRoot.resolve("repair-sessions");
        }

        private Path globalRepairSessionDir() {
            return Path.of(PathManager.getSystemPath(), "zentao-bug-assistant", "repair-sessions");
        }

        private List<Path> repairSessionSearchDirs() {
            List<Path> dirs = new ArrayList<>();
            Path workspaceDir = workspaceRepairSessionDir();
            if (workspaceDir != null) {
                dirs.add(workspaceDir);
            }
            Path globalDir = globalRepairSessionDir();
            if (dirs.stream().noneMatch(dir -> dir.equals(globalDir))) {
                dirs.add(globalDir);
            }
            return dirs;
        }

        private Path repairSessionWriteDir() throws Exception {
            Path workspaceDir = workspaceRepairSessionDir();
            if (workspaceDir != null) {
                ensureRepairTempReady();
                return workspaceDir;
            }
            return globalRepairSessionDir();
        }

        private void ensureRepairTempReady() throws Exception {
            Path tempRoot = workspaceRepairTempRoot();
            if (tempRoot == null) {
                return;
            }
            Files.createDirectories(tempRoot);
        }

        private String buildCliCommand(Path promptFile, List<String> bugIds) throws Exception {
            String template = cliCommandTemplate();
            if (template.isBlank()) {
                if (isWindows()) {
                    return defaultWindowsClaudeRunnerCommand(promptFile, writeClaudeCliRunner());
                }
                template = defaultCliCommandTemplate();
            }
            String ids = bugIds == null ? "" : String.join(",", bugIds);
            return template
                    .replace("{promptFile}", quotePathForShell(promptFile))
                    .replace("{promptFileRaw}", promptFile.toAbsolutePath().toString())
                    .replace("{bugIds}", ids)
                    .replace("{engine}", "claudeCode");
        }

        private Path writeClaudeCliRunner() throws Exception {
            Path tempRoot = workspaceRepairTempRoot();
            Path root = tempRoot != null ? tempRoot : globalRepairSessionDir().getParent();
            if (root == null) {
                root = Path.of(PathManager.getSystemPath(), "zentao-bug-assistant");
            }
            Files.createDirectories(root);
            Path runner = root.resolve("run-claude-agent.ps1");
            Files.writeString(runner, "\uFEFF" + claudeCliRunnerPowerShell(), StandardCharsets.UTF_8);
            return runner;
        }

        private String cliCommandTemplate() {
            PropertiesComponent projectProperties = projectProperties();
            String projectTemplate = projectProperties == null ? "" : projectProperties.getValue("zentao.idea.cliCommandTemplate", "");
            if (projectTemplate != null && !projectTemplate.isBlank()) {
                return projectTemplate.trim();
            }
            return PropertiesComponent.getInstance().getValue("zentao.idea.settings.cliCommandTemplate", "");
        }

        private static String defaultCliCommandTemplate() {
            return isWindows()
                    ? "Get-Content -Raw -LiteralPath {promptFile} | claude --print"
                    : "claude -p --verbose --permission-mode acceptEdits --output-format stream-json --include-partial-messages < {promptFile}";
        }

        private static String defaultWindowsClaudeRunnerCommand(Path promptFile, Path runnerFile) {
            return "powershell -NoProfile -ExecutionPolicy Bypass -File "
                    + quotePathForShell(runnerFile)
                    + " -PromptFile "
                    + quotePathForShell(promptFile);
        }

        private static String claudeCliRunnerPowerShell() {
            return String.join("\n",
                    "param(",
                    "  [Parameter(Mandatory=$true)]",
                    "  [string]$PromptFile",
                    ")",
                    "$ProgressPreference = 'SilentlyContinue'",
                    "$ErrorActionPreference = 'Stop'",
                    "try {",
                    "  $__ztUtf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false",
                    "  [Console]::InputEncoding = $__ztUtf8",
                    "  [Console]::OutputEncoding = $__ztUtf8",
                    "  $OutputEncoding = $__ztUtf8",
                    "  chcp 65001 > $null 2>$null",
                    "} catch {",
                    "}",
                    "$__ztPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path",
                    "$__ztWorkspace = (Get-Location).Path",
                    "$__ztInstruction = \"Read this exact UTF-8 Markdown file and execute the ZenTao bug-fix task described in it. File: $__ztPromptFile. If this exact file cannot be read, print CANNOT_READ and stop; do not use any other repair-session file.\"",
                    "function Invoke-ZenTaoClaudeAgent {",
                    "  param([string]$Instruction)",
                    "  $state = @{ printed = $false; openLine = $false; busyLine = $false; busyFlag = ''; busyStatus = ''; busyProcess = $null; lastText = ''; streamedText = ''; toolTotal = 0; toolSeen = @{}; toolParts = @{}; thinkingChars = 0; thinkingTokens = 0 }",
                    "  function Clear-BusyLine {",
                    "    if (-not $state.busyLine) { return }",
                    "    if ($state.busyFlag) { Remove-Item -LiteralPath $state.busyFlag -Force -ErrorAction SilentlyContinue }",
                    "    if ($state.busyStatus) { Remove-Item -LiteralPath $state.busyStatus -Force -ErrorAction SilentlyContinue }",
                    "    if ($state.busyProcess) {",
                    "      try {",
                    "        [void]$state.busyProcess.WaitForExit(1000)",
                    "        if (-not $state.busyProcess.HasExited) { $state.busyProcess.Kill() }",
                    "      } catch {}",
                    "      $state.busyProcess = $null",
                    "    }",
                    "    $state.busyFlag = ''",
                    "    $state.busyStatus = ''",
                    "    $width = 120",
                    "    try { $width = [Math]::Max(80, [Console]::BufferWidth - 1) } catch {}",
                    "    [Console]::Write([char]13 + (' ' * $width) + [char]13)",
                    "    $state.busyLine = $false",
                    "  }",
                    "  function Show-BusyLine {",
                    "    param([string]$Text = 'working')",
                    "    if ($state.openLine -or $state.busyLine) { return }",
                    "    $state.busyLine = $true",
                    "    $state.busyFlag = [System.IO.Path]::GetTempFileName()",
                    "    $state.busyStatus = [System.IO.Path]::GetTempFileName()",
                    "    try { [System.IO.File]::WriteAllText($state.busyStatus, $Text, [System.Text.Encoding]::ASCII) } catch {}",
                    "    $safeFlag = $state.busyFlag.Replace(\"'\", \"''\")",
                    "    $safeStatus = $state.busyStatus.Replace(\"'\", \"''\")",
                    "    $script = \"`$ProgressPreference='SilentlyContinue'; `$flag='$safeFlag'; `$statusFile='$safeStatus'; `$verbs=@('Thinking','Working','Hatching','Churning'); `$start=Get-Date; while(Test-Path -LiteralPath `$flag){ `$elapsed=[int]((Get-Date)-`$start).TotalSeconds; `$status=''; try { if(Test-Path -LiteralPath `$statusFile){ `$status=[System.IO.File]::ReadAllText(`$statusFile).Trim() } } catch {}; `$verb=`$verbs[[int]([Math]::Floor(`$elapsed / 3) % `$verbs.Count)]; `$dots='.' * ((`$elapsed % 3)+1); if(`$status -match '^thinking:(\\d+)$'){ `$label=('{0}{1} ~{2} tokens' -f `$verb, `$dots, `$Matches[1]) } elseif(`$status -match '^tool:(.+)$'){ `$label=('Tool ' + `$Matches[1]) } elseif(`$status -eq 'working' -or -not `$status){ `$label=`$verb + `$dots } else { `$label=`$status }; [Console]::Write(([char]13 + ('{0} {1}s   ' -f `$label, `$elapsed))); Start-Sleep -Milliseconds 1000 }; try { `$width=[Math]::Max(80,[Console]::BufferWidth-1) } catch { `$width=120 }; [Console]::Write(([char]13 + (' ' * `$width) + [char]13))\"",
                    "    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))",
                    "    try {",
                    "      $state.busyProcess = Start-Process powershell -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-OutputFormat','Text','-EncodedCommand',$encoded) -NoNewWindow -PassThru",
                    "    } catch {",
                    "      [Console]::Write($Text + ' ... ')",
                    "    }",
                    "  }",
                    "  function Set-BusyStatus {",
                    "    param([string]$Text)",
                    "    if (-not $state.busyStatus) { return }",
                    "    try { [System.IO.File]::WriteAllText($state.busyStatus, $Text, [System.Text.Encoding]::ASCII) } catch {}",
                    "  }",
                    "  function Shorten-Text {",
                    "    param([string]$Value, [int]$Max = 120)",
                    "    if (-not $Value) { return '' }",
                    "    $text = ($Value -replace '\\s+', ' ').Trim()",
                    "    if ($text.Length -le $Max) { return $text }",
                    "    return $text.Substring(0, $Max - 3) + '...'",
                    "  }",
                    "  function Shorten-Path {",
                    "    param([string]$Value)",
                    "    if (-not $Value) { return '' }",
                    "    $path = $Value",
                    "    if ($path.StartsWith($__ztWorkspace, [System.StringComparison]::OrdinalIgnoreCase)) {",
                    "      $path = $path.Substring($__ztWorkspace.Length).TrimStart([char]92, [char]47)",
                    "    }",
                    "    return Shorten-Text $path 140",
                    "  }",
                    "  function Input-Value {",
                    "    param($InputObject, [string[]]$Names)",
                    "    if (-not $InputObject) { return '' }",
                    "    foreach ($name in $Names) {",
                    "      if ($InputObject.PSObject.Properties.Name -contains $name) { return [string]$InputObject.PSObject.Properties[$name].Value }",
                    "    }",
                    "    return ''",
                    "  }",
                    "  function Tool-Summary {",
                    "    param($Part)",
                    "    $name = [string]$Part.name",
                    "    $toolInput = $Part.input",
                    "    $path = Input-Value $toolInput @('file_path', 'path')",
                    "    $pattern = Input-Value $toolInput @('pattern', 'query', 'glob', 'regex')",
                    "    $command = Input-Value $toolInput @('command', 'cmd')",
                    "    if ($name -eq 'Read') { if ($path) { return 'Read ' + (Shorten-Path $path) }; return 'Read pending' }",
                    "    if ($name -eq 'Grep') { if ($pattern) { return 'Grepped ' + (Shorten-Text $pattern 120) }; return 'Grepped pending' }",
                    "    if ($name -eq 'Glob') { if ($pattern) { return 'Searched files ' + (Shorten-Text $pattern 120) }; return 'Searched files pending' }",
                    "    if ($name -eq 'Edit' -or $name -eq 'MultiEdit' -or $name -eq 'Write') { return $name + ' ' + (Shorten-Path $path) }",
                    "    if ($name -eq 'Bash') { return 'Ran ' + (Shorten-Text $command 120) }",
                    "    if ($name) { return $name }",
                    "    return 'Tool'",
                    "  }",
                    "  function Write-AssistantText {",
                    "    param([string]$Text)",
                    "    if (-not $Text) { return }",
                    "    Clear-BusyLine",
                    "    $shouldBreakBeforeDelta = $false",
                    "    if ($state.lastText -and $Text.StartsWith($state.lastText)) {",
                    "      $delta = $Text.Substring($state.lastText.Length)",
                    "    } elseif ($state.streamedText -and $Text.StartsWith($state.streamedText)) {",
                    "      $delta = $Text.Substring($state.streamedText.Length)",
                    "    } elseif ($Text -eq $state.lastText) {",
                    "      $delta = ''",
                    "    } elseif ($state.streamedText -and $state.streamedText.EndsWith($Text)) {",
                    "      $delta = ''",
                    "    } elseif ($Text.Length -le 120 -and -not $Text.Contains(\"`n\")) {",
                    "      $delta = $Text",
                    "    } else {",
                    "      $shouldBreakBeforeDelta = $true",
                    "      $delta = $Text",
                    "    }",
                    "    if ($state.openLine -and $delta -match '^[\\r\\n\\s]+\\p{P}') {",
                    "      $delta = $delta -replace '^[\\r\\n\\s]+', ''",
                    "      $shouldBreakBeforeDelta = $false",
                    "    }",
                    "    if ($shouldBreakBeforeDelta -and $state.openLine) {",
                    "      [Console]::WriteLine()",
                    "      $state.openLine = $false",
                    "    }",
                    "    if ($delta) {",
                    "      [Console]::Write($delta)",
                    "      $state.printed = $true",
                    "      $state.openLine = -not ($delta -match '[\\r\\n]$')",
                    "      $state.streamedText += $delta",
                    "      if (-not $state.openLine) { Show-BusyLine }",
                    "    }",
                    "    $state.lastText = $Text",
                    "  }",
                    "  function Write-ActivityLog {",
                    "    param([string]$Text)",
                    "    if (-not $Text) { return }",
                    "    Clear-BusyLine",
                    "    if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
                    "    Write-Host $Text -ForegroundColor DarkGray",
                    "    Show-BusyLine",
                    "  }",
                    "  $__ztErrFile = [System.IO.Path]::GetTempFileName()",
                    "  try {",
                    "    Show-BusyLine 'Claude starting'",
                    "    claude -p --verbose --permission-mode acceptEdits --output-format stream-json --include-partial-messages $Instruction 2> $__ztErrFile | ForEach-Object {",
                    "      $line = [string]$_",
                    "      try {",
                    "        $event = $line | ConvertFrom-Json -ErrorAction Stop",
                    "        if ($event.type -eq 'system' -and $event.subtype -eq 'init') {",
                    "          Clear-BusyLine",
                    "          Write-Host ('[Claude] model=' + $event.model + ' cwd=' + $event.cwd) -ForegroundColor DarkGray",
                    "          Show-BusyLine 'thinking:0'",
                    "        } elseif ($event.type -eq 'stream_event') {",
                    "          $inner = $event.event",
                    "          if ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'text_delta') {",
                    "            Write-AssistantText ([string]$inner.delta.text)",
                    "          } elseif ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'thinking_delta') {",
                    "            $state.thinkingChars = [int]$state.thinkingChars + ([string]$inner.delta.thinking).Length",
                    "            $state.thinkingTokens = [int][Math]::Max(1, [Math]::Ceiling([double]$state.thinkingChars / 4.0))",
                    "            if ($state.busyLine) { Set-BusyStatus ('thinking:' + $state.thinkingTokens) } elseif (-not $state.openLine) { Show-BusyLine ('thinking:' + $state.thinkingTokens) }",
                    "          } elseif ($inner.type -eq 'content_block_delta' -and $inner.delta -and $inner.delta.type -eq 'input_json_delta') {",
                    "            $indexKey = [string]$inner.index",
                    "            if ($state.toolParts.ContainsKey($indexKey)) {",
                    "              $tool = $state.toolParts[$indexKey]",
                    "              $tool.inputJson = [string]$tool.inputJson + [string]$inner.delta.partial_json",
                    "              try {",
                    "                $toolInput = $tool.inputJson | ConvertFrom-Json -ErrorAction Stop",
                    "                $partObject = [pscustomobject]@{ name = $tool.name; input = $toolInput }",
                    "                $detailKey = $tool.id + ':detail'",
                    "                $detailSummary = Tool-Summary $partObject",
                    "                if (-not $state.toolSeen.ContainsKey($detailKey)) {",
                    "                  if ($detailSummary -notmatch 'pending$') {",
                    "                    Write-ActivityLog $detailSummary",
                    "                    $state.toolSeen[$detailKey] = $true",
                    "                  }",
                    "                }",
                    "              } catch {}",
                    "            }",
                    "          } elseif ($inner.type -eq 'content_block_start' -and $inner.content_block -and $inner.content_block.type -eq 'tool_use') {",
                    "            $indexKey = [string]$inner.index",
                    "            $toolId = [string]$inner.content_block.id",
                    "            if (-not $toolId) { $toolId = ([string]$inner.content_block.name) + ':' + $state.toolTotal }",
                    "            $state.toolParts[$indexKey] = @{ id = $toolId; name = [string]$inner.content_block.name; inputJson = '' }",
                    "            if (-not $state.toolSeen.ContainsKey($toolId)) {",
                    "              $state.toolSeen[$toolId] = $true",
                    "              $state.toolTotal = [int]$state.toolTotal + 1",
                    "              Clear-BusyLine",
                    "              if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
                    "              $busyText = 'tool:' + [string]$inner.content_block.name",
                    "              if (-not [string]$inner.content_block.name) { $busyText = 'working' }",
                    "              Show-BusyLine $busyText",
                    "            }",
                    "          } elseif ($inner.type -eq 'message_start') {",
                    "            if (-not $state.openLine) { Show-BusyLine 'Claude generating' }",
                    "          }",
                    "        } elseif ($event.type -eq 'assistant') {",
                    "          foreach ($part in @($event.message.content)) {",
                    "            if ($part.type -eq 'text' -and $part.text) {",
                    "              Write-AssistantText ([string]$part.text)",
                    "            } elseif ($part.type -eq 'tool_use') {",
                    "              $toolId = [string]$part.id",
                    "              if (-not $toolId) { $toolId = ([string]$part.name) + ':' + $state.toolTotal }",
                    "              $summary = Tool-Summary $part",
                    "              if (-not $state.toolSeen.ContainsKey($toolId)) {",
                    "                $state.toolSeen[$toolId] = $true",
                    "                $state.toolTotal = [int]$state.toolTotal + 1",
                    "                if ($summary -notmatch 'pending$') { Write-ActivityLog $summary }",
                    "              } elseif ($part.input) {",
                    "                $detailKey = $toolId + ':detail'",
                    "                if (-not $state.toolSeen.ContainsKey($detailKey)) {",
                    "                  if ($summary -notmatch 'pending$') { Write-ActivityLog $summary }",
                    "                  $state.toolSeen[$detailKey] = $true",
                    "                }",
                    "              }",
                    "            }",
                    "          }",
                    "        } elseif ($event.type -eq 'result') {",
                    "          Clear-BusyLine",
                    "          if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
                    "          if (-not $state.printed -and $event.result) { Write-Host $event.result }",
                    "          if ($state.toolTotal -gt 0) { Write-Host ('Tools total: ' + $state.toolTotal + ' calls') -ForegroundColor DarkGray }",
                    "          if ($event.is_error) {",
                    "            Write-Host ('[Claude] failed duration=' + $event.duration_ms + 'ms') -ForegroundColor Red",
                    "          } else {",
                    "            Write-Host ('[Claude] done duration=' + $event.duration_ms + 'ms') -ForegroundColor DarkGray",
                    "          }",
                    "        }",
                    "      } catch {",
                    "        if ($line -and -not $line.TrimStart().StartsWith('{')) {",
                    "          Clear-BusyLine",
                    "          if ($state.openLine) { [Console]::WriteLine(); $state.openLine = $false }",
                    "          Write-Host $line",
                    "        }",
                    "      }",
                    "    }",
                    "    Clear-BusyLine",
                    "    if ($state.openLine) { [Console]::WriteLine() }",
                    "    $__ztExit = $LASTEXITCODE",
                    "    if ($__ztExit -ne 0) {",
                    "      $err = ''",
                    "      try { $err = [System.IO.File]::ReadAllText($__ztErrFile, [System.Text.Encoding]::UTF8).Trim() } catch {}",
                    "      if ($err) {",
                    "        $lines = @($err -split '\\r?\\n' | Where-Object { $_ -and $_ -notmatch '^\\s*\\+ ' -and $_ -notmatch '^\\s*~' -and $_ -notmatch '^\\s*CategoryInfo' -and $_ -notmatch '^\\s*FullyQualifiedErrorId' } | Select-Object -First 8)",
                    "        Write-Host '[Claude] error:' -ForegroundColor Red",
                    "        Write-Host ($lines -join \"`n\") -ForegroundColor Red",
                    "      }",
                    "    }",
                    "    return $__ztExit",
                    "  } finally {",
                    "    Clear-BusyLine",
                    "    Remove-Item -LiteralPath $__ztErrFile -Force -ErrorAction SilentlyContinue",
                    "  }",
                    "}",
                    "$__ztExitCode = Invoke-ZenTaoClaudeAgent $__ztInstruction",
                    "if ($__ztExitCode -ne 0) {",
                    "  Write-Host 'Claude failed; retrying once...' -ForegroundColor Yellow",
                    "  Start-Sleep -Seconds 2",
                    "  $__ztExitCode = Invoke-ZenTaoClaudeAgent $__ztInstruction",
                    "}",
                    "exit $__ztExitCode"
            );
        }

        private static boolean isWindows() {
            return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        }

        private static String quotePathForShell(Path path) {
            String raw = path.toAbsolutePath().toString();
            if (isWindows()) {
                return "'" + raw.replace("'", "''") + "'";
            }
            return "'" + raw.replace("'", "'\"'\"'") + "'";
        }

        private static String quotePowerShellString(String value) {
            return "'" + (value == null ? "" : value).replace("'", "''") + "'";
        }

        private static String encodePowerShellCommand(String command) {
            return Base64.getEncoder().encodeToString(command.getBytes(StandardCharsets.UTF_16LE));
        }

        private boolean openOfficialClaudeCodeAndPasteInstruction(Path promptFile, List<String> bugIds) {
            try {
                AnAction action = ActionManager.getInstance().getAction(OFFICIAL_CLAUDE_TERMINAL_ACTION_ID);
                if (action == null) {
                    debugLog("official-claude-action-missing", OFFICIAL_CLAUDE_TERMINAL_ACTION_ID);
                    return false;
                }
                ZenTaoPlatformCompat.performAction(
                        action,
                        DataManager.getInstance().getDataContext(root),
                        ActionPlaces.UNKNOWN
                );
                pasteInstructionIntoClaudeCodeTerminal(claudeCodeInteractiveInstruction(promptFile, bugIds));
                return true;
            } catch (Throwable error) {
                debugLog("official-claude-action-failed", readableError(rootCause(error)));
                return false;
            }
        }

        private String claudeCodeInteractiveInstruction(Path promptFile, List<String> bugIds) {
            String ids = bugIds == null || bugIds.isEmpty() ? "unknown" : bugIds.stream().map(id -> "#" + id).collect(Collectors.joining(", "));
            return "请读取下面这个 UTF-8 Markdown 禅道修复会话文件，并直接在当前 IntelliJ 工程里执行修复任务。\n"
                    + "文件路径：" + promptFile.toAbsolutePath() + "\n"
                    + "Bug：" + ids + "\n\n"
                    + "要求：\n"
                    + "1. 以会话文件里的截图、诊断包、代码证据和修复协议为准。\n"
                    + "2. 优先做最小可信修复，不要重复扩大搜索范围。\n"
                    + "3. 修改完成后给出根因、改动文件、验证结果和剩余风险。";
        }

        private void pasteInstructionIntoClaudeCodeTerminal(String instruction) {
            javax.swing.Timer timer = new javax.swing.Timer(2600, event -> {
                ((javax.swing.Timer)event.getSource()).stop();
                if (project.isDisposed()) return;
                putPromptOnClipboard(instruction);
                nativePastePrompt();
                nativePressEnter();
            });
            timer.setRepeats(false);
            timer.start();
        }

        private boolean openTerminalAndPasteCommand(String command) {
            try {
                ToolWindow terminal = ToolWindowManager.getInstance(project).getToolWindow("Terminal");
                if (terminal != null) {
                    terminal.activate(() -> pasteCommandIntoTerminal(command), true);
                    return true;
                }
            } catch (Throwable error) {
                debugLog("terminal-toolwindow-failed", readableError(rootCause(error)));
            }

            ActionManager manager = ActionManager.getInstance();
            for (String actionId : TERMINAL_ACTION_IDS) {
                try {
                    AnAction action = manager.getAction(actionId);
                    if (action != null) {
                        ZenTaoPlatformCompat.performAction(
                                action,
                                DataManager.getInstance().getDataContext(root),
                                ActionPlaces.UNKNOWN
                        );
                        pasteCommandIntoTerminal(command);
                        return true;
                    }
                } catch (Throwable error) {
                    debugLog("terminal-action-failed", actionId + ": " + readableError(rootCause(error)));
                }
            }
            return false;
        }

        private void pasteCommandIntoTerminal(String command) {
            javax.swing.Timer timer = new javax.swing.Timer(1200, event -> {
                ((javax.swing.Timer)event.getSource()).stop();
                if (project.isDisposed()) return;
                putPromptOnClipboard(command);
                nativePastePrompt();
                nativePressEnter();
            });
            timer.setRepeats(false);
            timer.start();
        }

        private String selectedRepairMode() {
            return REPAIR_MODE_CLI;
        }

        private void setRepairMode(String mode) {
            repairModeBox.setSelectedIndex(1);
        }

        private String selectedRepairTargetLabel() {
            return REPAIR_MODE_CLI.equals(selectedRepairMode()) ? "CLI" : "Claude Chat";
        }

        private void sendToClaudeCode(String prompt) {
            putPromptOnClipboard(prompt);
            ActionManager manager = ActionManager.getInstance();
            for (String actionId : CLAUDE_ACTION_IDS) {
                try {
                    AnAction action = manager.getAction(actionId);
                    if (action != null) {
                        ZenTaoPlatformCompat.performAction(
                                action,
                                DataManager.getInstance().getDataContext(root),
                                ActionPlaces.UNKNOWN
                        );
                        pastePromptIntoClaudeChat(prompt);
                        return;
                    }
                } catch (Throwable error) {
                    debugLog("claude-action-failed", actionId + ": " + readableError(rootCause(error)));
                }
            }
            Messages.showInfoMessage(project, "修复提示词已复制到剪贴板，请粘贴到 Claude Chat。", "禅道助手");
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

        private void nativePressEnter() {
            try {
                java.awt.Robot robot = new java.awt.Robot();
                robot.setAutoDelay(40);
                robot.keyPress(java.awt.event.KeyEvent.VK_ENTER);
                robot.keyRelease(java.awt.event.KeyEvent.VK_ENTER);
            } catch (Exception error) {
                debugLog("terminal-enter-failed", error.getMessage());
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
                            client.login(serverField.getText(), accountField.getText(), resolvedPasswordForLogin());
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
                    return invokeAsyncSupplier(status, supplier, false);
                }

                @Override
                protected void done() {
                    if (project.isDisposed()) return;
                    try {
                        onSuccess.accept(get());
                    } catch (Throwable error) {
                        handleAsyncFailure(error);
                    } finally {
                        try {
                            setLoading(false, null);
                        } catch (Exception error) {
                            handleAsyncFailure(error);
                        }
                    }
                }
            }.execute();
        }

        private <T> T invokeAsyncSupplier(String status, ThrowingSupplier<T> supplier, boolean retriedNetwork) throws Exception {
            try {
                return supplier.get();
            } catch (Exception error) {
                if (!status.contains("登录") && isSessionExpiredError(error) && canRetryLogin()) {
                    client.login(serverField.getText(), accountField.getText(), resolvedPasswordForLogin());
                    return supplier.get();
                }
                if (!retriedNetwork && isTransientNetworkError(error)) {
                    Thread.sleep(1000);
                    return invokeAsyncSupplier(status, supplier, true);
                }
                throw error;
            }
        }

        private void handleAsyncFailure(Throwable error) {
            Throwable cause = rootCause(error);
            if (isSessionExpiredError(cause)) {
                handleSessionExpiredFailure(cause);
                return;
            }
            setStatus("失败：" + briefStatusError(cause));
            debugLog("async-failed", readableError(cause));
            if (!isTransientNetworkError(cause)) {
                showErrorPopupWithOptOut("禅道助手", detailedError(cause));
            }
        }

        private void setLoading(boolean value, String status) {
            loading = value;
            if (status != null) setStatus(status);
            refreshButton.setEnabled(!value);
            clearImageCacheButton.setEnabled(!value);
            aiEngineBox.setEnabled(!value);
            repairModeBox.setEnabled(false);
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
            if (isSessionExpiredError(cause)) {
                handleSessionExpiredFailure(cause);
                return;
            }
            setStatus("失败：" + briefStatusError(cause));
            debugLog("detailed-error", readableError(cause));
            if (!isTransientNetworkError(cause)) {
                showErrorPopupWithOptOut(title, detailedError(cause));
            }
        }

        private void handleSessionExpiredFailure(Throwable cause) {
            debugLog("session-expired", readableError(cause));
            client.clearSession();
            clearPasswordMaskIfNoSavedPassword();
            updateLoginState(false);
            savePreferences();
            setStatus("禅道登录已超时，请重新输入密码后登录。");
        }

        private void clearPasswordMaskIfNoSavedPassword() {
            if (!PASSWORD_MASK.equals(visiblePasswordText())) {
                return;
            }
            if (loadPasswordSecurely(serverField.getText(), accountField.getText()).isBlank()) {
                passwordField.setText("");
            }
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
                if (error instanceof HttpConnectTimeoutException) {
                    return "禅道服务器连接超时，请检查地址、VPN 或网络后重试";
                }
                if (error instanceof java.net.http.HttpTimeoutException) {
                    return "禅道请求超时，请稍后重试";
                }
                if (error instanceof java.net.UnknownHostException) {
                    return "无法解析禅道地址，请检查服务器 URL";
                }
                if (error instanceof java.net.ConnectException) {
                    return "无法连接禅道服务器，请检查地址与网络";
                }
                return "网络异常，请检查禅道地址或网络连接";
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
            return !accountField.getText().isBlank() && !resolvedPasswordForLogin().isBlank();
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
                if (current instanceof HttpConnectTimeoutException
                        || current instanceof java.net.http.HttpTimeoutException
                        || current instanceof SocketTimeoutException
                        || current instanceof java.net.ConnectException
                        || current instanceof java.net.UnknownHostException
                        || current instanceof java.net.NoRouteToHostException) {
                    return true;
                }
                String message = current.getMessage();
                if (message != null) {
                    String lower = message.toLowerCase(Locale.ROOT);
                    if (lower.contains("timed out")
                            || lower.contains("connect timed out")
                            || lower.contains("connection reset")
                            || lower.contains("connection refused")
                            || lower.contains("network is unreachable")) {
                        return true;
                    }
                }
                current = current.getCause();
            }
            return false;
        }

        private final class BugCard extends JPanel {
            private BugCard(BugSummary bug) {
                super();
                setLayout(new javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS));
                Color borderColor = mixColors(PANEL_BORDER, statusColor(bug.status), 0.3f);
                setBorder(new CompoundBorder(new LineBorder(borderColor, 1, true), JBUI.Borders.empty(10, 10)));
                setBackground(statusBackground(bug.status));
                setOpaque(true);
                setAlignmentX(Component.LEFT_ALIGNMENT);
                JPanel title = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
                title.setOpaque(false);
                title.setAlignmentX(Component.LEFT_ALIGNMENT);
                JLabel id = new JLabel("#" + bug.id);
                id.setForeground(new JBColor(new Color(33, 88, 192), new Color(112, 166, 255)));
                id.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 13));
                title.add(id);
                PillBadge status = new PillBadge(statusText(bug.status));
                status.setBadgeColors(statusColor(bug.status), Color.WHITE);
                title.add(status);
                JLabel assigned = new JLabel("指派给：" + assigneeText(bug.assignedTo));
                assigned.setForeground(TEXT_SUB);
                assigned.setFont(new Font("Microsoft YaHei UI", Font.PLAIN, 11));
                title.add(assigned);
                if (!bug.priority.equals("unknown")) title.add(new JLabel(priorityText(bug.priority)));
                if (bug.hasVideo) title.add(new JLabel("🎬 视频"));
                title.setMaximumSize(new Dimension(Integer.MAX_VALUE, title.getPreferredSize().height));
                add(title);
                add(javax.swing.Box.createVerticalStrut(4));
                JLabel summary = new JLabel("<html>" + html(bug.title) + "</html>");
                summary.setForeground(TEXT_MAIN);
                summary.setFont(new Font("Microsoft YaHei UI", Font.BOLD, 13));
                summary.setAlignmentX(Component.LEFT_ALIGNMENT);
                summary.setMaximumSize(new Dimension(Integer.MAX_VALUE, summary.getPreferredSize().height + 8));
                add(summary);
                add(javax.swing.Box.createVerticalStrut(8));
                JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
                buttons.setOpaque(false);
                buttons.setAlignmentX(Component.LEFT_ALIGNMENT);
                SolidButton preview = solidButton("预览", BTN_PREVIEW_BG, ARC_DEFAULT);
                onPress(preview, () -> preview(bug.id));
                buttons.add(preview);
                if (!bug.status.equals("resolved") && !bug.status.equals("closed")) {
                    SolidButton assign = solidButton("指派", BTN_ASSIGN_BG, ARC_DEFAULT);
                    onPress(assign, () -> submitWorkflow(bug.id, "assign"));
                    buttons.add(assign);
                    if (!bug.confirmed) {
                        SolidButton confirm = solidButton("确认", BTN_CONFIRM_BG, ARC_DEFAULT);
                        onPress(confirm, () -> submitWorkflow(bug.id, "confirm"));
                        buttons.add(confirm);
                    }
                    SolidButton resolve = solidButton("解决", BTN_RESOLVE_BG, ARC_DEFAULT);
                    onPress(resolve, () -> submitWorkflow(bug.id, "resolve"));
                    buttons.add(resolve);
                    SolidButton close = solidButton("关闭", BTN_CLOSE_BG, ARC_DEFAULT);
                    onPress(close, () -> submitWorkflow(bug.id, "close"));
                    buttons.add(close);
                    GradientButton aiFix = new GradientButton("AI修复", false, true);
                    onPress(aiFix, () -> aiFix(bug.id));
                    buttons.add(aiFix);
                } else if (bug.status.equals("resolved")) {
                    SolidButton activate = solidButton("激活", BTN_ACTIVATE_BG, ARC_DEFAULT);
                    onPress(activate, () -> submitWorkflow(bug.id, "activate"));
                    buttons.add(activate);
                    SolidButton close = solidButton("关闭", BTN_CLOSE_BG, ARC_DEFAULT);
                    onPress(close, () -> submitWorkflow(bug.id, "close"));
                    buttons.add(close);
                } else {
                    SolidButton activate = solidButton("激活", BTN_ACTIVATE_BG, ARC_DEFAULT);
                    onPress(activate, () -> submitWorkflow(bug.id, "activate"));
                    buttons.add(activate);
                }
                buttons.setMaximumSize(new Dimension(Integer.MAX_VALUE, buttons.getPreferredSize().height));
                add(buttons);
                addMouseListener(new MouseAdapter() {
                    @Override
                    public void mouseClicked(MouseEvent event) {
                        if (event.getClickCount() == 2) preview(bug.id);
                    }
                });
            }

            @Override
            public Dimension getMaximumSize() {
                Dimension preferred = getPreferredSize();
                return new Dimension(Integer.MAX_VALUE, preferred.height);
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
                case "closed": return new Color(95, 99, 104);
                case "active": return new Color(180, 35, 24);
                default: return new Color(161, 92, 0);
            }
        }

        private static Color statusBackground(String status) {
            Color lightEditor = new Color(245, 247, 250);
            Color darkEditor = new Color(35, 37, 42);
            switch (status) {
                case "resolved":
                    return new JBColor(mixColors(lightEditor, new Color(31, 122, 58), 0.1f), mixColors(darkEditor, new Color(31, 122, 58), 0.1f));
                case "closed":
                    return new JBColor(mixColors(lightEditor, new Color(95, 99, 104), 0.08f), mixColors(darkEditor, new Color(95, 99, 104), 0.08f));
                case "active":
                    return new JBColor(mixColors(lightEditor, new Color(180, 35, 24), 0.1f), mixColors(darkEditor, new Color(180, 35, 24), 0.1f));
                default:
                    return new JBColor(mixColors(lightEditor, new Color(161, 92, 0), 0.1f), mixColors(darkEditor, new Color(161, 92, 0), 0.1f));
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

        private static final class SparkleIcon implements Icon {
            private final int size;

            private SparkleIcon(int size) {
                this.size = size;
            }

            @Override
            public void paintIcon(Component c, Graphics g, int x, int y) {
                Graphics2D g2 = (Graphics2D) g.create();
                setupPaintQuality(g2);
                g2.setColor(c.getForeground());
                g2.setStroke(new BasicStroke(1.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
                int cx = x + size / 2;
                int cy = y + size / 2;
                int r = Math.max(2, size / 2 - 1);
                g2.drawLine(cx, cy - r, cx, cy + r);
                g2.drawLine(cx - r, cy, cx + r, cy);
                g2.drawLine(cx - r * 2 / 3, cy - r * 2 / 3, cx + r * 2 / 3, cy + r * 2 / 3);
                g2.drawLine(cx - r * 2 / 3, cy + r * 2 / 3, cx + r * 2 / 3, cy - r * 2 / 3);
                g2.dispose();
            }

            @Override
            public int getIconWidth() {
                return size;
            }

            @Override
            public int getIconHeight() {
                return size;
            }
        }

        private static final class SolidButton extends JButton {
            private final Color baseColor;
            private final int arc;
            private boolean hovered;

            @Override
            public void updateUI() {
                setUI(new javax.swing.plaf.basic.BasicButtonUI());
            }

            @Override
            public boolean contains(int x, int y) {
                return x >= 0 && y >= 0 && x < getWidth() && y < getHeight();
            }

            private SolidButton(String text, Color baseColor, int arc) {
                super(text);
                this.baseColor = baseColor;
                this.arc = arc;
                setFocusPainted(false);
                setContentAreaFilled(false);
                setBorderPainted(false);
                setOpaque(false);
                setForeground(BTN_TEXT);
                setFont(BUTTON_FONT);
                setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
                addMouseListener(new MouseAdapter() {
                    @Override
                    public void mouseEntered(MouseEvent event) {
                        hovered = true;
                        repaint();
                    }

                    @Override
                    public void mouseExited(MouseEvent event) {
                        hovered = false;
                        repaint();
                    }
                });
            }

            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                setupPaintQuality(g2);
                int w = getWidth();
                int h = getHeight();
                int radius = cornerRadius(arc, h);
                Color fill = !isEnabled()
                        ? withAlpha(baseColor, 100)
                        : hovered ? brighten(baseColor, 1.08f) : baseColor;
                g2.setColor(fill);
                g2.fillRoundRect(0, 0, w, h, radius, radius);
                g2.dispose();
                super.paintComponent(g);
            }
        }

        private static final class PillBadge extends JLabel {
            private Color background = new JBColor(new Color(230, 232, 236), new Color(75, 80, 89));
            private Color foregroundColor = TEXT_SUB;

            private PillBadge(String text) {
                super(text);
                setOpaque(false);
                setFont(CHIP_FONT);
                setBorder(new EmptyBorder(3, 8, 3, 8));
            }

            private void setLoggedIn(boolean loggedIn) {
                if (loggedIn) {
                    background = new Color(115, 201, 145);
                    foregroundColor = Color.WHITE;
                } else {
                    background = new JBColor(new Color(230, 232, 236), new Color(75, 80, 89));
                    foregroundColor = TEXT_SUB;
                }
                repaint();
            }

            private void setBadgeColors(Color background, Color foreground) {
                this.background = background;
                this.foregroundColor = foreground;
                repaint();
            }

            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                setupPaintQuality(g2);
                int w = getWidth();
                int h = getHeight();
                g2.setColor(background);
                g2.fillRoundRect(0, 0, w, h, h, h);
                g2.dispose();
                setForeground(foregroundColor);
                super.paintComponent(g);
            }
        }

        private static final class GradientButton extends JButton {
            private static final Color GRADIENT_START = new Color(124, 58, 237);
            private static final Color GRADIENT_MID = new Color(37, 99, 235);
            private static final Color GRADIENT_END = new Color(6, 182, 212);
            private final boolean pill;
            private boolean hovered;

            @Override
            public boolean contains(int x, int y) {
                return x >= 0 && y >= 0 && x < getWidth() && y < getHeight();
            }

            @Override
            public void updateUI() {
                setUI(new javax.swing.plaf.basic.BasicButtonUI());
            }

            private GradientButton(String text, boolean pill, boolean showSparkle) {
                super(text);
                this.pill = pill;
                setFocusPainted(false);
                setContentAreaFilled(false);
                setBorderPainted(false);
                setOpaque(false);
                setForeground(Color.WHITE);
                setFont(BUTTON_FONT);
                setBorder(new EmptyBorder(4, showSparkle ? 8 : 10, 4, 10));
                setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
                if (showSparkle) {
                    setIcon(new SparkleIcon(10));
                    setIconTextGap(4);
                }
                addMouseListener(new MouseAdapter() {
                    @Override
                    public void mouseEntered(MouseEvent event) {
                        hovered = true;
                        repaint();
                    }

                    @Override
                    public void mouseExited(MouseEvent event) {
                        hovered = false;
                        repaint();
                    }
                });
            }

            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                setupPaintQuality(g2);
                int w = getWidth();
                int h = getHeight();
                int radius = pill ? h : ARC_DEFAULT;
                if (!isEnabled()) {
                    g2.setColor(new JBColor(new Color(200, 203, 208), new Color(75, 80, 89)));
                    g2.fillRoundRect(0, 0, w, h, radius, radius);
                } else {
                    LinearGradientPaint paint = new LinearGradientPaint(
                            0, 0, w, h,
                            new float[] {0f, 0.52f, 1f},
                            new Color[] {
                                    hovered ? brighten(GRADIENT_START, 1.06f) : GRADIENT_START,
                                    hovered ? brighten(GRADIENT_MID, 1.06f) : GRADIENT_MID,
                                    hovered ? brighten(GRADIENT_END, 1.06f) : GRADIENT_END
                            });
                    g2.setPaint(paint);
                    g2.fillRoundRect(0, 0, w, h, radius, radius);
                }
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

        private static final class FileScore {
            final String file;
            final int score;

            FileScore(String file, int score) {
                this.file = file;
                this.score = score;
            }
        }

        private static final class AiContextReview {
            final int score;
            final String label;
            final List<String> signals;
            final List<String> gaps;

            AiContextReview(int score, String label, List<String> signals, List<String> gaps) {
                this.score = score;
                this.label = label;
                this.signals = signals;
                this.gaps = gaps;
            }
        }

        private static final class PromptBuilder {
            private static final String REPAIR_EXECUTION_PROTOCOL = "【AI修复执行协议】\n"
                    + "请严格按以下顺序处理：\n"
                    + "1. 先阅读后文的 AI 诊断包，优先使用其中的代码证据、候选文件和推荐验证命令。\n"
                    + "2. 若诊断包证据不足，先在当前仓库中搜索定位，不要只根据 Bug 标题猜测改动点。\n"
                    + "3. 只做与当前 Bug 直接相关的最小必要改动，避免无关重构、格式化整文件或改动禅道业务数据。\n"
                    + "4. 保留当前工作区已有未提交改动；不要执行 git reset、revert 或覆盖无关文件。\n"
                    + "5. 修复后优先运行诊断包推荐的验证命令；如果无法运行，必须说明原因和替代验证方式。\n"
                    + "6. 不要假称已经验证。未执行的命令要明确写“未执行”。\n\n"
                    + "最终请按这个格式输出，便于回写禅道：\n"
                    + "【AI修复报告】\n"
                    + "- Bug：#编号 / 标题\n"
                    + "- 根因：\n"
                    + "- 改动文件：\n"
                    + "- 关键改动：\n"
                    + "- 验证命令与结果：\n"
                    + "- 剩余风险：\n"
                    + "- 禅道回写摘要：";

            private static String build(BugDetail bug) {
                List<String> images = safePromptImages(bug).stream().limit(32).collect(Collectors.toList());
                String imageText = images.isEmpty() ? "未提供" : indexedImages(images, "");
                String description = textOrFallback(bug.description, bug.title);
                String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                String expectedText = textOrFallback(htmlText(bug.expectedResultHtml), bug.expectedResult);
                String actualText = textOrFallback(bug.actualResult);
                String attachmentText = formatAttachments(bug, "");
                return "【Bug修复任务】\nBug编号：" + bug.id
                        + "\n\n禅道缺陷单：\n" + formatBugMetadata(bug)
                        + "\n\nBug描述：\n" + description
                        + "\n\n复现步骤文本：\n" + reproduceText
                        + "\n\n期望结果：\n" + expectedText
                        + "\n\n实际结果：\n" + actualText
                        + "\n\n复现步骤图片：\n" + imageText
                        + "\n\n附件/视频线索：\n" + attachmentText
                        + "\n\n说明：图片已由 IDEA 使用当前禅道登录态下载为本地文件，AI Agent 可直接读取上述本地路径，不需要访问禅道链接；视频文件不传给 AI，但文件名和链接会作为排查线索。"
                        + "\n\n请在当前代码仓库中修复以上 Bug。\n\n"
                        + REPAIR_EXECUTION_PROTOCOL;
            }

            private static String buildBatch(List<BugDetail> bugs) {
                List<String> sections = new ArrayList<>();
                for (int i = 0; i < bugs.size(); i++) {
                    BugDetail bug = bugs.get(i);
                    List<String> images = safePromptImages(bug).stream().limit(32).collect(Collectors.toList());
                    String imageText = images.isEmpty() ? "  未提供" : indexedImages(images, "  ");
                    String description = textOrFallback(bug.description, bug.title);
                    String reproduceText = textOrFallback(htmlText(bug.reproduceStepsHtml), bug.reproduceSteps);
                    String expectedText = textOrFallback(htmlText(bug.expectedResultHtml), bug.expectedResult);
                    String actualText = textOrFallback(bug.actualResult);
                    String attachmentText = formatAttachments(bug, "  ");
                    sections.add("## " + (i + 1) + ". Bug #" + bug.id
                            + "\n\n禅道缺陷单：\n" + indentLines(formatBugMetadata(bug), "  ")
                            + "\n\nBug描述：\n" + description
                            + "\n\n复现步骤文本：\n" + reproduceText
                            + "\n\n期望结果：\n" + expectedText
                            + "\n\n实际结果：\n" + actualText
                            + "\n\n复现步骤图片：\n" + imageText
                            + "\n\n附件/视频线索：\n" + attachmentText);
                }
                return "【批量Bug修复任务】\n以下是当前列表中的未解决 Bug，请在当前代码仓库中依次分析并修复。\n\n"
                        + String.join("\n\n---\n\n", sections)
                        + "\n\n说明：图片已由 IDEA 使用当前禅道登录态下载为本地文件，AI Agent 可直接读取上述本地路径，不需要访问禅道链接；视频文件不传给 AI，但文件名和链接会作为排查线索。"
                        + "\n\n请在当前代码仓库中按 Bug 编号依次修复。\n\n"
                        + REPAIR_EXECUTION_PROTOCOL
                        + "\n\n批量任务要求：每个 Bug 都要单独给出一份【AI修复报告】，不要把多个 Bug 的根因、验证和风险混在一起。";
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

            private static String formatBugMetadata(BugDetail bug) {
                return String.join("\n",
                        "- 标题：" + textOrFallback(bug.title),
                        "- 状态：" + textOrFallback(bug.status),
                        "- 优先级：" + textOrFallback(bug.priority),
                        "- 当前指派：" + textOrFallback(bug.assignedTo),
                        "- 创建者：" + textOrFallback(bug.openedBy),
                        "- 创建时间：" + textOrFallback(bug.createdAt));
            }

            private static String formatAttachments(BugDetail bug, String prefix) {
                if (bug == null || bug.attachments == null || bug.attachments.isEmpty()) return prefix + "未提供";
                List<String> lines = new ArrayList<>();
                for (int i = 0; i < bug.attachments.size() && i < 16; i++) {
                    Attachment attachment = bug.attachments.get(i);
                    String kind = textOrFallback(attachment.kind, "file");
                    String name = textOrFallback(attachment.name, "附件" + (i + 1));
                    String url = attachment.url == null || attachment.url.isBlank() ? "" : "：" + attachment.url;
                    lines.add(prefix + "- " + kind + " " + name + url);
                }
                return String.join("\n", lines);
            }

            private static String indentLines(String value, String prefix) {
                return java.util.Arrays.stream((value == null ? "" : value).split("\\R", -1))
                        .map(line -> prefix + line)
                        .collect(Collectors.joining("\n"));
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

            private static Path bugImageDir() {
                return Path.of(PathManager.getSystemPath(), "zentao-bug-assistant", "bug-images");
            }

            private void cleanupOldPromptImages(Duration maxAge) {
                if (maxAge == null) return;
                Path imageDir = bugImageDir();
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
                Path imageDir = bugImageDir();
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

            private void clearSession() {
                cookieJar.clear();
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
                String html = decodeJsonHtml(String.join("\n", pages));
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
                BugListParseException parseFailure = null;
                for (Map<String, String> param : bugParams(projectId, assignedTo)) {
                    try {
                        List<BugSummary> parsed = fetchBugListAllPages(param, assignedTo);
                        if (!parsed.isEmpty()) return parsed;
                    } catch (BugListParseException error) {
                        parseFailure = error;
                    }
                }
                if (parseFailure != null) {
                    throw parseFailure;
                }
                return List.of();
            }

            private List<BugSummary> fetchBugListAllPages(Map<String, String> baseParams, String assignedTo) throws Exception {
                Map<String, String> firstParams = new LinkedHashMap<>(baseParams);
                BugListPage firstPage = getBugListPage(firstParams, assignedTo, null);
                String firstHtml = firstPage.html;
                List<BugSummary> firstBugs = parseBugs(firstHtml, assignedTo);
                BugListPager pager = parseBugListPager(firstHtml);
                assertBugListParseHealthy(firstHtml, firstBugs, firstParams);
                if (pager == null || pager.pageTotal <= 1) {
                    return firstBugs;
                }

                boolean openOnlyBySearchFallback = isBySearchFallbackParams(baseParams)
                        && !firstBugs.isEmpty()
                        && firstBugs.stream().allMatch(ZenTaoClient::isOpenBug);
                List<BugSummary> allBugs = openOnlyBySearchFallback
                        ? firstBugs.stream().filter(ZenTaoClient::isOpenBug).collect(Collectors.toCollection(ArrayList::new))
                        : new ArrayList<>(firstBugs);
                for (int page = 2; page <= pager.pageTotal; page++) {
                    Map<String, String> pageParams = new LinkedHashMap<>(baseParams);
                    pageParams.put("recTotal", String.valueOf(pager.recTotal));
                    pageParams.put("recPerPage", String.valueOf(pager.recPerPage));
                    pageParams.put("pageID", String.valueOf(page));
                    try {
                        List<BugSummary> pageBugs = parseBugs(getBugListPage(pageParams, assignedTo, firstPage.ajax).html, assignedTo);
                        if (firstPage.ajax && hasSameBugIds(pageBugs, firstBugs)) {
                            pageBugs = parseBugs(getBugListPage(pageParams, assignedTo, false).html, assignedTo);
                            if (hasSameBugIds(pageBugs, firstBugs)) break;
                        }
                        List<BugSummary> bugsToAdd = openOnlyBySearchFallback
                                ? pageBugs.stream().filter(ZenTaoClient::isOpenBug).collect(Collectors.toList())
                                : pageBugs;
                        if (bugsToAdd.isEmpty() && !allBugs.isEmpty()) break;
                        allBugs.addAll(bugsToAdd);
                        if (openOnlyBySearchFallback && pageBugs.stream().anyMatch(bug -> !isOpenBug(bug))) break;
                    } catch (Exception error) {
                        if (!allBugs.isEmpty()) break;
                        throw error;
                    }
                }
                Map<String, BugSummary> deduped = new LinkedHashMap<>();
                for (BugSummary bug : allBugs) deduped.putIfAbsent(bug.id, bug);
                return new ArrayList<>(deduped.values());
            }

            private BugListPage getBugListPage(Map<String, String> params, String assignedTo, Boolean preferredAjax) throws Exception {
                List<Boolean> modes = preferredAjax == null ? List.of(true, false) : List.of(preferredAjax, !preferredAjax);
                BugListPage fallback = null;
                BugListParseException parseFailure = null;
                Set<Boolean> seen = new LinkedHashSet<>();
                for (Boolean ajax : modes) {
                    if (!seen.add(ajax)) continue;
                    String html = get("index.php", params, ajax);
                    List<BugSummary> bugs = parseBugs(html, assignedTo);
                    try {
                        assertBugListParseHealthy(html, bugs, params);
                    } catch (BugListParseException error) {
                        parseFailure = error;
                        continue;
                    }
                    BugListPage page = new BugListPage(html, ajax);
                    if (!bugs.isEmpty() || hasBugListPageEvidence(html)) return page;
                    if (fallback == null) fallback = page;
                }
                if (parseFailure != null) throw parseFailure;
                return fallback == null ? new BugListPage("", preferredAjax == null || preferredAjax) : fallback;
            }

            private static BugListPager parseBugListPager(String html) {
                String source = decodeJsonHtml(html);
                Integer recTotal = readPagerNumber(source, "recTotal");
                int recPerPage = readPagerNumber(source, "recPerPage") != null ? readPagerNumber(source, "recPerPage") : PAGE_SIZE;
                int pageID = readPagerNumber(source, "pageID") != null ? readPagerNumber(source, "pageID") : 1;
                Integer pageTotal = readPagerNumber(source, "pageTotal");

                Integer total = recTotal;
                if (total == null) {
                    Matcher summery = Pattern.compile("共\\s*(?:<[^>]+>\\s*)?(\\d+)\\s*(?:</[^>]+>\\s*)?项", Pattern.CASE_INSENSITIVE).matcher(source);
                    if (summery.find()) total = Integer.parseInt(summery.group(1));
                }
                if (total == null) {
                    Matcher summery = Pattern.compile(",\\s*共\\s*(\\d+)\\s*项", Pattern.CASE_INSENSITIVE).matcher(source);
                    if (summery.find()) total = Integer.parseInt(summery.group(1));
                }
                if (total == null || total <= 0) return null;

                int perPage = recPerPage > 0 ? recPerPage : PAGE_SIZE;
                int pages = pageTotal != null && pageTotal > 0 ? pageTotal : Math.max(1, (int) Math.ceil(total / (double) perPage));
                int current = pageID > 0 ? pageID : 1;
                return new BugListPager(total, perPage, current, pages);
            }

            private static Integer readPagerNumber(String html, String key) {
                List<Integer> hiddenValues = new ArrayList<>();
                Matcher hidden = Pattern.compile("<input\\b[^>]*\\b(?:id|name)=[\"']_?" + Pattern.quote(key) + "[\"'][^>]*\\bvalue=[\"'](\\d+)[\"']", Pattern.CASE_INSENSITIVE).matcher(html);
                while (hidden.find()) {
                    int parsed = Integer.parseInt(hidden.group(1));
                    if (parsed > 0) hiddenValues.add(parsed);
                }
                hidden = Pattern.compile("<input\\b[^>]*\\bvalue=[\"'](\\d+)[\"'][^>]*\\b(?:id|name)=[\"']_?" + Pattern.quote(key) + "[\"']", Pattern.CASE_INSENSITIVE).matcher(html);
                while (hidden.find()) {
                    int parsed = Integer.parseInt(hidden.group(1));
                    if (parsed > 0) hiddenValues.add(parsed);
                }
                if (!hiddenValues.isEmpty()) {
                    return "recTotal".equalsIgnoreCase(key) ? hiddenValues.stream().min(Integer::compareTo).orElse(null) : hiddenValues.get(0);
                }

                Matcher fromUrl = Pattern.compile("(?:[?&]|&amp;)" + Pattern.quote(key) + "=?(\\d+)", Pattern.CASE_INSENSITIVE).matcher(html);
                Integer value = null;
                while (fromUrl.find()) {
                    int parsed = Integer.parseInt(fromUrl.group(1));
                    if ("recTotal".equalsIgnoreCase(key)) {
                        if (parsed > 0) value = value == null ? parsed : Math.min(value, parsed);
                    } else {
                        value = parsed;
                    }
                }
                if (value != null) return value;

                Matcher fromJs = Pattern.compile(Pattern.quote(key) + "\\s*[:=]\\s*['\"]?(\\d+)", Pattern.CASE_INSENSITIVE).matcher(html);
                if (fromJs.find()) return Integer.parseInt(fromJs.group(1));
                return null;
            }

            private static final class BugListPager {
                private final int recTotal;
                private final int recPerPage;
                private final int pageID;
                private final int pageTotal;

                private BugListPager(int recTotal, int recPerPage, int pageID, int pageTotal) {
                    this.recTotal = recTotal;
                    this.recPerPage = recPerPage;
                    this.pageID = pageID;
                    this.pageTotal = pageTotal;
                }
            }

            private static final class BugListPage {
                private final String html;
                private final boolean ajax;

                private BugListPage(String html, boolean ajax) {
                    this.html = html;
                    this.ajax = ajax;
                }
            }

            private static final class BugListParseException extends RuntimeException {
                private BugListParseException(String message) {
                    super(message);
                }
            }

            private static boolean hasBugListPageEvidence(String html) {
                String source = decodeJsonHtml(html);
                BugListPager pager = parseBugListPager(source);
                int bugLinkCount = matches(source, "(?i)m=bug[^\"']*f=view|f=view[^\"']*m=bug|bug[-/]view|bug-view").size();
                int bugIdPatternCount = matches(source, "(?i)(?:bugID|bug-id|data-bug-id|data-bug|id=[\"']bug)\\D{0,12}\\d+").size();
                boolean hasNoDataText = htmlText(source).matches("(?is).*(暂无|没有|无数据|No data|No records).*");
                return (pager != null && pager.recTotal > 0)
                        || bugLinkCount > 0
                        || (bugIdPatternCount > 0 && !hasNoDataText);
            }

            private static void assertBugListParseHealthy(String html, List<BugSummary> bugs, Map<String, String> params) {
                if (!bugs.isEmpty()) return;
                String source = decodeJsonHtml(html);
                String text = htmlText(source);
                BugListPager pager = parseBugListPager(source);
                int rowCount = matches(source, "<tr\\b[\\s\\S]*?</tr>").size();
                int cellCount = matches(source, "<td\\b[\\s\\S]*?</td>").size();
                int bugLinkCount = matches(source, "(?i)m=bug[^\"']*f=view|f=view[^\"']*m=bug|bug[-/]view|bug-view").size();
                int bugIdPatternCount = matches(source, "(?i)(?:bugID|bug-id|data-bug-id|data-bug|id=[\"']bug)\\D{0,12}\\d+").size();
                boolean hasReturnedBugRows = hasBugListPageEvidence(source);
                if (!hasReturnedBugRows) return;
                String preview = text.replaceAll("\\s+", " ").trim();
                if (preview.length() > 260) preview = preview.substring(0, 260);
                throw new BugListParseException("禅道返回了 Bug 列表痕迹，但插件解析为 0。请反馈当前项目、筛选条件和页面摘要以便补充解析规则。请求参数：" + params + "；页面摘要：rows=" + rowCount + ", cells=" + cellCount + ", bugLinks=" + bugLinkCount + ", bugIdPatterns=" + bugIdPatternCount + ", recTotal=" + (pager == null ? "unknown" : pager.recTotal) + "；预览：" + preview);
            }

            private static final class LinkContext {
                private final String text;
                private final String context;

                private LinkContext(String text, String context) {
                    this.text = text;
                    this.context = context;
                }
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
                        String text = htmlText(decodeJsonHtml(html));
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
                String source = decodeJsonHtml(html);
                List<String> rows = matches(source, "<tr\\b[\\s\\S]*?</tr>");
                List<String> header = rows.stream().filter(row -> htmlText(row).matches(".*(Bug标题|标题|指派给|创建者|提交者).*")).findFirst().map(row -> matches(row, "<t[dh]\\b[\\s\\S]*?</t[dh]>").stream().map(ZenTaoClient::htmlText).collect(Collectors.toList())).orElse(List.of());
                int titleIndex = indexOf(header, "Bug标题|标题");
                int openedIndex = indexOf(header, "创建者|由谁创建|提交者");
                int createdIndex = indexOf(header, "创建日期|创建时间");
                int assignedIndex = indexOf(header, "指派给");
                int confirmedIndex = indexOf(header, "确认");
                List<BugSummary> result = new ArrayList<>();
                for (String row : rows) {
                    List<String> cells = matches(row, "<td\\b[\\s\\S]*?</td>").stream().map(ZenTaoClient::htmlText).collect(Collectors.toList());
                    String id = firstNonBlank(readBugIdFromRow(row), positiveBugId(cells.stream().filter(cell -> cell.matches("#?\\d+")).findFirst().orElse("").replace("#", "")));
                    if (id.isBlank()) continue;
                    String linkText = matches(row, "<a\\b[^>]*href=[\"'][^\"']*(?:(?:m=bug[^\"']*f=view)|(?:f=view[^\"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^\"']*[\"'][^>]*>[\\s\\S]*?</a>")
                            .stream()
                            .map(ZenTaoClient::htmlText)
                            .filter(text -> !text.isBlank() && !text.equals(id) && !text.matches("#?\\d+"))
                            .findFirst()
                            .orElse("");
                    String title = cell(cells, titleIndex);
                    if (title.isBlank() || title.matches("#?\\d+")) title = !linkText.isBlank() && !linkText.equals(id) && !linkText.matches("#?\\d+") ? linkText : cells.stream().filter(cell -> isLikelyBugTitleCell(cell, id)).findFirst().orElse("Bug #" + id);
                    boolean confirmed = isConfirmedText(cell(cells, confirmedIndex)) || cells.stream().anyMatch(ZenTaoClient::isConfirmedText);
                    result.add(new BugSummary(id, title, parsePriority(String.join(" ", cells)), parseStatus(String.join(" ", cells)), cell(cells, createdIndex), cell(cells, assignedIndex).isBlank() ? assignedTo : cell(cells, assignedIndex), cell(cells, openedIndex), looksLikeVideo(String.join(" ", cells)), confirmed));
                }
                Map<String, BugSummary> deduped = new LinkedHashMap<>();
                for (BugSummary bug : result) deduped.putIfAbsent(bug.id, bug);
                List<BugSummary> tableBugs = new ArrayList<>(deduped.values());
                if (!tableBugs.isEmpty()) return tableBugs;
                List<BugSummary> linkBugs = parseBugLinks(source, assignedTo);
                return linkBugs.isEmpty() ? parseBugDataIdContexts(source, assignedTo) : linkBugs;
            }

            private List<BugSummary> parseBugLinks(String html, String assignedTo) {
                String source = decodeJsonHtml(html);
                Map<String, List<LinkContext>> grouped = new LinkedHashMap<>();
                for (String link : matches(source, "<a\\b[^>]*href=[\"'][^\"']*(?:(?:m=bug[^\"']*f=view)|(?:f=view[^\"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^\"']*[\"'][^>]*>[\\s\\S]*?</a>")) {
                    String href = attr(link, "href");
                    String id = firstNonBlank(readBugIdFromHref(href), positiveBugId(htmlText(link).replaceFirst("^#?(\\d+)$", "$1")));
                    if (id == null || id.isBlank()) continue;
                    int index = source.indexOf(link);
                    String context = index >= 0
                            ? source.substring(Math.max(0, index - 1600), Math.min(source.length(), index + 2600))
                            : link;
                    grouped.computeIfAbsent(id, ignored -> new ArrayList<>()).add(new LinkContext(htmlText(link), context));
                }

                List<BugSummary> result = new ArrayList<>();
                for (Map.Entry<String, List<LinkContext>> entry : grouped.entrySet()) {
                    String id = entry.getKey();
                    String contextText = entry.getValue().stream().map(item -> htmlText(item.context)).collect(Collectors.joining(" "));
                    String title = entry.getValue().stream()
                            .map(item -> item.text == null ? "" : item.text.trim())
                            .filter(text -> !text.isBlank() && !text.equals(id) && !text.equals("#" + id) && !text.matches("#?\\d+"))
                            .findFirst()
                            .orElse("Bug #" + id);
                    result.add(new BugSummary(
                            id,
                            title,
                            parsePriority(contextText),
                            parseStatus(contextText),
                            firstMatch(contextText, "\\d{4}-\\d{2}-\\d{2}|\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}"),
                            firstNonBlank(readAssigneeFromContext(contextText), assignedTo),
                            "",
                            looksLikeVideo(contextText),
                            isConfirmedText(contextText)
                    ));
                }
                return result;
            }

            private List<BugSummary> parseBugDataIdContexts(String html, String assignedTo) {
                String source = decodeJsonHtml(html);
                Map<String, BugSummary> result = new LinkedHashMap<>();
                Matcher matcher = Pattern.compile("\\bdata-(?:bug-id|bug|id)=[\"']([1-9]\\d*)[\"']", Pattern.CASE_INSENSITIVE).matcher(source);
                while (matcher.find()) {
                    String id = positiveBugId(matcher.group(1));
                    if (id.isBlank() || result.containsKey(id)) continue;
                    String contextHtml = source.substring(Math.max(0, matcher.start() - 1800), Math.min(source.length(), matcher.start() + 3200));
                    String contextText = htmlText(contextHtml);
                    if (!looksLikeBugListContext(id, contextHtml, contextText)) continue;
                    result.put(id, new BugSummary(
                            id,
                            extractBugTitleFromContext(id, contextText),
                            parsePriority(contextText),
                            parseStatus(contextText),
                            firstMatch(contextText, "\\d{4}-\\d{2}-\\d{2}|\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}"),
                            firstNonBlank(readAssigneeFromContext(contextText), assignedTo),
                            "",
                            looksLikeVideo(contextText),
                            isConfirmedText(contextText)
                    ));
                }
                return new ArrayList<>(result.values());
            }

            private static boolean looksLikeBugListContext(String id, String html, String text) {
                if (text == null || !text.contains(id)) return false;
                boolean hasBugMarker = html.matches("(?is).*(bugIDList|bugID|Bug|bug[-/]view|bug-view|m=bug).*") || text.contains("Bug");
                boolean hasStatus = text.matches("(?is).*(激活|已解决|关闭|active|resolved|closed|婵€娲粅宸茶В鍐硘鍏抽棴).*");
                boolean hasPriority = text.matches("(?is).*(一般|严重|致命|建议|高|中|低|high|medium|low|涓€鑸瑋涓ラ噸|鑷村懡|寤鸿|楂榺涓瓅浣?).*");
                boolean hasDate = text.matches("(?is).*?(\\d{4}-\\d{2}-\\d{2}|\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}).*");
                return hasBugMarker && hasStatus && hasPriority && hasDate;
            }

            private static String extractBugTitleFromContext(String id, String text) {
                String normalized = text == null ? "" : text.replaceAll("\\s+", " ").trim();
                int idIndex = normalized.indexOf(id);
                String afterId = idIndex >= 0 ? normalized.substring(idIndex + id.length()).trim() : normalized;
                Matcher matcher = Pattern.compile("^(.{4,160}?)(?:\\s+(?:一般|严重|致命|建议|高|中|低|high|medium|low|激活|已解决|关闭|未确认|已确认|\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}|涓€鑸?|涓ラ噸|鑷村懡|寤鸿|婵€娲?|宸茶В鍐?|鍏抽棴))", Pattern.CASE_INSENSITIVE).matcher(afterId);
                if (matcher.find()) {
                    String title = matcher.group(1).trim();
                    if (!title.isBlank()) return title;
                }
                String fallback = afterId.length() > 120 ? afterId.substring(0, 120).trim() : afterId.trim();
                return fallback.isBlank() ? "Bug #" + id : fallback;
            }

            private static String readBugIdFromHref(String href) {
                String source = href == null ? "" : href.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'");
                return positiveBugId(firstNonBlank(
                        readQueryParam(source, "bugID"),
                        readQueryParam(source, "id"),
                        firstMatch(source, "bug[-/]view[-/](\\d+)"),
                        firstMatch(source, "bug-view-(\\d+)"),
                        firstMatch(source, "[?&]bug=(\\d+)"),
                        firstMatch(source, "(?:^|[/?&=-])bugID[=/](\\d+)"),
                        firstMatch(source, "(?:^|[/?&=-])id[=/](\\d+)")
                ));
            }

            private static String readBugIdFromRow(String row) {
                for (String link : matches(row, "<a\\b[^>]*href=[\"'][^\"']*(?:(?:m=bug[^\"']*f=view)|(?:f=view[^\"']*m=bug)|(?:bug[-/]view)|(?:bug-view))[^\"']*[\"'][^>]*>[\\s\\S]*?</a>")) {
                    String id = readBugIdFromHref(attr(link, "href"));
                    if (!id.isBlank()) return id;
                }
                for (String attrName : List.of("data-bug-id", "data-bug")) {
                    String value = positiveBugId(firstMatch(attr(row, attrName), "\\d+"));
                    if (value != null && !value.isBlank()) return value;
                }
                for (String input : matches(row, "<input\\b[^>]*>")) {
                    String inputMarker = attr(input, "name") + " " + attr(input, "id") + " " + attr(input, "class");
                    if (!inputMarker.matches("(?is).*bug.*")) continue;
                    String value = positiveBugId(firstMatch(attr(input, "value"), "\\d+"));
                    if (value != null && !value.isBlank()) return value;
                }
                String inlineBugId = firstMatch(row, "\\bbugID\\s*[:=]\\s*[\"']?(\\d+)");
                return positiveBugId(inlineBugId);
            }

            private static String positiveBugId(String value) {
                if (value == null) return "";
                String text = value.trim().replaceFirst("^#", "");
                return text.matches("[1-9]\\d*") ? text : "";
            }

            private static String readAssigneeFromContext(String value) {
                return firstMatch(value, "指派给\\s*[:：]?\\s*([^\\s,，;；|]+)");
            }

            private List<Map<String, String>> bugParams(String projectId, String assignedTo) {
                Map<String, String> base = new LinkedHashMap<>();
                base.put("m", "bug");
                base.put("f", "browse");
                if (projectId != null && !projectId.isBlank()) base.put("productID", projectId);
                if (!assignedTo.isBlank()) base.put("assignedTo", assignedTo);
                List<Map<String, String>> result = new ArrayList<>();
                List<Map<String, String>> bases = bugScopeParamVariants(base);
                for (Map<String, String> scopedBase : bases) {
                    Map<String, String> lowercaseProductParams = withLowercaseProductId(scopedBase);
                    Map<String, String> visible = new LinkedHashMap<>(scopedBase);
                    visible.put("branch", "all");
                    visible.put("browseType", "unclosed");
                    visible.put("param", "0");
                    visible.put("orderBy", "");
                    result.add(visible);
                    Map<String, String> lowerVisible = new LinkedHashMap<>(lowercaseProductParams);
                    lowerVisible.put("branch", "all");
                    lowerVisible.put("browseType", "unclosed");
                    lowerVisible.put("param", "0");
                    lowerVisible.put("orderBy", "");
                    result.add(lowerVisible);
                    Map<String, String> lowerUnresolved = new LinkedHashMap<>(lowercaseProductParams);
                    lowerUnresolved.put("branch", "all");
                    lowerUnresolved.put("browseType", "unresolved");
                    result.add(lowerUnresolved);
                    Map<String, String> upperUnresolved = new LinkedHashMap<>(scopedBase);
                    upperUnresolved.put("branch", "all");
                    upperUnresolved.put("browseType", "unresolved");
                    result.add(upperUnresolved);
                    result.add(scopedBase);
                    Map<String, String> exactBySearch = new LinkedHashMap<>(scopedBase);
                    exactBySearch.put("branch", "all");
                    exactBySearch.put("browseType", "bySearch");
                    exactBySearch.put("param", "0");
                    exactBySearch.put("orderBy", "");
                    result.add(exactBySearch);
                    Map<String, String> lowerBySearch = new LinkedHashMap<>(lowercaseProductParams);
                    lowerBySearch.put("branch", "all");
                    lowerBySearch.put("browseType", "bySearch");
                    lowerBySearch.put("param", "0");
                    lowerBySearch.put("orderBy", "");
                    result.add(lowerBySearch);
                    Map<String, String> lowerBySearchSimple = new LinkedHashMap<>(lowercaseProductParams);
                    lowerBySearchSimple.put("branch", "all");
                    lowerBySearchSimple.put("browseType", "bySearch");
                    result.add(lowerBySearchSimple);
                    Map<String, String> unresolved = new LinkedHashMap<>(scopedBase);
                    unresolved.put("browseType", "unresolved");
                    result.add(unresolved);
                    Map<String, String> bySearch = new LinkedHashMap<>(scopedBase);
                    bySearch.put("browseType", "bySearch");
                    result.add(bySearch);
                    Map<String, String> all = new LinkedHashMap<>(scopedBase);
                    all.put("browseType", "all");
                    result.add(all);
                    Map<String, String> unclosed = new LinkedHashMap<>(scopedBase);
                    unclosed.put("browseType", "unclosed");
                    result.add(unclosed);
                    Map<String, String> assignToMe = new LinkedHashMap<>(scopedBase);
                    assignToMe.put("browseType", "assigntome");
                    result.add(assignToMe);
                    Map<String, String> ordered = new LinkedHashMap<>(scopedBase);
                    ordered.put("browseType", "all");
                    ordered.put("param", "0");
                    ordered.put("orderBy", "id_desc");
                    result.add(ordered);
                }
                return dedupeParams(result);
            }

            private static Map<String, String> withLowercaseProductId(Map<String, String> params) {
                Map<String, String> next = new LinkedHashMap<>(params);
                if (next.containsKey("productID")) {
                    next.put("productid", next.remove("productID"));
                }
                return next;
            }

            private static List<Map<String, String>> bugScopeParamVariants(Map<String, String> baseParams) {
                String scopeId = firstNonBlank(
                        baseParams.get("productID"),
                        baseParams.get("productid"),
                        baseParams.get("projectID"),
                        baseParams.get("executionID")
                );
                if (scopeId == null || scopeId.isBlank()) return List.of(baseParams);

                Map<String, String> base = new LinkedHashMap<>(baseParams);
                base.remove("productID");
                base.remove("productid");
                base.remove("projectID");
                base.remove("executionID");

                List<Map<String, String>> result = new ArrayList<>();
                result.add(new LinkedHashMap<>(baseParams));
                Map<String, String> productUpper = new LinkedHashMap<>(base);
                productUpper.put("productID", scopeId);
                result.add(productUpper);
                Map<String, String> productLower = new LinkedHashMap<>(base);
                productLower.put("productid", scopeId);
                result.add(productLower);
                Map<String, String> project = new LinkedHashMap<>(base);
                project.put("projectID", scopeId);
                result.add(project);
                Map<String, String> execution = new LinkedHashMap<>(base);
                execution.put("executionID", scopeId);
                result.add(execution);
                Map<String, String> projectBug = new LinkedHashMap<>(base);
                projectBug.put("m", "project");
                projectBug.put("f", "bug");
                projectBug.put("projectID", scopeId);
                result.add(projectBug);
                Map<String, String> executionBug = new LinkedHashMap<>(base);
                executionBug.put("m", "execution");
                executionBug.put("f", "bug");
                executionBug.put("executionID", scopeId);
                result.add(executionBug);
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
                List<Map<String, String>> bases = bugScopeParamVariants(base);
                for (Map<String, String> scopedBase : bases) {
                    Map<String, String> visible = new LinkedHashMap<>(scopedBase);
                    visible.put("branch", "all");
                    visible.put("browseType", "unclosed");
                    visible.put("param", "0");
                    visible.put("orderBy", "");
                    result.add(visible);
                    String scopedId = firstNonBlank(
                            scopedBase.get("productID"),
                            scopedBase.get("productid"),
                            scopedBase.get("projectID"),
                            scopedBase.get("executionID")
                    );
                    if (scopedId != null && !scopedId.isBlank()) {
                        Map<String, String> lowerVisible = new LinkedHashMap<>(scopedBase);
                        lowerVisible.remove("productID");
                        lowerVisible.put("productid", scopedId);
                        lowerVisible.put("branch", "all");
                        lowerVisible.put("browseType", "unclosed");
                        lowerVisible.put("param", "0");
                        lowerVisible.put("orderBy", "");
                        result.add(lowerVisible);
                    }
                }
                result.addAll(bases);
                for (Map<String, String> scopedBase : bases) {
                    for (String type : List.of("bySearch", "all", "unclosed", "assigntome")) {
                        Map<String, String> next = new LinkedHashMap<>(scopedBase);
                        next.put("browseType", type);
                        result.add(next);
                    }
                }
                return dedupeParams(result);
            }

            private static boolean isBySearchFallbackParams(Map<String, String> params) {
                return "bug".equals(params.get("m"))
                        && "browse".equals(params.get("f"))
                        && "bysearch".equalsIgnoreCase(params.getOrDefault("browseType", ""));
            }

            private static boolean isOpenBug(BugSummary bug) {
                return !"resolved".equals(bug.status) && !"closed".equals(bug.status);
            }

            private static boolean hasSameBugIds(List<BugSummary> left, List<BugSummary> right) {
                if (left.isEmpty() || left.size() != right.size()) return false;
                for (int i = 0; i < left.size(); i++) {
                    if (!left.get(i).id.equals(right.get(i).id)) return false;
                }
                return true;
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
                String source = decodeJsonHtml(html);
                String names = "assignedTo|assignedTo\\[\\]|openedBy|resolvedBy|closedBy|confirmedBy|lastEditedBy";
                List<Item> result = new ArrayList<>();
                for (String select : matches(source, "<select\\b[^>]*\\bname=[\"'](?:" + names + ")[\"'][^>]*>[\\s\\S]*?</select>")) {
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
                String source = decodeJsonHtml(html);
                Map<String, Item> result = new LinkedHashMap<>();
                for (String row : matches(source, "<tr\\b[\\s\\S]*?</tr>")) {
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
                String source = decodeJsonHtml(html);
                Set<String> result = new LinkedHashSet<>();
                Matcher matcher = Pattern.compile("(?:productID|productid)[=/](\\d+)|(?:bug|product)[-/]browse[-/](\\d+)|data-(?:id|key|value)=[\"'](\\d+)[\"']", Pattern.CASE_INSENSITIVE).matcher(source == null ? "" : source);
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
                HttpRequest.Builder builder = HttpRequest.newBuilder(buildUri(path, params)).timeout(HTTP_REQUEST_TIMEOUT).GET().header("User-Agent", "ZenTaoBugAssistant-IDEA/1.1.0").header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
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
                String url = value == null || value.isBlank() || isPlaceholderServerUrl(value.trim()) ? DEFAULT_SERVER : value.trim();
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

            private static String firstMatch(String value, String regex) {
                Matcher matcher = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
                if (!matcher.find()) return "";
                return matcher.groupCount() >= 1 ? matcher.group(1) : matcher.group();
            }

            private static String readQueryParam(String value, String name) {
                Matcher matcher = Pattern.compile("[?&]" + Pattern.quote(name) + "=([^&#]+)", Pattern.CASE_INSENSITIVE).matcher(value == null ? "" : value);
                return matcher.find() ? urlDecode(matcher.group(1)) : "";
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
                        .header("User-Agent", "ZenTaoBugAssistant-IDEA/1.1.0")
                        .header("Accept", "image/*");
                addCookieHeader(builder);
                HttpResponse<byte[]> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
                mergeSetCookie(response);
                if (response.statusCode() < 200 || response.statusCode() >= 400) throw new IllegalStateException("图片请求失败：HTTP " + response.statusCode());
                String contentType = response.headers().firstValue("content-type").orElse("image/png");
                if (contentType.contains(";")) contentType = contentType.substring(0, contentType.indexOf(';')).trim();
                if (!contentType.toLowerCase(Locale.ROOT).startsWith("image/")) throw new IllegalStateException("不是图片响应：" + contentType);
                Path imageDir = bugImageDir();
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
                        .header("User-Agent", "ZenTaoBugAssistant-IDEA/1.1.0")
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
                if (value.matches("(?is).*(严重|致命|高|high|p1).*")) return "high";
                if (value.matches("(?is).*(一般|普通|中|medium|p2).*")) return "medium";
                if (value.matches("(?is).*(建议|低|low|p3).*")) return "low";
                return "unknown";
            }

            private static String parseStatus(String value) {
                if (value.matches("(?is).*(激活|active).*")) return "active";
                if (value.matches("(?is).*(已解决|resolved).*")) return "resolved";
                if (value.matches("(?is).*(关闭|closed).*")) return "closed";
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
