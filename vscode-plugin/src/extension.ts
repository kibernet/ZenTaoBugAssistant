import * as vscode from "vscode";
import { ZenTaoBugAssistantViewProvider } from "./zentaoViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ZenTaoBugAssistantViewProvider(context);
  void provider.activateAutoLogin();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ZenTaoBugAssistantViewProvider.viewType, provider),
    vscode.commands.registerCommand("zentaoBugAssistant.openView", () =>
      vscode.commands.executeCommand("workbench.view.extension.zentaoBugAssistant")
    ),
    vscode.commands.registerCommand("zentaoBugAssistant.login", () => provider.login()),
    vscode.commands.registerCommand("zentaoBugAssistant.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("zentaoBugAssistant.fixSelected", () => provider.fixSelected()),
    vscode.commands.registerCommand("zentaoBugAssistant.crawlDebugInfo", () => provider.crawlCurrentBugAccess()),
    vscode.commands.registerCommand("zentaoBugAssistant.copyProjectDebugInfo", () => provider.copyProjectDebugInfo())
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered in activate.
}
