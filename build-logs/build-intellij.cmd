@echo off
chcp 65001 >nul 2>&1
call "E:\code\kibernet\ZenTaoBugAssistant\build.bat" __build_intellij > "E:\code\kibernet\ZenTaoBugAssistant\build-logs\intellij.log" 2>&1
> "E:\code\kibernet\ZenTaoBugAssistant\build-logs\intellij.exit" echo %ERRORLEVEL%
