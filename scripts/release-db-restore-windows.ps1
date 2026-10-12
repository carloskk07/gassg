# TAMÃO — restauração de backup APENAS em novo PostgreSQL local isolado.
# Não conecta ao Supabase e não modifica nem remove bancos existentes.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [string]$Target = '',
  [int]$Port = 5432,
  [string]$LocalUser = 'postgres',
  [switch]$CheckOnly,
  [switch]$ConfirmIsolatedLocalPostgres
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-LocalPgTool([string]$Name) {
  $cmd = Get-Command ($Name + '.exe') -ErrorAction SilentlyContinue
  if ($null -ne $cmd) { return $cmd.Source }
  $roots = @($env:ProgramFiles, $env:ProgramW6432) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  foreach ($root in $roots) {
    $versions = Join-Path $root 'PostgreSQL'
    if (-not (Test-Path $versions)) { continue }
    foreach ($dir in (Get-ChildItem -LiteralPath $versions -Directory | Sort-Object Name -Descending)) {
      $candidate = Join-Path $dir.FullName ('bin\' + $Name + '.exe')
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  throw ('Ferramenta PostgreSQL ausente: ' + $Name)
}

if ($Port -lt 1 -or $Port -gt 65535) { throw 'Porta local inválida.' }
if ($Archive -notmatch '\.dump$') { throw 'Informe um arquivo .dump de backup.' }
$resolved = Resolve-Path -LiteralPath $Archive -ErrorAction Stop
$archiveFile = [string]$resolved.Path
$item = Get-Item -LiteralPath $archiveFile
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -eq 0) {
  throw 'Backup vazio ou link simbólico não permitido.'
}
$checksumFile = if (Test-Path -LiteralPath ($archiveFile + '.sha256.txt')) {
  $archiveFile + '.sha256.txt'
} else { $archiveFile + '.sha256' }
if (-not (Test-Path -LiteralPath $checksumFile)) { throw 'Checksum SHA256 ausente.' }
$checksumItem = Get-Item -LiteralPath $checksumFile
if (($checksumItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'Checksum em link simbólico não permitido.'
}
$checksumLine = Get-Content -LiteralPath $checksumFile -TotalCount 1
if ($checksumLine -notmatch '^(?:SHA256\s+)?([a-fA-F0-9]{64})(?:\s|$)') {
  throw 'Formato do checksum inválido.'
}
$expected = $Matches[1].ToUpperInvariant()
$actual = (Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actual -ne $expected) { throw 'RESTORE_BLOCKED: checksum do backup não confere.' }
$restore = Find-LocalPgTool 'pg_restore'
& $restore --list $archiveFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_BLOCKED: catálogo do backup ilegível.' }
if ($CheckOnly) {
  Write-Host 'BACKUP_VERIFIED_ONLY: checksum e catálogo conferidos. Nenhum banco foi acessado.'
  exit 0
}

if (-not $ConfirmIsolatedLocalPostgres) {
  throw 'RESTORE_BLOCKED: informe -ConfirmIsolatedLocalPostgres somente após confirmar que 127.0.0.1 NÃO é um túnel para produção.'
}
if ($Target -cnotmatch '^tamao_restore_[a-z0-9_]{5,48}$') {
  throw 'RESTORE_BLOCKED: Target deve iniciar com tamao_restore_ e identificar um banco novo.'
}
$psql = Find-LocalPgTool 'psql'
$createdb = Find-LocalPgTool 'createdb'
$previousEnv = @{
  PGHOST = [Environment]::GetEnvironmentVariable('PGHOST')
  PGHOSTADDR = [Environment]::GetEnvironmentVariable('PGHOSTADDR')
  PGPORT = [Environment]::GetEnvironmentVariable('PGPORT')
  PGUSER = [Environment]::GetEnvironmentVariable('PGUSER')
  PGDATABASE = [Environment]::GetEnvironmentVariable('PGDATABASE')
  PGSSLMODE = [Environment]::GetEnvironmentVariable('PGSSLMODE')
  PGSERVICE = [Environment]::GetEnvironmentVariable('PGSERVICE')
}
try {
  $env:PGHOST = '127.0.0.1'
  $env:PGHOSTADDR = '127.0.0.1'
  $env:PGPORT = [string]$Port
  $env:PGUSER = $LocalUser
  $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'prefer'
  Remove-Item Env:PGSERVICE -ErrorAction SilentlyContinue

  # $Target is strictly validated before it can appear inside SQL.
  $exists = & $psql -X -A -t -q -v ON_ERROR_STOP=1 -d postgres -c ("select 1 from pg_database where datname='" + $Target + "'")
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar o PostgreSQL local.' }
  if (($exists | Out-String).Trim() -eq '1') { throw 'RESTORE_BLOCKED: banco de destino já existe.' }
  & $createdb --template=template0 $Target
  if ($LASTEXITCODE -ne 0) { throw 'RESTORE_FAILED: não foi possível criar o banco local novo.' }
  & $restore --exit-on-error --no-owner --dbname=$Target $archiveFile
  if ($LASTEXITCODE -ne 0) {
    throw 'RESTORE_FAILED: restauração parcial no banco local. Não há aprovação para migração.'
  }
  $tables = & $psql -X -A -t -q -v ON_ERROR_STOP=1 -d $Target -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')"
  if ($LASTEXITCODE -ne 0 -or (($tables | Out-String).Trim() -notmatch '^[1-9][0-9]*$')) {
    throw 'RESTORE_FAILED: nenhuma tabela restaurada ou verificação local falhou.'
  }
  Write-Host ('ISOLATED_RESTORE_OK: ' + ($tables | Out-String).Trim() + ' tabelas restauradas no banco local ' + $Target)
  Write-Host 'Ainda é necessário validar RLS, permissões, funções e extensões do Supabase.'
} finally {
  foreach ($key in $previousEnv.Keys) {
    [Environment]::SetEnvironmentVariable($key,$previousEnv[$key],'Process')
  }
}
