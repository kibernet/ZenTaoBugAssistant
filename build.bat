@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1

set "ROOT_DIR=%~dp0"
set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "INTELLIJ_DIR=%ROOT_DIR%\intellij-plugin"
set "VSCODE_DIR=%ROOT_DIR%\vscode-plugin"
set "TOOLS_DIR=%ROOT_DIR%\.tools"
set "GRADLE_VERSION=8.13"
set "NODE_VERSION=20.19.0"

if /i "%~1"=="__build_intellij" (
    call :main %*
    exit /b %ERRORLEVEL%
)
if /i "%~1"=="__build_vscode" (
    call :main %*
    exit /b %ERRORLEVEL%
)

call :main %*
set "BUILD_CODE=%ERRORLEVEL%"
if not "%BUILD_CODE%"=="0" (
    echo.
    echo ========================================
    echo Build failed with exit code %BUILD_CODE%.
    echo ========================================
)
echo.
echo Press any key to exit...
pause >nul
exit /b %BUILD_CODE%

:main
if /i "%~1"=="__build_intellij" (
    call :build_intellij
    exit /b %ERRORLEVEL%
)
if /i "%~1"=="__build_vscode" (
    call :build_vscode
    exit /b %ERRORLEVEL%
)

call :ensure_java || exit /b %ERRORLEVEL%
call :ensure_gradle || exit /b %ERRORLEVEL%
call :ensure_node || exit /b %ERRORLEVEL%

call :build_parallel || exit /b %ERRORLEVEL%

echo.
echo ========================================
echo All builds completed successfully!
echo ========================================
exit /b 0

:build_parallel
echo ========================================
echo Building IntelliJ and VS Code plugins in parallel...
echo ========================================

set "BUILD_LOG_DIR=%ROOT_DIR%\build-logs"
if not exist "%BUILD_LOG_DIR%" mkdir "%BUILD_LOG_DIR%"
set "INTELLIJ_EXIT=%BUILD_LOG_DIR%\intellij.exit"
set "VSCODE_EXIT=%BUILD_LOG_DIR%\vscode.exit"
set "INTELLIJ_LOG=%BUILD_LOG_DIR%\intellij.log"
set "VSCODE_LOG=%BUILD_LOG_DIR%\vscode.log"
set "INTELLIJ_CMD=%BUILD_LOG_DIR%\build-intellij.cmd"
set "VSCODE_CMD=%BUILD_LOG_DIR%\build-vscode.cmd"
if exist "%INTELLIJ_EXIT%" del /q "%INTELLIJ_EXIT%"
if exist "%VSCODE_EXIT%" del /q "%VSCODE_EXIT%"
if exist "%INTELLIJ_LOG%" del /q "%INTELLIJ_LOG%"
if exist "%VSCODE_LOG%" del /q "%VSCODE_LOG%"
if exist "%INTELLIJ_CMD%" del /q "%INTELLIJ_CMD%"
if exist "%VSCODE_CMD%" del /q "%VSCODE_CMD%"

>"%INTELLIJ_CMD%" echo @echo off
>>"%INTELLIJ_CMD%" echo chcp 65001 ^>nul 2^>^&1
>>"%INTELLIJ_CMD%" echo call "%~f0" __build_intellij ^> "%INTELLIJ_LOG%" 2^>^&1
>>"%INTELLIJ_CMD%" echo ^> "%INTELLIJ_EXIT%" echo %%ERRORLEVEL%%
>"%VSCODE_CMD%" echo @echo off
>>"%VSCODE_CMD%" echo chcp 65001 ^>nul 2^>^&1
>>"%VSCODE_CMD%" echo call "%~f0" __build_vscode ^> "%VSCODE_LOG%" 2^>^&1
>>"%VSCODE_CMD%" echo ^> "%VSCODE_EXIT%" echo %%ERRORLEVEL%%

start "ZenTao IntelliJ Build" /b cmd /c ""%INTELLIJ_CMD%""
start "ZenTao VSCode Build" /b cmd /c ""%VSCODE_CMD%""

set /a WAIT_SECONDS=0
:wait_parallel
if exist "%INTELLIJ_EXIT%" (
    set "INTELLIJ_STATUS=done"
) else (
    set "INTELLIJ_STATUS=running"
)
if exist "%VSCODE_EXIT%" (
    set "VSCODE_STATUS=done"
) else (
    set "VSCODE_STATUS=running"
)
if not "%INTELLIJ_STATUS%"=="done" (
    call :sleep_seconds 2
    set /a WAIT_SECONDS+=2
    echo Still building... !WAIT_SECONDS!s elapsed. IntelliJ: !INTELLIJ_STATUS!, VS Code/Cursor: !VSCODE_STATUS!
    goto wait_parallel
)
if not "%VSCODE_STATUS%"=="done" (
    call :sleep_seconds 2
    set /a WAIT_SECONDS+=2
    echo Still building... !WAIT_SECONDS!s elapsed. IntelliJ: !INTELLIJ_STATUS!, VS Code/Cursor: !VSCODE_STATUS!
    goto wait_parallel
)

set /p INTELLIJ_CODE=<"%INTELLIJ_EXIT%"
set /p VSCODE_CODE=<"%VSCODE_EXIT%"

echo.
echo ========================================
echo IntelliJ build output
echo ========================================
call :print_log "%INTELLIJ_LOG%"
echo.
echo ========================================
echo VS Code/Cursor build output
echo ========================================
call :print_log "%VSCODE_LOG%"

if not "%INTELLIJ_CODE%"=="0" (
    echo [ERROR] IntelliJ plugin build failed with exit code %INTELLIJ_CODE%.
    exit /b %INTELLIJ_CODE%
)
if not "%VSCODE_CODE%"=="0" (
    echo [ERROR] VS Code/Cursor plugin build failed with exit code %VSCODE_CODE%.
    exit /b %VSCODE_CODE%
)
exit /b 0

:print_log
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -LiteralPath '%~1' -Encoding UTF8 | ForEach-Object { Write-Host $_ }"
exit /b 0

:sleep_seconds
set "SLEEP_SECONDS=%~1"
if "%SLEEP_SECONDS%"=="" set "SLEEP_SECONDS=1"
set /a PING_COUNT=%SLEEP_SECONDS%+1
ping -n %PING_COUNT% 127.0.0.1 >nul
exit /b 0

:build_intellij
echo ========================================
echo Building IntelliJ plugin...
echo ========================================
if not defined JAVA_HOME call :ensure_java || exit /b %ERRORLEVEL%
where gradle >nul 2>nul
if errorlevel 1 call :ensure_gradle || exit /b %ERRORLEVEL%

pushd "%INTELLIJ_DIR%" || exit /b 1
if exist build\distributions\*.zip del /q build\distributions\*.zip
if exist gradlew.bat (
    call gradlew.bat --no-daemon --console=plain clean buildPlugin
) else (
    call gradle --no-daemon --console=plain clean buildPlugin
)
set "BUILD_CODE=%ERRORLEVEL%"
popd
if not "%BUILD_CODE%"=="0" (
    echo [ERROR] IntelliJ plugin build failed with exit code %BUILD_CODE%.
    echo [HINT] Check the Gradle output above for IntelliJ Platform dependency or compilation errors.
    exit /b %BUILD_CODE%
)
exit /b 0

:build_vscode
echo.
echo ========================================
echo Building VS Code/Cursor plugin...
echo ========================================
where npm >nul 2>nul
if errorlevel 1 call :ensure_node || exit /b %ERRORLEVEL%

pushd "%VSCODE_DIR%" || exit /b 1
if exist "%VSCODE_DIR%\dist" rmdir /s /q "%VSCODE_DIR%\dist"
if exist "%VSCODE_DIR%\*.vsix" del /q "%VSCODE_DIR%\*.vsix"

if exist package-lock.json (
    call npm ci --no-audit --fund=false --loglevel=error
) else (
    call npm install --no-audit --fund=false --loglevel=error
)
set "BUILD_CODE=%ERRORLEVEL%"
if not "%BUILD_CODE%"=="0" (
    popd
    echo [ERROR] VS Code/Cursor dependency install failed with exit code %BUILD_CODE%.
    exit /b %BUILD_CODE%
)

call npm run build
set "BUILD_CODE=%ERRORLEVEL%"
if not "%BUILD_CODE%"=="0" (
    popd
    echo [ERROR] VS Code/Cursor TypeScript build failed with exit code %BUILD_CODE%.
    exit /b %BUILD_CODE%
)

call npm run package:vsix
set "BUILD_CODE=%ERRORLEVEL%"
popd
if not "%BUILD_CODE%"=="0" (
    echo [ERROR] VS Code/Cursor package failed with exit code %BUILD_CODE%.
    exit /b %BUILD_CODE%
)
exit /b 0

:ensure_java
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        call :check_java "%JAVA_HOME%\bin\java.exe"
        if not errorlevel 1 (
            set "PATH=%JAVA_HOME%\bin;%PATH%"
            exit /b 0
        )
    )
)

for /d %%J in (
    "C:\Program Files\Java\jdk-21*"
    "C:\Program Files\Eclipse Adoptium\jdk-21*"
    "C:\Program Files\Microsoft\jdk-21*"
    "C:\Program Files\Amazon Corretto\jdk-21*"
    "C:\Program Files\Java\jdk-17*"
    "C:\Program Files\Eclipse Adoptium\jdk-17*"
    "C:\Program Files\Microsoft\jdk-17*"
    "C:\Program Files\Amazon Corretto\jdk-17*"
) do (
    if exist "%%~fJ\bin\java.exe" (
        call :check_java "%%~fJ\bin\java.exe"
        if not errorlevel 1 (
            set "JAVA_HOME=%%~fJ"
            set "PATH=%JAVA_HOME%\bin;%PATH%"
            exit /b 0
        )
    )
)

echo [ERROR] No valid JDK 17+ installation was found.
echo [HINT] Install JDK 21 or JDK 17, or set JAVA_HOME to a valid JDK path.
exit /b 1

:check_java
"%~1" -version 2>&1 | findstr /r /c:"version \"1[7-9]\." /c:"version \"[2-9][0-9]\." >nul
if errorlevel 1 exit /b 1
exit /b 0

:ensure_node
if defined ZENTAO_BUG_ASSISTANT_NODE_HOME (
    if exist "%ZENTAO_BUG_ASSISTANT_NODE_HOME%\npm.cmd" (
        set "PATH=%ZENTAO_BUG_ASSISTANT_NODE_HOME%;%PATH%"
        exit /b 0
    )
)

if exist "%TOOLS_DIR%\node\npm.cmd" (
    set "PATH=%TOOLS_DIR%\node;%PATH%"
    exit /b 0
)

where npm >nul 2>nul
if not errorlevel 1 exit /b 0

set "NODE_HOME=%TOOLS_DIR%\node"
if exist "%NODE_HOME%\npm.cmd" (
    set "PATH=%NODE_HOME%;%PATH%"
    exit /b 0
)

echo Bootstrapping Node.js %NODE_VERSION%...
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
set "NODE_ZIP=%TOOLS_DIR%\node-v%NODE_VERSION%-win-x64.zip"
echo Downloading Node.js archive. This may take a few minutes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip' -OutFile '%NODE_ZIP%'" || exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%TOOLS_DIR%' -Force" || exit /b 1
if exist "%NODE_HOME%" rmdir /s /q "%NODE_HOME%"
ren "%TOOLS_DIR%\node-v%NODE_VERSION%-win-x64" node
set "PATH=%NODE_HOME%;%PATH%"
exit /b 0

:ensure_gradle
where gradle >nul 2>nul
if not errorlevel 1 exit /b 0

set "GRADLE_HOME=%TOOLS_DIR%\gradle-%GRADLE_VERSION%"
if exist "%GRADLE_HOME%\bin\gradle.bat" (
    set "PATH=%GRADLE_HOME%\bin;%PATH%"
    exit /b 0
)

echo Bootstrapping Gradle %GRADLE_VERSION%...
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
set "GRADLE_ZIP=%TOOLS_DIR%\gradle-%GRADLE_VERSION%-bin.zip"
echo Downloading Gradle archive. This may take a few minutes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://mirrors.cloud.tencent.com/gradle/gradle-%GRADLE_VERSION%-bin.zip' -OutFile '%GRADLE_ZIP%'" || exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%GRADLE_ZIP%' -DestinationPath '%TOOLS_DIR%' -Force" || exit /b 1
set "PATH=%GRADLE_HOME%\bin;%PATH%"
exit /b 0
