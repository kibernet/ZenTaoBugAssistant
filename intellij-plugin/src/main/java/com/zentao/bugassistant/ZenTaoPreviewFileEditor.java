package com.zentao.bugassistant;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorLocation;
import com.intellij.openapi.fileEditor.FileEditorState;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import java.beans.PropertyChangeListener;
import javax.swing.JComponent;
import javax.swing.JEditorPane;
import javax.swing.JScrollPane;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

final class ZenTaoPreviewFileEditor extends UserDataHolderBase implements FileEditor, Disposable {
    private final ZenTaoPreviewVirtualFile file;
    private final JBCefBrowser browser;
    private final JEditorPane fallbackPane;
    private final JComponent component;

    ZenTaoPreviewFileEditor(ZenTaoPreviewVirtualFile file) {
        this.file = file;
        if (isJcefSupported()) {
            browser = new JBCefBrowser();
            fallbackPane = null;
            component = browser.getComponent();
        } else {
            browser = null;
            fallbackPane = new JEditorPane("text/html", "");
            fallbackPane.setEditable(false);
            component = new JScrollPane(fallbackPane);
        }
        updateHtml(file.html());
    }

    void updateHtml(String html) {
        if (browser != null) {
            browser.loadHTML(html == null ? "" : html);
        } else if (fallbackPane != null) {
            fallbackPane.setText(html == null ? "" : html);
            fallbackPane.setCaretPosition(0);
        }
    }

    @Override
    public @NotNull JComponent getComponent() {
        return component;
    }

    @Override
    public @Nullable JComponent getPreferredFocusedComponent() {
        return component;
    }

    @Override
    public @NotNull String getName() {
        return file.bugId().isBlank() ? "禅道 Bug 预览" : "Bug #" + file.bugId();
    }

    @Override
    public void setState(@NotNull FileEditorState state) {
    }

    @Override
    public boolean isModified() {
        return false;
    }

    @Override
    public boolean isValid() {
        return file.isValid();
    }

    @Override
    public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public @Nullable FileEditorLocation getCurrentLocation() {
        return null;
    }

    @Override
    public void dispose() {
        if (browser != null) browser.dispose();
    }

    private static boolean isJcefSupported() {
        try {
            return JBCefApp.isSupported();
        } catch (Throwable ignored) {
            return false;
        }
    }
}
