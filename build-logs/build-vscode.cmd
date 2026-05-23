@echo off
chcp 65001 >nul 2>&1
call "E:\code\kibernet\ZenTaoBugAssistant\build.bat" __build_vscode > "E:\code\kibernet\ZenTaoBugAssistant\build-logs\vscode.log" 2>&1
> "E:\code\kibernet\ZenTaoBugAssistant\build-logs\vscode.exit" echo %ERRORLEVEL%
