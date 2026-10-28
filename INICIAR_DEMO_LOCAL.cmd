@echo off
setlocal
cd /d "%~dp0"
where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo [TAMAO] Windows Subsystem for Linux 2 nao esta disponivel.
  echo Leia docs\DEMO_LOCAL_PROPRIETARIO.md.
  pause
  exit /b 1
)
echo ============================================================
echo TAMAO - DEMONSTRACAO LOCAL PRIVADA
echo Nenhuma venda, Pix ou pedido sera criado na producao.
echo Requer WSL2, Docker Desktop, Node 20+, Supabase CLI e psql.
echo ============================================================
wsl.exe --cd "%CD%" bash scripts/run-owner-local-demo.sh
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" echo [TAMAO] Inicio falhou. Veja o erro acima.
echo [TAMAO] Sessao local finalizada. Dados descartaveis foram encerrados.
pause
exit /b %CODE%
