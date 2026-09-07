# 🔥 FireHub Prazos — extensão do Chrome

Ajusta o **prazo de entrega no Portal do Parceiro (iFood)** sozinho, pela carga da
cozinha lida no painel que a loja já usa (Saipos, Cardápio Web, FireHub, qualquer
kanban numa aba do Chrome) e pelos motoboys na casa.

É o produto vendido fora do FireHub. A extensão interna (`firehub-ifood-extension`)
é outra, não muda, e as duas **não podem rodar na mesma conta do iFood ao mesmo
tempo** — esta detecta a outra e recusa escrever.

## Instalar (piloto, sem Web Store)

1. Baixe `https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip` e descompacte numa pasta.
2. No Chrome: `chrome://extensions` → ligue **Modo do desenvolvedor** → **Carregar sem compactação** → escolha a pasta.
3. Fixe o ícone 🔥 (quebra-cabeça → alfinete).

## Usar

1. Abra o popup e entre com o **e-mail e a senha da conta FireHub Prazos** (não é o login do iFood).
2. Abra o painel de pedidos do seu sistema numa aba. No popup, clique **Marcar coluna na aba atual**,
   aceite a permissão para o site, e clique em cada coluna que tem pedido em produção
   (ex.: "Em preparo" e "Pronto"). Esc ou **Concluir** para terminar. Os números aparecem ao vivo no popup.
3. Ajuste **Motoboys na casa** (ou use as faixas manuais).
4. Abra **Configurações → Entrega** no Portal do Parceiro e **deixe a aba aberta**. Ligue o **Robô**.

Só faz sentido para **entrega própria**: com entrega do iFood o prazo é deles.

## Como funciona

- O leitor lê as colunas marcadas a cada 2 s e manda a soma ao service worker.
- O service worker pergunta ao servidor (`POST /api/prazos/calcular`) que prazo cabe — a tabela mora lá,
  junto com a conta e o status de pagamento. Conta sem pagamento recebe 402 e a extensão para.
- O prazo é escrito na aba do iFood de fora da página (`chrome.scripting`), com ±5 min e Salvar, e conferido lendo de volta.
- Coluna marcada que some do painel **não vira zero**: o prazo é mantido e o popup avisa para remarcar.
- A extensão **nunca abre aba do iFood sozinha**.

## Servidor

Rotas em `src/app/api/prazos/*`, conta em `PrazoConta` (`src/lib/prazos.ts`). Admin em `/admin/prazos`.
Webhook da Cakto em `POST /api/prazos/cakto?s=<CAKTO_WEBHOOK_SECRET>`.
