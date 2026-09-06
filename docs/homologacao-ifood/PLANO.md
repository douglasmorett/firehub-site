# Homologação iFood — plano de execução

Ticket **#31576848** (aberto 11/08/2026, checklists em 17/08/2026). Módulos pedidos: Shipping, Catalog,
Merchant, Review. O iFood mandou checklist de **Merchant, Catalog e Logistics**; de Review não veio nada.
**O ticket está fechado** na lista do Developer Portal. Os vídeos vão num chamado novo citando este número.

Regras que reprovam se falhar: 1 vídeo por cenário · tela cheia com **data e hora do computador** ·
links do Drive (nunca anexo) · **client_id do app de teste** no chamado · toda ação aparece **refletida no
Portal do Parceiro** · nada de Postman, curl, dashboard ou "sistema em desenvolvimento" · preço e pausa
do catálogo **só por PATCH**. Reprovar custa 15 dias.

---

## 1. Situação em 05/09/2026, 23h40

| Item | Estado |
|---|---|
| Ticket lido e missões copiadas | ✅ `00-LEIA-PRIMEIRO` nesta pasta |
| App de teste | ✅ **GRUPO HAKIM LTDA - Teste (D)**, distribuído, clientId `3d989d73-9544-414a-b6f7-26a0af24cf5e`. Credenciais já estão no Coolify (`IFOOD_HOMOLOG_*`) |
| Loja de teste | ✅ identificada: **Teste - GRUPO HAKIM LTDA**, Merchant ID 3806898, UUID `f2170891-3073-47ea-9e32-947a2336bc8c`. Dona: conta **firehubfood@gmail.com** (Developer Portal). **Não aparece** na conta de produção do portal (a sua, com 10 lojas) |
| Conta FireHub para gravar | ✅ criada: `homologacao.ifood@firehubfood.com.br` (senha em `credenciais-homologacao.txt`). Separada da Hakim de propósito: vincular o app de teste **sobrescreve o token** da conta, e a Hakim opera pelo app de produção |
| Gerar código do app de teste | ✅ testado: `POST /api/ifood/auth/code {app:"homologacao"}` devolve código de 8 letras, válido 10 min |
| Gravador de tela | ✅ ffmpeg instalado; captura do monitor principal testada; `gravar.ps1` nesta pasta |
| Portal do Parceiro logado como loja de teste | ❌ **travado — precisa de você** (item 4.1) |
| Vídeos | ❌ nenhum gravado ainda |

## 2. O que já existe no FireHub (tela `/store/ifood/homologacao`)

| Módulo | Cenário do iFood | Tela / botão | Situação |
|---|---|---|---|
| Merchant 1 | listar lojas, detalhes, disponibilidade | aba **Loja** | pronta (painel de chamadas mostra método, endpoint e status) |
| Merchant 2 | criar / listar / remover pausa | aba **Pausas** | pronta |
| Merchant 3 | horários sáb 10–19, dom 09–12 / 13–16 / 17–23 | aba **Horários** | pronta |
| Catalog 1 | categoria "Teste Homologação" + item "Produto Teste" ativo, preço, foto | aba **Cardápio** | pronta |
| Catalog 2 | grupo com 2 complementos (nome, preço, ativo, foto) | aba **Cardápio** | pronta (mesmo PUT do item) |
| Catalog 3 | alterar item e 2º complemento; preço e pausa por PATCH | aba **Cardápio** | pronta: nome/foto por PUT, preço/pausa por `PATCH /items/price`, `/items/status`, `/options/price`, `/options/status` |
| Logistics 1 | polling com `excludeHeartbeat`, ack 200, `x-polling-merchants` | **nenhuma tela** | ⚠️ o backend faz tudo isso (`ifood-eventos.ts`), mas o vídeo exige front-end. **Falta um painel "Eventos" mostrando o polling e os acks ao vivo** |
| Logistics 2 | webhook configurado respondendo 200 | **nenhuma tela** | ⚠️ a rota `/api/ifood/webhook` responde 200; **falta mostrar isso na tela** (saúde do webhook + último evento recebido) |
| Logistics 3 | assignDriver → goingToOrigin → arrivedAtOrigin → dispatch → arrivedAtDestination | aba **Entrega** | pronta; precisa de um **pedido real na loja de teste** |
| Logistics 4 | DELIVERY_DROP_CODE_REQUESTED → verifyDeliveryCode | aba **Entrega** (campo do código) | pronta; depende do pedido de teste emitir o evento |

## 3. O que eu consigo fazer sozinho (amanhã, sem você)

1. Construir o painel **Eventos** na homologação: polling ao vivo (URL com `excludeHeartbeat=true`, header
   `x-polling-merchants`, lista de eventos e o ack 200 de cada um) e a **saúde do webhook** (última
   chamada recebida, resposta 200, botão "testar conectividade"). Cobre Logistics 1 e 2.
2. Vincular a loja de teste à conta FireHub de homologação **assim que o portal estiver logado** (gero o
   código, colo em `portal.ifood.com.br/apps/code`, troco pelo token — tudo por tela).
3. Executar os cenários na tela do FireHub e no portal, gravando um MP4 por cenário nas pastas
   `01-Merchant`, `02-Catalog`, `03-Logistics`, com o relógio do Windows visível.
4. Gerar o pedido de teste no Developer Portal ("Pedidos de teste → Gerar pedido de teste") e conduzir
   o fluxo de entrega na aba Entrega.
5. Escrever o texto do chamado novo com os links, o client_id e a lista de cenários.

## 4. O que só você pode fazer

1. **Entrar no Portal do Parceiro como `firehubfood@gmail.com`**, numa janela do Chrome que fique aberta
   durante as gravações (sugestão: perfil separado, para não derrubar o login da Hakim que a extensão
   de prazo usa). Eu cheguei até a tela "Atualizar senha" pelo "Esqueci minha senha" (código por e-mail),
   mas **digitar senha em site de terceiro é bloqueado para mim**. A janela foi fechada; ao entrar de
   novo o portal pode pedir a senha antiga ou exigir nova senha — as duas saídas estão no item 5.
2. Deixar o computador **sem uso durante cada gravação** (5 a 10 min cada, ~10 vídeos). A captura é da
   tela inteira; qualquer janela sua entra no vídeo.
3. Decidir se **você mesmo clica** nas gravações, seguindo o roteiro que eu passo, ou se eu opero. Se eu
   operar, a faixa "O Chrome está sendo controlado por um software de teste automatizado" aparece no
   vídeo — o iFood pode ler isso como "chamada por ferramenta". Fechar a faixa no X uma vez por janela
   resolve, mas é um clique seu.
4. **Subir os vídeos no Google Drive** (de qual conta?) e gerar os links.
5. **Abrir o chamado novo** no Developer Portal (Homologação → módulos opcionais), citando o 31576848.
   Eu redijo o texto.

## 5. O que eu não sei (para você me orientar)

1. **Senha do portal da conta firehubfood@gmail.com**: você tem? Se não, eu refaço o "Esqueci minha
   senha" e você digita a nova quando a tela aparecer (30 segundos).
2. **O pedido de teste do Developer Portal serve para logística própria?** Precisa ser entrega pela
   loja (não iFood Entrega) para `assignDriver`… funcionarem, e precisa emitir
   `DELIVERY_DROP_CODE_REQUESTED` para o cenário 4. Nas sessões anteriores isso foi testado?
3. **Como gravar**: você clicando ou eu? (item 4.3)
4. **Drive**: qual conta e pasta para os links.
5. **Review**: pedir o checklist no chamado novo, ou deixar de fora nesta rodada?
6. **Shipping vs Logistics**: o ticket pediu "Shipping" e o iFood respondeu com o checklist de
   Logistics. Confirmar no chamado novo que é Logistics (entrega própria) o que queremos.
7. O portal da loja de teste: o **Gestor de Pedidos** da loja de teste mostra os pedidos de teste? Para
   o vídeo de Logistics, o reflexo "no Portal do Parceiro" seria a tela de pedidos dele.

## 6. Ordem sugerida para amanhã

1. Você loga o portal como firehubfood@gmail.com (10 min, com o desafio antirrobô e o código por e-mail).
2. Eu vinculo a loja de teste à conta FireHub de homologação e confiro as três abas de Merchant.
3. Gravamos **Merchant 1, 2, 3** e **Catalog 1, 2, 3** (6 vídeos, ~1h).
4. Eu construo o painel Eventos (~2h), deploy, e gravamos **Logistics 1 e 2**.
5. Pedido de teste → **Logistics 3 e 4**.
6. Você sobe no Drive; eu escrevo o chamado; você envia.
