@echo off
REM Wrapper for the Windows Scheduled Task "VibeDashBackup".
REM node is called by absolute path because scheduled tasks do not reliably inherit PATH.
REM --import tsx runs the TypeScript script directly; it resolves tsx from this checkout's node_modules.
setlocal
set VIBE_DASH_BACKUP_KEEP=28
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" --import tsx scripts\backup-db.ts
exit /b %ERRORLEVEL%
