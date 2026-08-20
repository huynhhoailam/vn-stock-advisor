@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    start "VN Stock Advisor Server" /min py -m http.server 8765 --bind 127.0.0.1
    timeout /t 2 /nobreak >nul
    start "" "http://127.0.0.1:8765/"
    exit /b 0
)

where python >nul 2>nul
if %errorlevel%==0 (
    start "VN Stock Advisor Server" /min python -m http.server 8765 --bind 127.0.0.1
    timeout /t 2 /nobreak >nul
    start "" "http://127.0.0.1:8765/"
    exit /b 0
)

echo Khong tim thay Python. Hay cai Python 3, sau do chay lai file nay.
pause
