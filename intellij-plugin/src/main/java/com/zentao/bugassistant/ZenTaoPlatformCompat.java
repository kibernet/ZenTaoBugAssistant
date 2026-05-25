package com.zentao.bugassistant;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.DataContext;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

import java.lang.reflect.Method;

final class ZenTaoPlatformCompat {
    private static final String ACTION_UI_KIND_CLASS = "com.intellij.openapi.actionSystem.ActionUiKind";
    private static final String ACTION_UTIL_CLASS = "com.intellij.openapi.actionSystem.ex.ActionUtil";
    private static final String LEGACY_CONTENT_FACTORY_SERVICE = "com.intellij.ui.content.ContentFactory$SERVICE";

    private ZenTaoPlatformCompat() {
    }

    static @NotNull ContentFactory contentFactory() {
        try {
            Method getInstance = ContentFactory.class.getMethod("getInstance");
            return (ContentFactory) getInstance.invoke(null);
        } catch (ReflectiveOperationException ignored) {
            return legacyContentFactory();
        }
    }

    private static @NotNull ContentFactory legacyContentFactory() {
        try {
            Class<?> serviceClass = Class.forName(LEGACY_CONTENT_FACTORY_SERVICE);
            Method getInstance = serviceClass.getMethod("getInstance");
            return (ContentFactory) getInstance.invoke(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Unable to obtain ContentFactory", e);
        }
    }

    static void performAction(@NotNull AnAction action, @NotNull DataContext dataContext, @NotNull String place) {
        AnActionEvent event = createActionEvent(action, dataContext, place);
        invokeActionUtilPerform(action, event);
    }

    private static @NotNull AnActionEvent createActionEvent(
            @NotNull AnAction action,
            @NotNull DataContext dataContext,
            @NotNull String place) {
        try {
            Class<?> uiKindClass = Class.forName(ACTION_UI_KIND_CLASS);
            Object none = uiKindClass.getField("NONE").get(null);
            Method createEvent = AnActionEvent.class.getMethod(
                    "createEvent",
                    AnAction.class,
                    DataContext.class,
                    com.intellij.openapi.actionSystem.Presentation.class,
                    String.class,
                    uiKindClass,
                    java.awt.event.InputEvent.class
            );
            return (AnActionEvent) createEvent.invoke(null, action, dataContext, null, place, none, null);
        } catch (ReflectiveOperationException ignored) {
            return legacyActionEvent(dataContext, place);
        }
    }

    private static @NotNull AnActionEvent legacyActionEvent(@NotNull DataContext dataContext, @NotNull String place) {
        try {
            Method createFromDataContext = AnActionEvent.class.getMethod(
                    "createFromDataContext",
                    String.class,
                    com.intellij.openapi.actionSystem.Presentation.class,
                    DataContext.class
            );
            return (AnActionEvent) createFromDataContext.invoke(null, place, null, dataContext);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Unable to create AnActionEvent", e);
        }
    }

    private static void invokeActionUtilPerform(@NotNull AnAction action, @NotNull AnActionEvent event) {
        try {
            Class<?> actionUtilClass = Class.forName(ACTION_UTIL_CLASS);
            Method updateAction = actionUtilClass.getMethod("updateAction", AnAction.class, AnActionEvent.class);
            updateAction.invoke(null, action, event);
            Method performAction = actionUtilClass.getMethod("performAction", AnAction.class, AnActionEvent.class);
            performAction.invoke(null, action, event);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Unable to perform action", e);
        }
    }
}
