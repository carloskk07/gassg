# TAMÃO — verificador offline de integridade de backup PostgreSQL.
# Não conecta ao Supabase e não cria/restaura bancos. Um teste real de
# restauração isolada ainda é necessário antes da publicação comercial.
[CmdletBinding()]
param([switch]$SelfTest,[switch]$GuiSmokeTest)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Find-Tool {
  $candidate=Join-Path $env:LOCALAPPDATA 'TAMAO\Tools\pgsql-17.11-3\pgsql\bin\pg_restore.exe'
  $paths=New-Object 'System.Collections.Generic.List[string]'
  if(Test-Path -LiteralPath $candidate -PathType Leaf){[void]$paths.Add($candidate)}
  $cmd=Get-Command pg_restore.exe -ErrorAction SilentlyContinue
  if($cmd){[void]$paths.Add($cmd.Source)}
  foreach($root in @($env:ProgramFiles,$env:ProgramW6432)){
    if([string]::IsNullOrEmpty($root)){continue}
    $dir=Join-Path $root 'PostgreSQL'
    if(!(Test-Path -LiteralPath $dir -PathType Container)){continue}
    foreach($version in (Get-ChildItem -LiteralPath $dir -Directory | Sort-Object Name -Descending)){
      $path=Join-Path $version.FullName 'bin\pg_restore.exe'
      if(Test-Path -LiteralPath $path -PathType Leaf){[void]$paths.Add($path)}
    }
  }
  foreach($path in ($paths | Select-Object -Unique)){
    $out=(& $path --version 2>$null | Out-String).Trim()
    if($LASTEXITCODE -eq 0 -and $out -match '\(PostgreSQL\)\s+(1[7-9]|[2-9][0-9])\.?'){
      return [pscustomobject]@{Path=$path;Version=$out}
    }
  }
  return $null
}

function Get-BackupIntegrity([string]$Archive) {
  $item=Get-Item -LiteralPath $Archive -ErrorAction Stop
  if($item.PSIsContainer -or $item.Length -le 0 -or
     (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or
     $item.Extension -ne '.dump'){
    throw 'O arquivo não é um backup .dump regular.'
  }
  $checksum=$item.FullName+'.sha256.txt'
  if(!(Test-Path -LiteralPath $checksum -PathType Leaf)){
    $checksum=$item.FullName+'.sha256'
  }
  if(!(Test-Path -LiteralPath $checksum -PathType Leaf)){
    throw 'Arquivo SHA-256 correspondente não encontrado. Não é possível verificar a integridade.'
  }
  $chk=Get-Item -LiteralPath $checksum
  if(($chk.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    throw 'Checksum em link simbólico não permitido.'
  }
  $line=[string](Get-Content -LiteralPath $checksum -TotalCount 1)
  if($line -notmatch '^(?:SHA256\s+)?([a-fA-F0-9]{64})(?:\s|$)'){
    throw 'Formato do arquivo de checksum inválido.'
  }
  $expected=$Matches[1].ToUpperInvariant()
  $actual=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
  if($actual -cne $expected){throw 'FALHA: SHA-256 diferente. Não use este backup.'}
  return [pscustomobject]@{Archive=$item.FullName;Size=$item.Length;SHA256=$actual;Sidecar=$checksum}
}

if($SelfTest){
  $dir=Join-Path $env:TEMP ('tamao-check-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  try{
    $archive=Join-Path $dir 'fixture.dump'
    [IO.File]::WriteAllBytes($archive,[byte[]](1,2,3,4,5,6))
    $hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    [IO.File]::WriteAllText($archive+'.sha256.txt','SHA256 '+$hash,[Text.Encoding]::ASCII)
    $ok=Get-BackupIntegrity $archive
    if($ok.SHA256 -ne $hash){throw 'SHA-256 válido recusado.'}
    [IO.File]::WriteAllBytes($archive,[byte[]](8,8,8,8))
    $rejected=$false
    try{$null=Get-BackupIntegrity $archive}catch{$rejected=$true}
    if(!$rejected){throw 'Um arquivo alterado passou pela verificação.'}
    Write-Output 'TAMAO_RESTORE_PREFLIGHT_SELFTEST_OK'
  }finally{Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue}
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object System.Windows.Forms.Form
$form.Text='TAMÃO | Verificar backup'
$form.StartPosition='CenterScreen'
$form.ClientSize=New-Object System.Drawing.Size(720,430)
$form.MinimumSize=New-Object System.Drawing.Size(740,470)
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.BackColor=[System.Drawing.Color]::FromArgb(247,249,251)
$form.Font=New-Object System.Drawing.Font('Segoe UI',10)
function Label([string]$t,[int]$x,[int]$y,[int]$w,[int]$h,[bool]$strong=$false){
  $l=New-Object System.Windows.Forms.Label
  $l.Text=$t;$l.Left=$x;$l.Top=$y;$l.Width=$w;$l.Height=$h
  if($strong){$l.Font=New-Object System.Drawing.Font('Segoe UI',12,[System.Drawing.FontStyle]::Bold)}
  return $l
}
$form.Controls.Add((Label 'TAMÃO — Verificação do backup' 25 15 665 31 $true))
$form.Controls.Add((Label 'Não exige senha, não envia arquivos e não acessa o banco online.' 25 55 665 31))
$form.Controls.Add((Label 'Arquivo de backup:' 25 103 450 24 $true))
$pathBox=New-Object System.Windows.Forms.TextBox
$pathBox.Left=25;$pathBox.Top=134;$pathBox.Width=539
$pathBox.ReadOnly=$true
$form.Controls.Add($pathBox)
$pickButton=New-Object System.Windows.Forms.Button
$pickButton.Text='Escolher...';$pickButton.Left=578;$pickButton.Top=130
$pickButton.Width=115;$pickButton.Height=36
$form.Controls.Add($pickButton)
$tools=Find-Tool
$status=Label 'Aguardando verificação.' 25 198 659 67
$form.Controls.Add($status)
$verify=New-Object System.Windows.Forms.Button
$verify.Text='VERIFICAR ARQUIVO COMPLETO'
$verify.Left=25;$verify.Top=285;$verify.Width=365;$verify.Height=55
$verify.BackColor=[System.Drawing.Color]::FromArgb(0,130,111)
$verify.ForeColor=[System.Drawing.Color]::White
$verify.FlatStyle='Flat'
$verify.FlatAppearance.BorderSize=0
$form.Controls.Add($verify)
$openFolder=New-Object System.Windows.Forms.Button
$openFolder.Text='Abrir pasta';$openFolder.Left=405;$openFolder.Top=285
$openFolder.Width=142;$openFolder.Height=55
$form.Controls.Add($openFolder)
$copyButton=New-Object System.Windows.Forms.Button
$copyButton.Text='Copiar resultado';$copyButton.Left=557;$copyButton.Top=285
$copyButton.Width=136;$copyButton.Height=55
$copyButton.Enabled=$false
$form.Controls.Add($copyButton)
$form.Controls.Add((Label 'Atenção: esta verificação NÃO é uma restauração real em outro banco.' 25 365 665 46))
$script:lastReport=''
$backupDir=Join-Path $env:LOCALAPPDATA 'TAMAO\Backups'
if(Test-Path -LiteralPath $backupDir -PathType Container){
  $newest=Get-ChildItem -LiteralPath $backupDir -File -Filter '*.dump' |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if($newest){$pathBox.Text=$newest.FullName}
}
if(!$tools){
  $verify.Enabled=$false
  $status.Text='pg_restore 17+ não localizado. Abra o assistente de backup e clique em BAIXAR FERRAMENTAS.'
}else{
  $status.Text='Ferramentas disponíveis: '+$tools.Version
}
$pickButton.Add_Click({
  $dialog=New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title='Selecione o backup TAMÃO (.dump)'
  $dialog.Filter='Backup PostgreSQL|*.dump'
  if(Test-Path -LiteralPath $backupDir){$dialog.InitialDirectory=$backupDir}
  if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){
    $pathBox.Text=$dialog.FileName
    $copyButton.Enabled=$false
  }
  $dialog.Dispose()
})
$openFolder.Add_Click({
  if(Test-Path -LiteralPath $backupDir){
    [System.Diagnostics.Process]::Start('explorer.exe',('"'+$backupDir+'"')) | Out-Null
  }
})
$copyButton.Add_Click({
  if($script:lastReport){[System.Windows.Forms.Clipboard]::SetText($script:lastReport)}
})
$verify.Add_Click({
  if(!$tools){return}
  if([string]::IsNullOrWhiteSpace($pathBox.Text)){
    $status.Text='Selecione o arquivo .dump na pasta de backups.'
    return
  }
  $verify.Enabled=$false;$copyButton.Enabled=$false
  try{
    $status.ForeColor=[System.Drawing.Color]::FromArgb(17,50,84)
    $status.Text='1/3 — Conferindo SHA-256...'
    [System.Windows.Forms.Application]::DoEvents()
    $entry=Get-BackupIntegrity $pathBox.Text
    $status.Text='2/3 — Lendo catálogo do PostgreSQL...'
    [System.Windows.Forms.Application]::DoEvents()
    $toc=(& $tools.Path --format=custom --list $entry.Archive 2>&1 | Out-String)
    if($LASTEXITCODE -ne 0){throw 'Não foi possível ler o catálogo do backup.'}
    $tableCount=[regex]::Matches($toc,'(?m)^\s*\d+;\s+\d+\s+\d+\s+TABLE\s+').Count
    if($tableCount -le 0){throw 'O arquivo não contém tabelas no catálogo.'}
    $status.Text='3/3 — Lendo e descompactando todos os dados do arquivo. Aguarde...'
    [System.Windows.Forms.Application]::DoEvents()
    # NUL on Windows is an operating-system null device. No data is written
    # to disk, no SQL is executed and there is no network/database connection.
    $null=(& $tools.Path --format=custom --no-owner --no-privileges --file=NUL $entry.Archive 2>&1 | Out-String)
    if($LASTEXITCODE -ne 0){throw 'Não foi possível ler integralmente os dados. Backup não aprovado.'}
    $script:lastReport='BACKUP_INTEGRITY_OK; SHA256_OK; CATALOG_OK; FULL_ARCHIVE_STREAM_OK; '+$tableCount+' TABELAS; REAL_RESTORE_NOT_TESTED'
    $status.Text='Arquivo íntegro! SHA-256, catálogo e leitura integral aprovados. '+$tableCount+' tabelas no catálogo. Ainda falta restaurar em ambiente isolado.'
    $status.ForeColor=[System.Drawing.Color]::FromArgb(0,122,89)
    $copyButton.Enabled=$true
  }catch{
    $status.ForeColor=[System.Drawing.Color]::FromArgb(176,55,47)
    $status.Text='VERIFICAÇÃO REPROVADA: '+$_.Exception.Message
    $script:lastReport=''
  }finally{$verify.Enabled=$true}
})
if($GuiSmokeTest){
  $form.Dispose()
  Write-Output 'TAMAO_RESTORE_PREFLIGHT_GUI_OK'
  exit 0
}
[void]$form.ShowDialog()
$form.Dispose()
