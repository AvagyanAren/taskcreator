@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === EdgeFocus Task Tool ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден.
  echo Установите LTS-версию с https://nodejs.org и запустите этот файл заново.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo Node.js %%v
echo.

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo [ВНИМАНИЕ] Создан файл .env - впишите в него EDGEFOCUS_TOKEN.
  echo Сейчас откроется Блокнот. Сохраните файл, закройте его и запустите start.bat заново.
  echo.
  pause
  notepad ".env"
  exit /b 0
)

if not exist "node_modules" (
  echo Устанавливаю зависимости, это займёт 1-2 минуты...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ОШИБКА] npm install не удался. Скопируйте текст выше.
    pause
    exit /b 1
  )
  echo.
)

echo Проверяю соединение с EdgeFocus (задачи не создаются)...
echo.
call npm run test:edgefocus
echo.

echo Запускаю сервер. НЕ ЗАКРЫВАЙТЕ это окно - пока оно открыто, сайт работает.
echo Откройте http://localhost:3000
echo Остановить: Ctrl+C
echo.
call npm run dev
pause
