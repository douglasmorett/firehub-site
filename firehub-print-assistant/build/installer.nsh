; Ganchos do instalador (o electron-builder lê este arquivo sozinho).
;
; A vigia do Windows (main.js, 1.2.27) é uma tarefa no Agendador que abre o
; Assistente a cada 5 minutos. Desinstalado o programa, ela ficaria tentando
; abrir um executável que não existe mais — sai junto. Na ATUALIZAÇÃO o
; instalador também roda o desinstalador da versão anterior, e aí a vigia fica:
; a versão nova a registra de novo ao abrir, mas até lá a loja ficaria sem.
;
; O supervisor do Modo Contingência (1.2.37) vive FORA do Assistente (spawn
; com detached, contingencia.js): sobrevive à atualização de propósito — o
; Assistente novo o adota —, mas desinstalado o programa ficaria de pé até o
; Windows reiniciar. Na desinstalação de verdade, pede para ele parar (ele
; desliga o FireHub local e o banco direito). Sem supervisor, o pedido só falha.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'schtasks /Delete /F /TN "FireHub Assistente de Impressao"'
    Pop $0
    nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:7890/__contingencia/parar -TimeoutSec 5 | Out-Null } catch {}"'
    Pop $0
  ${endIf}
!macroend
