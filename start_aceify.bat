@echo off
title Aceify
cd /d "%~dp0"
echo.
echo  Aceify - starting at http://127.0.0.1:8825/
echo  Sign in with your HAC login. Your password is never saved.
echo  Keep this window open. Press Ctrl+C to stop.
echo.
python run.py
pause
