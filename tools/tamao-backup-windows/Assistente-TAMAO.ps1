# TAMÃO — assistente local de backup PostgreSQL para Windows 10/11.
# Não envia informações à Internet, exceto a conexão de leitura PostgreSQL
# iniciada explicitamente pelo usuário com o próprio Supabase.
# Nunca cria banco, modifica tabelas, envia dump ao GitHub ou ativa vendas.
[CmdletBinding()]
param([switch]$SelfTest,[switch]$GuiSmokeTest)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-PostgresClients {
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  $found = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($found) { [void]$candidates.Add($found.Source) }
  $roots = @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'), $env:ProgramW6432, $env:LOCALAPPDATA) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  foreach ($root in $roots) {
    foreach ($suffix in @('PostgreSQL','Programs\PostgreSQL')) {
      $base = Join-Path $root $suffix
      if (-not (Test-Path -LiteralPath $base -PathType Container)) { continue }
      foreach ($dir in (Get-ChildItem -LiteralPath $base -Directory | Sort-Object Name -Descending)) {
        $candidate = Join-Path $dir.FullName 'bin\pg_dump.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { [void]$candidates.Add($candidate) }
      }
    }
  }
  foreach ($dump in ($candidates | Select-Object -Unique)) {
    $folder = Split-Path $dump -Parent
    $restore = Join-Path $folder 'pg_restore.exe'
    if (-not (Test-Path -LiteralPath $restore -PathType Leaf)) { continue }
    $version = (& $dump --version 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { continue }
    $match = [regex]::Match($version, '\(PostgreSQL\)\s+(\d+)')
    if (-not $match.Success) { continue }
    $major = [int]$match.Groups[1].Value
    if ($major -lt 17) { continue }
    return [pscustomobject]@{ Dump=$dump; Restore=$restore; Version=$version; Major=$major }
  }
  return $null
}

function Test-ConnectionFields([string]$HostName, [string]$PortNumber, [string]$DatabaseName, [string]$UserName) {
  if ($HostName -notmatch '^[a-zA-Z0-9.-]{3,253}$' -or $HostName.StartsWith('-') -or $HostName.EndsWith('.')) {
    throw 'Informe um host PostgreSQL válido, sem https://, senha ou espaços.'
  }
  $portValue = 0
  if (-not [int]::TryParse($PortNumber,[ref]$portValue) -or $portValue -lt 1 -or $portValue -gt 65535) {
    throw 'Porta inválida. Use um número entre 1 e 65535.'
  }
  foreach ($value in @($DatabaseName,$UserName)) {
    if ([string]::IsNullOrWhiteSpace($value) -or $value.Length -gt 128 -or $value -notmatch '^[a-zA-Z0-9_.-]+$') {
      throw 'Banco ou usuário inválido. Utilize os valores informados no Supabase Connect.'
    }
  }
  return $portValue
}

function Get-SafeErrorMessage([string]$ErrorOutput) {
  if ($ErrorOutput -match '(?i)password authentication failed|authentication failed|SASL') {
    return 'O servidor não aceitou a autenticação. Confira a senha do banco (não é a senha do site do Supabase).'
  }
  if ($ErrorOutput -match '(?i)Network is unreachable|No route to host|could not connect.*IPv6|address family not supported') {
    return 'O acesso direto parece indisponível nesta rede. No Supabase, abra Connect e use a opção Session pooler (host, porta e usuário).'
  }
  if ($ErrorOutput -match '(?i)could not translate host name|Name or service not known') {
    return 'Não foi possível localizar o servidor. Confira o host em Supabase > Connect.'
  }
  if ($ErrorOutput -match '(?i)timeout expired|connection timed out') {
    return 'A conexão demorou demais. Confira Internet, firewall e a opção Session pooler no Supabase.'
  }
  if ($ErrorOutput -match '(?i)server version mismatch|unsupported version') {
    return 'As ferramentas PostgreSQL instaladas são incompatíveis com o servidor. Instale PostgreSQL 17 ou superior.'
  }
  return 'O servidor não concluiu o procedimento. Confira os dados de conexão e tente novamente.'
}

# Runnable offline contract check for Windows CI. No UI/network/backup involved.
if ($SelfTest) {
  if ((Test-ConnectionFields 'db.example.supabase.co' '5432' 'postgres' 'postgres') -ne 5432) { throw 'Valid settings rejected' }
  foreach ($invalid in @('https://host','-bad.example','host/a')) {
    $rejected=$false
    try { $null=Test-ConnectionFields $invalid '5432' 'postgres' 'postgres' } catch { $rejected=$true }
    if (-not $rejected) { throw 'Unsafe host accepted' }
  }
  if ((Get-SafeErrorMessage 'password authentication failed for user') -notmatch 'autenticação') {
    throw 'Sensitive server error mapping unavailable'
  }
  Write-Output 'TAMAO_GUI_OFFLINE_SELFTEST_OK'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$navy = [System.Drawing.Color]::FromArgb(15,29,49)
$muted = [System.Drawing.Color]::FromArgb(91,108,128)
$teal = [System.Drawing.Color]::FromArgb(5,133,113)
$bg = [System.Drawing.Color]::FromArgb(246,248,251)
$cardBg = [System.Drawing.Color]::White
$form = New-Object System.Windows.Forms.Form
$form.Text = 'TAMÃO | Backup privado'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(680,608)
$form.MinimumSize = New-Object System.Drawing.Size(700,640)
$form.BackColor = $bg
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.AutoScaleMode = 'Dpi'
$form.Font = New-Object System.Drawing.Font('Segoe UI',10)

function New-TextLabel([string]$Text,[int]$Left,[int]$Top,[int]$Width,[int]$Height,[int]$Size=10,[bool]$Strong=$false) {
  $control = New-Object System.Windows.Forms.Label
  $control.Text = $Text
  $control.Left = $Left; $control.Top = $Top; $control.Width = $Width; $control.Height = $Height
  $style=if ($Strong) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $control.Font = New-Object System.Drawing.Font('Segoe UI',$Size,$style)
  $control.ForeColor = if ($Strong) { $navy } else { $muted }
  return $control
}
function New-Entry([string]$Initial,[int]$Left,[int]$Top,[int]$Width) {
  $control = New-Object System.Windows.Forms.TextBox
  $control.Left = $Left; $control.Top = $Top; $control.Width = $Width
  $control.Height = 28; $control.Text = $Initial
  $control.BorderStyle = 'FixedSingle'
  return $control
}
function New-Action([string]$Text,[int]$Left,[int]$Top,[int]$Width,[int]$Height,[bool]$Primary=$false) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Left = $Left; $button.Top = $Top; $button.Width = $Width; $button.Height = $Height
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 0
  if ($Primary) { $button.BackColor=$teal; $button.ForeColor=[System.Drawing.Color]::White }
  else { $button.BackColor=[System.Drawing.Color]::FromArgb(232,236,242); $button.ForeColor=$navy }
  return $button
}

$form.Controls.Add((New-TextLabel 'TAMÃO' 27 18 180 32 20 $true))
$form.Controls.Add((New-TextLabel 'Backup privado do banco de dados' 29 56 620 28 13 $true))
$form.Controls.Add((New-TextLabel 'O arquivo fica no seu computador. Nenhum dado é enviado ao GitHub ou ChatGPT.' 29 89 630 41 9))

$panel = New-Object System.Windows.Forms.Panel
$panel.Left=26; $panel.Top=132; $panel.Width=628; $panel.Height=270
$panel.BackColor=$cardBg
$form.Controls.Add($panel)
$panel.Controls.Add((New-TextLabel 'Conexão Supabase' 18 12 500 24 12 $true))
$panel.Controls.Add((New-TextLabel 'Host do banco' 18 45 380 20 9))
$hostBox = New-Entry 'db.lgugwujpunhslavewffd.supabase.co' 18 67 586
$panel.Controls.Add($hostBox)
$panel.Controls.Add((New-TextLabel 'Porta' 18 111 105 20 9))
$panel.Controls.Add((New-TextLabel 'Usuário' 142 111 225 20 9))
$panel.Controls.Add((New-TextLabel 'Banco' 390 111 200 20 9))
$portBox = New-Entry '5432' 18 133 103
$userBox = New-Entry 'postgres' 142 133 222
$dbBox = New-Entry 'postgres' 390 133 213
$panel.Controls.AddRange(@($portBox,$userBox,$dbBox))
$panel.Controls.Add((New-TextLabel 'Senha PostgreSQL (não é a senha do seu login Supabase)' 18 176 580 20 9))
$passBox = New-Entry '' 18 198 586
$passBox.UseSystemPasswordChar=$true
$panel.Controls.Add($passBox)
$panel.Controls.Add((New-TextLabel 'Senha utilizada só na conexão local; nunca salva em arquivo.' 18 237 580 20 9))

$toolStatus = New-TextLabel 'Procurando ferramentas PostgreSQL...' 29 416 620 23 10
$form.Controls.Add($toolStatus)
$status = New-TextLabel 'Pronto para verificar.' 29 450 620 44 10
$form.Controls.Add($status)
$startButton = New-Action 'CRIAR BACKUP PRIVADO' 27 502 304 49 $true
$installButton = New-Action 'Ferramentas PostgreSQL' 344 502 194 49
$folderButton = New-Action 'Abrir pasta' 548 502 105 49
$form.Controls.AddRange(@($startButton,$installButton,$folderButton))
$form.Controls.Add((New-TextLabel 'Sem vendas, migrações ou alterações no banco. A restauração será testada depois.' 29 568 630 28 8))

$script:running=$false
$script:cancelRequested=$false
$script:tools=$null
$script:activeProcess=$null
$script:targetDir=Join-Path $env:LOCALAPPDATA 'TAMAO\Backups'

function Set-Status([string]$Text,[bool]$ErrorState=$false) {
  $status.Text=$Text
  $status.ForeColor=if ($ErrorState) { [System.Drawing.Color]::FromArgb(175,56,47) } else { $teal }
  [System.Windows.Forms.Application]::DoEvents()
}
function Set-Running([bool]$Running) {
  $script:running=$Running
  $startButton.Text=if ($Running) {'CANCELAR BACKUP'} else {'CRIAR BACKUP PRIVADO'}
  $installButton.Enabled = -not $Running
  $hostBox.Enabled = -not $Running
  $userBox.Enabled = -not $Running
  $dbBox.Enabled = -not $Running
  $portBox.Enabled = -not $Running
  $passBox.Enabled = -not $Running
}
function Invoke-PgTool([string]$Executable,[string]$Arguments,[string]$Secret='') {
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$Executable
  $psi.Arguments=$Arguments
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardError=$true
  $psi.RedirectStandardOutput=$true
  $psi.EnvironmentVariables['PGHOST']=$hostBox.Text.Trim()
  $psi.EnvironmentVariables['PGPORT']=$portBox.Text.Trim()
  $psi.EnvironmentVariables['PGDATABASE']=$dbBox.Text.Trim()
  $psi.EnvironmentVariables['PGUSER']=$userBox.Text.Trim()
  $psi.EnvironmentVariables['PGSSLMODE']='require'
  $psi.EnvironmentVariables['PGCONNECT_TIMEOUT']='15'
  if ($Secret.Length -gt 0) { $psi.EnvironmentVariables['PGPASSWORD']=$Secret }
  $p=New-Object System.Diagnostics.Process
  $p.StartInfo=$psi
  try {
    if (-not $p.Start()) { throw 'Não foi possível abrir o cliente PostgreSQL.' }
    $script:activeProcess=$p
    $psi.EnvironmentVariables.Remove('PGPASSWORD')
    $stderrTask=$p.StandardError.ReadToEndAsync()
    $stdoutTask=$p.StandardOutput.ReadToEndAsync()
    while (-not $p.WaitForExit(150)) {
      [System.Windows.Forms.Application]::DoEvents()
      if ($script:cancelRequested) {
        try { $p.Kill() } catch {}
        $p.WaitForExit()
        throw 'Operação cancelada. Nenhum backup incompleto será apresentado como válido.'
      }
    }
    $p.WaitForExit()
    return [pscustomobject]@{Code=$p.ExitCode; Err=$stderrTask.Result; Out=$stdoutTask.Result}
  } finally {
    $psi.EnvironmentVariables.Remove('PGPASSWORD')
    $script:activeProcess=$null
    $p.Dispose()
  }
}

function Refresh-Tools {
  $toolStatus.Text='Verificando ferramentas PostgreSQL...'
  [System.Windows.Forms.Application]::DoEvents()
  try { $script:tools=Get-PostgresClients } catch { $script:tools=$null }
  if ($null -eq $script:tools) {
    $toolStatus.Text='Falta instalar PostgreSQL Command Line Tools 17 ou superior.'
    $toolStatus.ForeColor=[System.Drawing.Color]::FromArgb(175,56,47)
    $startButton.Enabled=$false
    $installButton.Text=if ($installButton.Tag -eq 'opened') { 'VERIFICAR NOVAMENTE' } else { 'COMO INSTALAR' }
  } else {
    $toolStatus.Text='Ferramentas encontradas: '+$script:tools.Version
    $toolStatus.ForeColor=$teal
    $startButton.Enabled=$true
    $installButton.Text='Rever ferramentas'
  }
}

$installButton.Add_Click({
  if ($null -ne $script:tools -or $installButton.Tag -eq 'opened') {
    Refresh-Tools
    return
  }
  $msg='Abra a página oficial do PostgreSQL para Windows e instale apenas Command Line Tools, versão 17 ou superior (se o instalador oferecer seleção de componentes). Depois volte aqui e clique em VERIFICAR NOVAMENTE.'
  [System.Windows.Forms.MessageBox]::Show($msg,'Instalação das ferramentas',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
  $installButton.Tag='opened'
  [System.Diagnostics.Process]::Start('https://www.postgresql.org/download/windows/') | Out-Null
  Refresh-Tools
})
$folderButton.Add_Click({
  if (Test-Path -LiteralPath $script:targetDir -PathType Container) {
    [System.Diagnostics.Process]::Start('explorer.exe','"'+$script:targetDir+'"') | Out-Null
  } else {
    [System.Windows.Forms.MessageBox]::Show('A pasta aparecerá quando o primeiro backup for criado.','TAMÃO') | Out-Null
  }
})
$form.Add_FormClosing({
  param($sender,$eventArgs)
  if ($script:running) {
    $eventArgs.Cancel=$true
    $script:cancelRequested=$true
    Set-Status 'Cancelando com segurança...'
  }
})

$startButton.Add_Click({
  if ($script:running) {
    $script:cancelRequested=$true
    Set-Status 'Cancelando...'
    return
  }
  if ($null -eq $script:tools) { Refresh-Tools; return }
  $archive=$null; $partial=$null; $sidecar=$null; $tempChecksum=$null
  $archiveMoved=$false; $checksumMoved=$false
  $script:cancelRequested=$false
  try {
    $null=Test-ConnectionFields $hostBox.Text.Trim() $portBox.Text.Trim() $dbBox.Text.Trim() $userBox.Text.Trim()
    if ($passBox.Text.Length -eq 0) { throw 'Digite a senha do PostgreSQL no campo indicado.' }
    $answer=[System.Windows.Forms.MessageBox]::Show(
      'O TAMÃO criará uma cópia de leitura do banco em seu computador. Nenhum dado será enviado a terceiros. Continuar?',
      'Confirmar backup',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question)
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    Set-Running $true
    New-Item -ItemType Directory -Path $script:targetDir -Force | Out-Null
    $now=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $nonce=[Guid]::NewGuid().ToString('N')
    $archive=Join-Path $script:targetDir ('tamao-'+$now+'-'+$nonce.Substring(0,12)+'.dump')
    $partial=Join-Path $script:targetDir ('.tamao-'+$nonce+'.partial')
    $sidecar=$archive+'.sha256.txt'
    $tempChecksum=Join-Path $script:targetDir ('.tamao-'+$nonce+'.sha256.partial')
    Set-Status 'Exportando banco por conexão criptografada. Aguarde...'
    # Password only in this child process environment, not command-line args,
    # logs, registry, a stored file or a global session variable.
    $dumpResult=Invoke-PgTool $script:tools.Dump ('--format=custom --no-owner --file="'+$partial+'"') $passBox.Text
    $passBox.Clear()
    if ($dumpResult.Code -ne 0) { throw (Get-SafeErrorMessage $dumpResult.Err) }
    if (-not (Test-Path -LiteralPath $partial -PathType Leaf) -or (Get-Item -LiteralPath $partial).Length -eq 0) {
      throw 'O arquivo do backup não foi criado corretamente.'
    }
    if ($script:cancelRequested) { throw 'Operação cancelada.' }
    Set-Status 'Conferindo o catálogo do arquivo...'
    $check=Invoke-PgTool $script:tools.Restore ('--list "'+$partial+'"')
    if ($check.Code -ne 0) { throw 'O catálogo do backup não pôde ser validado.' }
    $hash=(Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
    [System.IO.File]::WriteAllText($tempChecksum,'SHA256 '+$hash+[Environment]::NewLine,[System.Text.Encoding]::ASCII)
    if ($script:cancelRequested) { throw 'Operação cancelada.' }
    # Atomic exclusive file moves: never overwrite a previous checkpoint.
    [System.IO.File]::Move($partial,$archive); $archiveMoved=$true
    [System.IO.File]::Move($tempChecksum,$sidecar); $checksumMoved=$true
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash) {
      throw 'O checksum mudou após salvar o arquivo.'
    }
    Set-Status 'BACKUP CRIADO! Salvo em TAMAO\\Backups. Agora falta testar a restauração.'
    [System.Windows.Forms.MessageBox]::Show(
      'Backup privado criado com sucesso. O arquivo e o checksum estão em '+$script:targetDir+[Environment]::NewLine+[Environment]::NewLine+
      'IMPORTANTE: a exportação não prova que a restauração funcionará. Não envie o arquivo para o ChatGPT, GitHub ou WhatsApp.',
      'Backup concluído',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
  } catch {
    $passBox.Clear()
    if ($checksumMoved -and $sidecar -and (Test-Path -LiteralPath $sidecar)) { Remove-Item -LiteralPath $sidecar -Force -ErrorAction SilentlyContinue }
    if ($archiveMoved -and $archive -and (Test-Path -LiteralPath $archive)) { Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue }
    Set-Status $_.Exception.Message $true
  } finally {
    foreach ($tmp in @($partial,$tempChecksum)) {
      if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    Set-Running $false
  }
})

$form.Add_Shown({ Refresh-Tools })
if ($GuiSmokeTest) {
  $form.Dispose()
  Write-Output 'TAMAO_GUI_INITIALIZATION_OK'
  exit 0
}
[void]$form.ShowDialog()
$form.Dispose()
