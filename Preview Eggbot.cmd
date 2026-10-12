@echo off
cd /d "%~dp0"
python tools\preview-eggbot.py
if errorlevel 1 pause
