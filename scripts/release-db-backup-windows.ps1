# TAMÃO — backup de recuperação do Supabase Free em Windows.
# Não aplica migrações, não expõe senha no terminal ou em argumentos de processos.
# Requer PostgreSQL client tools e acesso de banco autorizado.
[CmdletBinding()]
param(
  [string]$DbHost = 'db.lgugwujpunhslavewffd.supabase.co',
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
# A standalone .ps1 saved in Downloads is NOT necessarily inside a Git
# checkout. Only interpret the parent as a repository when markers exist.
$parentDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoMarkers = @('.git','package.json','supabase')
$isProjectScripts = (Split-Path $PSScriptRoot -Leaf) -eq 'scripts' -and
  [bool](@($repoMarkers | Where-Object {
    Test-Path -LiteralPath (Join-Path $parentDir $_)
  }).Count)
$targetDir = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
if ($isProjectScripts) {
  $repo = $parentDir.TrimEnd('\') + '\'
  if ($targetDir.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Por segurança, grave o backup fora do repositório GitHub.'
  }
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
$stagingArchive = $null
$stagingHash = $null
$hashFile = $null
$archivePublished = $false
$hashPublished = $false
try {
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $archive = Join-Path $targetDir "tamao-prod-before-v1-164-$stamp.dump"
  $hashFile = "$archive.sha256.txt"
  if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $hashFile)) {
    throw 'Já existe um checkpoint ou checksum com este nome. Não sobrescrever.'
  }
  # Only a unique temporary file is written by pg_dump. A failed attempt does
  # not overwrite or leave a seemingly valid production checkpoint.
  $nonce = [Guid]::NewGuid().ToString('N')
  $stagingArchive = Join-Path $targetDir ('.tamao-' + $nonce + '.partial')
  $stagingHash = Join-Path $targetDir ('.tamao-' + $nonce + '.sha256.partial')
  & $dump --format=custom --no-owner --file=$stagingArchive
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar o banco.' }
  if (-not (Test-Path -LiteralPath $stagingArchive) -or
      (Get-Item -LiteralPath $stagingArchive).Length -eq 0) {
    throw 'Arquivo de backup incompleto ou vazio.'
  }
  & $restore --list $stagingArchive | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Backup falhou na leitura de catálogo.' }
  $hash = (Get-FileHash -LiteralPath $stagingArchive -Algorithm SHA256).Hash
  "SHA256 $hash" | Set-Content -LiteralPath $stagingHash -Encoding ascii

  # The two-argument File.Move refuses an existing target. Move inside the
  # same directory so a concurrent invocation cannot overwrite a checkpoint.
  [System.IO.File]::Move($stagingArchive, $archive)
  $archivePublished = $true
  [System.IO.File]::Move($stagingHash, $hashFile)
  $hashPublished = $true
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash) {
    throw 'Hash do checkpoint mudou após a publicação.'
  }
  Write-Host ('Backup privado criado: ' + $archive)
  Write-Host ('Checksum registrado: ' + $hashFile)
  Write-Host 'Antes de migrar, RESTAURE este arquivo em um banco isolado e confira os dados.'
  Write-Host 'Não anexe o backup a chats, issues, PRs nem uploads públicos.'
} catch {
  # Delete only files this invocation actually published, never the work of
  # another concurrent backup process that happened to choose the same second.
  if ($hashPublished -and (Test-Path -LiteralPath $hashFile)) {
    Remove-Item -LiteralPath $hashFile -Force -ErrorAction SilentlyContinue
  }
  if ($archivePublished -and (Test-Path -LiteralPath $archive)) {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  }
  throw
} finally {
  foreach ($partial in @($stagingArchive,$stagingHash)) {
    if ($partial -and (Test-Path -LiteralPath $partial)) {
      Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGHOST -ErrorAction SilentlyContinue
  Remove-Item Env:PGPORT -ErrorAction SilentlyContinue
  Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
  Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
}
