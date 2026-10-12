@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "%~dp0Verificar-Backup-TAMAO.ps1" (
  echo FALTA Verificar-Backup-TAMAO.ps1 na mesma pasta.
  pause
  exit /b 2
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Verificar-Backup-TAMAO.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel abrir a verificacao. Veja a mensagem acima.
  pause
)
endlocal
