@echo off
REM Wrapper for the Windows Scheduled Task "VibeDashBackup".
REM The live database is in the Docker volume vibe-dash-data, which no host
REM process can open, so the backup runs inside the container, as the node user
REM that owns /data, and lands in /data/backups in the same volume. Copy those
REM out now and then (docs/self-hosting.md, "Backup and restore"): a backup in
REM the volume does not survive losing the volume.
REM docker is called by absolute path because scheduled tasks do not reliably
REM inherit PATH, and compose runs from the repo root so it finds the service.
REM -T: a scheduled task has no terminal.
setlocal
cd /d "%~dp0.."
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose exec -T -u node -e VIBE_DASH_BACKUP_KEEP=28 vibe-dash npm run backup
exit /b %ERRORLEVEL%
