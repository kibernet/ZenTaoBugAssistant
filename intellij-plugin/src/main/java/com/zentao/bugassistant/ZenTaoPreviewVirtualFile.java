package com.zentao.bugassistant;

import com.intellij.openapi.fileTypes.PlainTextFileType;
import com.intellij.testFramework.LightVirtualFile;

final class ZenTaoPreviewVirtualFile extends LightVirtualFile {
    static final String FILE_NAME = "ZenTao Bug Preview";

    private String bugId = "";
    private String html = "";

    ZenTaoPreviewVirtualFile() {
        super(FILE_NAME, PlainTextFileType.INSTANCE, "");
        setWritable(false);
    }

    void update(String bugId, String html) {
        this.bugId = bugId == null ? "" : bugId;
        this.html = html == null ? "" : html;
    }

    String bugId() {
        return bugId;
    }

    String html() {
        return html;
    }
}
