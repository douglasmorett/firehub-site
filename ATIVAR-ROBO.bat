@echo off
chcp 65001 >nul
title FireHub - Ativar o robo de WhatsApp para todas as lojas
cd /d "%~dp0"

echo.
echo ==========================================================
echo   FireHub - Ativar o robo de WhatsApp em todas as lojas
echo ==========================================================
echo.
echo Este arquivo guarda a chave do Gemini na conta matriz do
echo FireHub. A partir dai, toda loja passa a ser atendida pelo
echo robo assim que o lojista conectar o QR - inclusive as lojas
echo que voce cadastrar no futuro.
echo.
echo A chave sai do arquivo .env e vai direto para o banco.
echo Ela nao aparece na tela em momento nenhum.
echo.
echo ----------------------------------------------------------
echo  PASSO 1 de 2 - conferindo (nada e gravado ainda)
echo ----------------------------------------------------------
echo.

call node scripts/definir-chave-central-gemini.js
if errorlevel 1 goto erro

echo.
echo ----------------------------------------------------------
echo  PASSO 2 de 2 - gravando
echo ----------------------------------------------------------
echo.
set /p RESPOSTA="Deu tudo certo acima? Digite S e aperte Enter para gravar: "
if /i not "%RESPOSTA%"=="S" goto cancelado

echo.
call node scripts/definir-chave-central-gemini.js --aplicar
if errorlevel 1 goto erro

echo.
echo ==========================================================
echo   PRONTO! Ja pode testar o robo no WhatsApp da loja.
echo ==========================================================
echo.
echo Manda uma mensagem para o numero da Brasa Burguer.
echo Ele deve responder com o cardapio, e nao mais com a
echo mensagem de "instabilidade tecnica".
echo.
goto fim

:cancelado
echo.
echo Cancelado. Nada foi gravado.
goto fim

:erro
echo.
echo ==========================================================
echo   Algo deu errado. Copie a mensagem acima e me mande.
echo ==========================================================

:fim
echo.
pause
