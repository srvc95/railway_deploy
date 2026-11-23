@echo off
setlocal
if not defined KEEL_BUILD set KEEL_BUILD=v0-b955bda
rem Packaged demo: the server stops by itself when the browser tab is closed.
set KEEL_AUTOQUIT=1
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
set "NODE_EXE=%~dp0node.exe"
if not exist ".env" (
  echo ERROR: the file .env is missing next to start.bat. The app needs OPENAI_API_KEY in it. Unzip the whole folder again.
  pause
  exit /b 1
)
if not exist "%NODE_EXE%" (
  echo ERROR: node.exe is missing next to start.bat. Unzip the whole folder again.
  pause
  exit /b 1
)
set "HOLDER_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set "HOLDER_PID=%%P"
if defined HOLDER_PID goto busy
goto free
:busy
set "HOLDER_NAME=another program"
for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq %HOLDER_PID%" /FO CSV /NH 2^>nul') do set "HOLDER_NAME=%%~N"
echo ERROR: port %PORT% is already in use by %HOLDER_NAME% [process id %HOLDER_PID%].
echo If that is another Keel window, close it. Otherwise run this in a command prompt in this folder:
echo    set PORT=3010 ^& start.bat
pause
exit /b 1
:free
echo The first start can take up to a minute. Your browser opens by itself when it is ready.
echo Closing the browser tab stops Keel. To open it again, run start.bat again.
rem Hidden watcher: waits until the port accepts connections, then opens the guided page (Start-Process, then explorer.exe, then cmd start).
if not defined KEEL_NO_BROWSER start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -Command "$p=%PORT%; $u='http://localhost:%PORT%/?guide=1'; $ok=$false; for($i=0;$i -lt 480 -and -not $ok;$i++){ try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',$p); $c.Close(); $ok=$true } catch { Start-Sleep -Milliseconds 500 } }; if($ok){ try { Start-Process $u -ErrorAction Stop } catch { try { Start-Process explorer.exe $u -ErrorAction Stop } catch { cmd /c start '' $u } } }"
"%NODE_EXE%" server.mjs
set "RC=%ERRORLEVEL%"
echo.
echo Keel stopped.
rem Exit code 0 means the tab was closed on purpose: close this window too. Any error keeps the window open.
if "%RC%"=="0" exit /b 0
pause
