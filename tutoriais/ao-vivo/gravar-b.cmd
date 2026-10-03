@echo off
rem Grava a parte B do video da extensao de prazo (iFood real) e devolve o prazo do iFood no fim.
rem Abre minimizado para a janela preta nao entrar na gravacao. Rodar por Win+R com o caminho deste arquivo.
rem CHROME_PID: o processo principal do Chrome do dia a dia (o que tem as duas janelas da gravacao).
if not "%~1"=="min" (
  start "Gravar parte B" /min cmd /c ""%~f0" min"
  exit /b
)
cd /d "%~dp0..\.."
if "%CHROME_PID%"=="" for /f %%p in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -notlike '*--type=*' -and $_.CommandLine -notlike '*--user-data-dir*' } | Select-Object -First 1).ProcessId"') do set CHROME_PID=%%p
node tutoriais\ao-vivo\gravar-b.mjs > tutoriais\saida\extensao-ifood-ao-vivo\gravar-b.log 2>&1
powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('Parte B terminou.', 'FireHub')"
