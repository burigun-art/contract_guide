@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Contract Guide MVP - starting server (Node.js required)
echo  Browser: http://localhost:3000
echo.
start "" http://localhost:3000
node server.js
pause
