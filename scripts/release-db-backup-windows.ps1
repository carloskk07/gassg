# TAMÃO — backup de recuperação do Supabase Free em Windows.
# Não aplica migrações, não expõe senha no terminal ou em argumentos de processos.
# Requer PostgreSQL client tools e acesso de banco autorizado.
[CmdletBinding()]
param(
  [string]$DbHost = '',
  [int]$Port = 5432,
  [string]$DbName = 'postgres',
  [string]$DbUser = 'postgres',
  [string]$Destination = '',
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Find-PgTool([string]$Name) {
  $cmd = Get-Command ($Name + '.exe') -ErrorAction SilentlyContinue
  if ($null -ne $cmd) { return $cmd.Source }
  $roots = @($env:ProgramFiles, $env:ProgramW6432) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  foreach ($root in $roots) {
    $versions = Join-Path $root 'PostgreSQL'
    if (-not (Test-Path $versions)) { continue }
    foreach ($dir in (Get-ChildItem -LiteralPath $versions -Directory |
      Sort-Object Name -Descending)) {
      $candidate = Join-Path $dir.FullName ("bin\" + $Name + '.exe')
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  throw "Ferramenta PostgreSQL ausente: $Name. Instale apenas as ferramentas cliente do PostgreSQL."
}
$dump = Find-PgTool 'pg_dump'
$restore = Find-PgTool 'pg_restore'
Write-Host 'Ferramentas PostgreSQL encontradas.'
if ($CheckOnly) {
  Write-Host 'PREFLIGHT_OK — nenhuma conexão realizada e nenhum backup criado.'
  exit 0
}
if ([string]::IsNullOrWhiteSpace($DbHost)) {
  $DbHost = Read-Host 'Host PostgreSQL do Supabase (sem URL ou senha)'
}
if ([string]::IsNullOrWhiteSpace($DbHost)) {
  throw 'Host não informado.'
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
  $Destination = Join-Path $env:LOCALAPPDATA 'TAMAO\Backups'
}
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
$targetDir = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
if ($targetDir.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase)) {
  throw 'Por segurança, grave o backup fora do repositório GitHub.'
}
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Porta inválida.' }
$secure = Read-Host 'Senha PostgreSQL (entrada oculta)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
$env:PGHOST = $DbHost
$env:PGPORT = [string]$Port
$env:PGDATABASE = $DbName
$env:PGUSER = $DbUser
$env:PGSSLMODE = 'require'
$env:PGCONNECT_TIMEOUT = '15'
$archive = $null
try {
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $archive = Join-Path $targetDir "tamao-prod-before-v1-164-$stamp.dump"
  if (Test-Path -LiteralPath $archive) { throw 'Arquivo de backup existente. Não sobrescrever.' }
  & $dump --format=custom --no-owner --file=$archive
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar o banco.' }
  if (-not (Test-Path -LiteralPath $archive) -or
      (Get-Item -LiteralPath $archive).Length -eq 0) { throw 'Arquivo vazio.' }
  & $restore --list $archive | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Backup falhou na leitura de catálogo.' }
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $hashFile = "$archive.sha256.txt"
  "SHA256 $hash" | Set-Content -LiteralPath $hashFile -Encoding ascii
  Write-Host ('Backup privado criado: ' + $archive)
  Write-Host ('Checksum registrado: ' + $hashFile)
  Write-Host 'Antes de migrar, RESTAURE este arquivo em um banco isolado e confira os dados.'
  Write-Host 'Não anexe o backup a chats, issues, PRs nem uploads públicos.'
} catch {
  if ($archive -and (Test-Path -LiteralPath $archive)) {
    Remove-Item -LiteralPath $archive -Force
  }
  throw
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
  Remove-Item Env:PGPORT -ErrorAction SilentlyContinue
  Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
  Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
}
