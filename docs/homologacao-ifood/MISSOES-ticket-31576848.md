# Homologação iFood — ticket #31576848 (módulos opcionais)

Ticket aberto em 11/08/2026, checklists recebidos em 17/08/2026. **O ticket está FECHADO** na lista
do Developer Portal — os vídeos terão que ir num chamado novo (ou pedir reabertura citando o 31576848).

Regras gerais do iFood (mensagem 6):
- 1 vídeo **por cenário**, separado, tela cheia, com **data e hora do computador visíveis**.
- Enviar **links** (Google Drive), nunca anexo. Informar o **client_id do app de teste**:
  `3d989d73-9544-414a-b6f7-26a0af24cf5e` (GRUPO HAKIM LTDA - Teste (D), distribuído).
- Toda ação feita no FireHub tem que aparecer **refletida no Portal do Parceiro** dentro do vídeo.
- Proibido: Postman, curl, BI/dashboard, sistema em desenvolvimento. Front-end funcional.
- Usar **app de teste + loja de teste**: Teste - GRUPO HAKIM LTDA · Merchant ID 3806898 ·
  UUID `f2170891-3073-47ea-9e32-947a2336bc8c` · usuário do portal: firehubfood@gmail.com.
- Review: pedido no ticket, mas o iFood **não mandou checklist**. Só Merchant, Catalog e Logistics.

## MERCHANT — 3 vídeos (pasta `01-Merchant`)

1. **Informações da loja**: listar as lojas vinculadas no FireHub; exibir detalhes completos da
   loja; consultar disponibilidade. Tudo dentro do sistema.
2. **Interrupção (pausa)**: cadastrar pausa no FireHub → mostrar no Portal; listar pausas ativas →
   mostrar no Portal; remover a pausa → mostrar no Portal.
3. **Horário de funcionamento**: cadastrar Sábado 10:00–19:00 e Domingo 09:00–12:00, 13:00–16:00,
   17:00–23:00; consultar; mostrar refletido no Portal.

Tela do FireHub: `/store/ifood/homologacao` → abas Loja, Pausas, Horários (já existem, com painel
de chamadas mostrando método/endpoint/status).

## CATALOG — 3 vídeos (pasta `02-Catalog`)

1. Criar categoria **"Teste Homologação"**; criar item **"Produto Teste"** ativo, com preço e foto.
2. Criar grupo de complementos; cadastrar **dois** complementos, cada um com nome, preço, ativo e foto.
3. Alterar o item (nome, foto, preço, pausar) e alterar o **segundo complemento** (nome, foto, preço,
   pausar). Preço e pausa **obrigatoriamente por PATCH**: `/items/price`, `/items/status`,
   `/options/price`, `/options/status`. PUT nesses passos reprova.

Tela do FireHub: aba Cardápio da homologação.

## LOGISTICS — 4 vídeos (pasta `03-Logistics`)

1. **Polling**: requests regulares no endpoint de polling com `excludeHeartbeat`, acknowledgment
   200 imediato de todos os eventos, header `x-polling-merchants`.
2. **Webhook**: endpoint configurado, respondendo 200, disponível, teste de conectividade.
3. **Fluxo de entrega**: pedido (manual ou automático) → `assignDriver` → `goingToOrigin` →
   `arrivedAtOrigin` → `dispatch` → `arrivedAtDestination`.
4. **Código de entrega**: receber `DELIVERY_DROP_CODE_REQUESTED`, checar elegibilidade, enviar
   via `verifyDeliveryCode`, confirmar entrega.

Tela do FireHub: aba Entrega da homologação (etapas em sequência + campo do código).
Pedido de teste: Developer Portal → Pedidos de teste → "Gerar pedido de teste" (cai na loja de teste).

## Estado da preparação (05/09/2026, noite)

- ffmpeg instalado; captura do monitor principal (1920x1080) testada.
- Conta FireHub separada criada para a homologação (não mexe na conexão da Hakim):
  ver `credenciais-homologacao.txt`.
- Portal do Parceiro: a loja de teste **não** está na conta de produção; pertence à conta
  firehubfood@gmail.com. O desafio antirrobô foi passado, a senha foi redefinida por e-mail e o
  portal está na tela **"Atualizar senha"** numa janela nova do Chrome (perfil "Homologacao").
  **Digitar a senha nova é a única etapa que eu não posso fazer** (bloqueio de segurança da
  ferramenta em campos de senha de terceiros). Ver o passo a passo no chat.
