; Ganchos do instalador (o electron-builder lê este arquivo sozinho).
;
; A vigia do Windows (main.js, 1.2.27) é uma tarefa no Agendador que abre o
; Assistente a cada 5 minutos. Desinstalado o programa, ela ficaria tentando
; abrir um executável que não existe mais — sai junto. Na ATUALIZAÇÃO o
; instalador também roda o desinstalador da versão anterior, e aí a vigia fica:
; a versão nova a registra de novo ao abrir, mas até lá a loja ficaria sem.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'schtasks /Delete /F /TN "FireHub Assistente de Impressao"'
    Pop $0
  ${endIf}
!macroend
