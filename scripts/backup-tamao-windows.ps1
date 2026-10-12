# TAMÃO — assistente mínimo de checkpoint privado para Windows.
# Execute neste repositório: .\scripts\backup-tamao-windows.ps1
# A senha é digitada apenas no prompt oculto; NÃO compartilhe com o chat.
[CmdletBinding()]
param(
  [string]$HostName = 'db.lgugwujpunhslavewffd.supabase.co',
  [int]$Port = 5432,
  [string]$UserName = 'postgres',
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Write-Host 'TAMÃO: checkpoint privado no SEU computador. Nenhum arquivo será enviado ao GitHub.'
if ($CheckOnly) {
  & (Join-Path $PSScriptRoot 'release-db-backup-windows.ps1') -CheckOnly
  exit $LASTEXITCODE
}
& (Join-Path $PSScriptRoot 'release-db-backup-windows.ps1') -DbHost $HostName -Port $Port -DbUser $UserName -DbName 'postgres'
if ($LASTEXITCODE -ne 0) { throw 'A geração do checkpoint não foi concluída.' }
Write-Host 'Próxima etapa: comprovar RESTAURAÇÃO no PostgreSQL local isolado usando release-db-restore-windows.ps1.'
