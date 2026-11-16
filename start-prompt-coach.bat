@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================================
echo   ANTIGRAVITY PROMPT COACH v1.0 (Self-Host - 100%% Zero-Data-Leak)
echo ========================================================================
python prompt_coach_server.py --port 8788
pause
