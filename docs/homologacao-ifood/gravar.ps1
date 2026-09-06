# Grava o monitor principal (1920x1080) em MP4, com o relógio do Windows visível na barra de tarefas.
# Uso:  .\gravar.ps1 iniciar "01-Merchant\cenario-1-informacoes-da-loja"
#       .\gravar.ps1 parar
# O arquivo sai em "Homologacao iFood\<caminho>.mp4". Um vídeo por cenário, como o iFood exige.
param(
  [Parameter(Mandatory = $true)][ValidateSet("iniciar", "parar")][string]$acao,
  [string]$nome
)
$ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg) { Write-Error "ffmpeg não encontrado (winget install Gyan.FFmpeg)"; exit 1 }
$pasta = $PSScriptRoot
$pidFile = Join-Path $pasta ".gravacao.pid"

if ($acao -eq "iniciar") {
  if (-not $nome) { Write-Error "informe o nome do vídeo"; exit 1 }
  $saida = Join-Path $pasta ($nome + ".mp4")
  New-Item -ItemType Directory -Force (Split-Path $saida) | Out-Null
  $args = @("-y", "-loglevel", "error", "-f", "gdigrab", "-framerate", "15", "-offset_x", "0", "-offset_y", "0",
            "-video_size", "1920x1080", "-draw_mouse", "1", "-i", "desktop",
            "-vcodec", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", $saida)
  $p = Start-Process -FilePath $ffmpeg -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardInput (Join-Path $pasta ".stdin.txt")
  Set-Content $pidFile $p.Id
  Write-Output ("gravando -> " + $saida + " (pid " + $p.Id + ")")
} else {
  if (-not (Test-Path $pidFile)) { Write-Output "nenhuma gravação em andamento"; exit 0 }
  $procId = Get-Content $pidFile
  # ffmpeg fecha o MP4 corretamente ao receber 'q' no stdin; sem stdin, encerramos com CTRL+C lógico via taskkill (mantém faststart).
  try { Stop-Process -Id $procId -ErrorAction Stop } catch {}
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Output "gravação encerrada"
}
