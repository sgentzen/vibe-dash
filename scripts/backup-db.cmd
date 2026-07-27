@echo off
REM Wrapper for the Windows Scheduled Task "VibeDashBackup".
REM node is called by absolute path because scheduled tasks do not reliably inherit PATH.
setlocal
set VIBE_DASH_BACKUP_KEEP=28
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" scripts\backup-db.mjs
exit /b %ERRORLEVEL%
