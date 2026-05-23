package com.zentao.bugassistant;

import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.ui.ComboBox;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.JBUI;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JSpinner;
import javax.swing.SpinnerNumberModel;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.Nullable;

public final class ZenTaoSettingsConfigurable implements Configurable {
    private static final String DEFAULT_SERVER = "http://zentao.yuwan-game.com:8088/";

    private JPanel panel;
    private JBTextField serverField;
    private JCheckBox autoLoginBox;
    private ComboBox<String> aiEngineBox;
    private JSpinner keepAliveSpinner;

    @Override
    public @Nls String getDisplayName() {
        return "ZenTao Bug Assistant";
    }

    @Override
    public @Nullable JComponent createComponent() {
        serverField = new JBTextField();
        autoLoginBox = new JCheckBox("启动后自动登录");
        aiEngineBox = new ComboBox<>(new String[] {"Claude Code"});
        keepAliveSpinner = new JSpinner(new SpinnerNumberModel(5, 1, 120, 1));

        panel = new JPanel(new GridBagLayout());
        panel.setBorder(JBUI.Borders.empty(10));
        GridBagConstraints c = new GridBagConstraints();
        c.fill = GridBagConstraints.HORIZONTAL;
        c.insets = JBUI.insets(4);
        c.weightx = 1;

        addRow(c, 0, "默认禅道地址", serverField);
        addRow(c, 1, "AI 引擎", aiEngineBox);
        addRow(c, 2, "会话保活间隔（分钟）", keepAliveSpinner);
        addRow(c, 3, "行为", autoLoginBox);

        reset();
        return panel;
    }

    private void addRow(GridBagConstraints c, int y, String label, JComponent component) {
        c.gridy = y;
        c.gridx = 0;
        c.weightx = 0;
        panel.add(new JLabel(label), c);
        c.gridx = 1;
        c.weightx = 1;
        panel.add(component, c);
    }

    @Override
    public boolean isModified() {
        PropertiesComponent properties = PropertiesComponent.getInstance();
        return !serverField.getText().equals(properties.getValue("zentao.idea.settings.serverUrl", DEFAULT_SERVER))
                || autoLoginBox.isSelected() != properties.getBoolean("zentao.idea.settings.autoLogin", true)
                || aiEngineBox.getSelectedIndex() != 0
                || ((Number)keepAliveSpinner.getValue()).intValue() != properties.getInt("zentao.idea.settings.keepAliveMinutes", 5);
    }

    @Override
    public void apply() {
        PropertiesComponent properties = PropertiesComponent.getInstance();
        properties.setValue("zentao.idea.settings.serverUrl", serverField.getText(), DEFAULT_SERVER);
        properties.setValue("zentao.idea.settings.autoLogin", autoLoginBox.isSelected(), true);
        properties.setValue("zentao.idea.settings.aiEngine", "claudeCode", "claudeCode");
        properties.setValue("zentao.idea.settings.keepAliveMinutes", ((Number)keepAliveSpinner.getValue()).intValue(), 5);
    }

    @Override
    public void reset() {
        PropertiesComponent properties = PropertiesComponent.getInstance();
        serverField.setText(properties.getValue("zentao.idea.settings.serverUrl", DEFAULT_SERVER));
        autoLoginBox.setSelected(properties.getBoolean("zentao.idea.settings.autoLogin", true));
        aiEngineBox.setSelectedIndex(0);
        keepAliveSpinner.setValue(properties.getInt("zentao.idea.settings.keepAliveMinutes", 5));
    }
}
