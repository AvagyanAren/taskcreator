@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Отправка изменений на GitHub и Vercel ===
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Git не найден. Установите с https://git-scm.com/download/win
  pause
  exit /b 1
)

git diff --quiet && git diff --cached --quiet
if not errorlevel 1 (
  echo Локальных изменений нет.
  echo Проверяю, есть ли неотправленные коммиты...
  git push
  echo.
  pause
  exit /b 0
)

echo Изменённые файлы:
git status --short
echo.

set "MSG=%~1"
if "%MSG%"=="" set /p MSG=Опишите изменения (Enter - оставить по умолчанию): 
if "%MSG%"=="" set "MSG=Обновление"

git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Не удалось создать коммит.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Push не прошёл. Скопируйте текст выше.
  pause
  exit /b 1
)

echo.
echo Готово. Vercel начнёт сборку автоматически, обычно 1-2 минуты.
echo https://edge-task-creator.vercel.app
echo.
pause
