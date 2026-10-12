@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "%~dp0Assistente-TAMAO.ps1" (
  echo ERRO: O arquivo Assistente-TAMAO.ps1 precisa estar na mesma pasta.
  pause
  exit /b 2
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Assistente-TAMAO.ps1"
if errorlevel 1 (
  echo.
  echo O assistente nao abriu corretamente. Veja a mensagem de erro acima.
  pause
)
endlocal
