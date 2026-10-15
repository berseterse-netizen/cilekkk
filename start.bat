@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ===== Ayarlar =====
rem Kullanicilarin acacagi adres (IP ya da alan adi).
rem Bu satiri silersen sunucu kendi dis IP'sini otomatik bulur.
set PUBLIC_HOST=13.53.198.78
set PORT=38471
rem Gercek sertifikan varsa yollarini yaz (uygulama olarak yukleme icin gerekli):
rem set CERT_FILE=C:\cilek\fullchain.pem
rem set KEY_FILE=C:\cilek\privkey.pem
rem Cloudflare TURN anahtarlari .env dosyasina yazilir (ornek: .env.example)
rem ====================

call npm install
if errorlevel 1 goto fail

netsh advfirewall firewall add rule name="Cilek Web" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>&1
netsh advfirewall firewall add rule name="Cilek TURN" dir=in action=allow protocol=UDP localport=3478,49160-49180 >nul 2>&1
netsh advfirewall firewall add rule name="Cilek TURN TCP" dir=in action=allow protocol=TCP localport=3478 >nul 2>&1

call npm run build
if errorlevel 1 goto fail

echo.
echo Ac: https://%PUBLIC_HOST%:%PORT%
echo Sertifika uyarisinda Gelismis deyip siteye devam et.
echo.
call npm start
echo.
echo Sunucu %errorlevel% koduyla kapandi.
pause
exit /b %errorlevel%

:fail
echo.
echo Kurulum basarisiz oldu (kod %errorlevel%).
pause
exit /b %errorlevel%
