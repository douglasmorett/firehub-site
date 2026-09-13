# Acréscimo em pedido que está na cozinha — trabalho em andamento

Branch: `wip/acrescimo-pedido` (saiu do `master` em `a6abb763`, 12/09/2026).
**Não fazer merge no `master` antes de terminar e testar: push no `master` dispara deploy no Coolify.**

## O pedido do Douglas (12/09/2026, Hakim Centro)

A Gabi tinha o **#48 (site) em preparo** e voltou ao WhatsApp querendo acrescentar itens. O robô abriu um
pedido novo (rascunho #N257, "Retirada no local"), que caiu por inatividade e ainda saiu na impressora
(essa impressão já foi corrigida no `master`, commit `a6abb763`).

Como tem que ser:

1. O robô identifica que o telefone já tem pedido em produção e pergunta se é para **acrescentar**.
2. Conversa sobre o que o cliente quer acrescentar e **explica que vai conferir com a cozinha** se dá tempo.
3. Abre um **aviso na tela da loja**: "Cliente pedido #48 querendo acrescentar estes itens no pedido que ainda
   está em preparo — sim ou não?". No **não**, a loja pode **descrever o motivo**.
4. Loja aceita → o **pedido é modificado** (itens + total) e o cliente é avisado.
5. **Só vale para pedido do site próprio e do robô do WhatsApp.** Pedido de app (iFood, 99Food, JotaJá,
   Brendi, Wabiz): o robô explica que não dá para incluir (só em pedido do nosso site), que precisaria fazer
   pedido novo, e **oferece chamar a cozinha** — se o cliente quiser, abre o chat (`[[CHAMAR_ATENDENTE]]`,
   que cai no `HumanSupportFloatingWidget`).

## Já feito nesta branch (compila, testes passam)

| Arquivo | O que é |
|---|---|
| `src/lib/acrescimo-do-pedido.ts` | Regra pura: `podeAcrescentar` (status + canal), subtotal, textos do WhatsApp (aceito / recusado / expirado), `pedidoJaPago`. |
| `scripts/teste-acrescimo-do-pedido.mjs` | 47 casos. `node scripts/teste-acrescimo-do-pedido.mjs` |
| `src/lib/marcador-json.ts` | Extração do JSON de `[[MARCADOR: {...}]]` (balanceada, repara truncado) e remoção do texto. Saiu de dentro do `chatbot-ai.ts`. |
| `scripts/teste-marcador-json.mjs` | Compara com o código ANTIGO em 364 cortes (zero divergência) + casos do acréscimo. |
| `src/lib/itens-do-robo.ts` | `casarItensComCardapio`: o casamento item da IA → cardápio (preço do cadastro), movido **sem mudar a lógica** de `syncAiOrderToDatabase`. |
| `src/lib/acrescimo-servidor.ts` | `registrarAcrescimo` (robô cria/atualiza PENDENTE; alvo sempre do MESMO telefone e expediente), `listarAcrescimosPendentes` (expira o que saiu da cozinha e avisa o cliente), `responderAcrescimo` (ACEITAR: transação com trava de clique duplo, cria itens com nota "➕ ACRÉSCIMO", soma o total, enfileira comanda `REIMPRESSAO` só com os itens novos, WhatsApp; RECUSAR: WhatsApp com o motivo), `acrescimosDoPedidoParaOPrompt`. |
| `prisma/schema.prisma` | `model PedidoAcrescimo` (PENDENTE/ACEITO/RECUSADO/EXPIRADO). |
| `src/lib/garantir-colunas.ts` + `src/instrumentation.ts` | `CREATE TABLE IF NOT EXISTS "PedidoAcrescimo"` no boot (regra da casa: sem `db push`). |
| `src/lib/chatbot-ai.ts` | (a) usa `casarItensComCardapio` e `extrairJsonDoMarcador`/`removerMarcador`; (b) já extrai `acrescimoExtraido` (ainda **não usado**); (c) a busca de pedidos do cliente passou a trazer `dailyOrderNumber`, `source`, `ifoodOrderId`, `openDeliveryOrderId` — antes o robô via "#K6D7" (fim do id) em vez de "#48". |

## Falta fazer

1. **Prompt (`chatbot-ai.ts`)** — logo depois do `recentOrdersSummary` (~linha 697), montar `blocoDeAcrescimo`:
   - `pedidoNaCozinha` = primeiro de `recentOrders` com status em `STATUS_QUE_ACEITAM_ACRESCIMO`.
   - Canal nosso (`podeAcrescentar(...).pode`): instruir a perguntar o que acrescentar, confirmar itens e preços do
     cardápio, dizer que **vai conferir com a cozinha**, e ao confirmar emitir
     `[[ACRESCIMO_PEDIDO: {"pedido": 48, "items": [{"name": "Nome exato", "quantity": 1, "options": []}]}]]`
     (lista COMPLETA). Proibido dizer que já foi incluído. Nunca usar `PEDIDO_IA` para acréscimo.
     Incluir `await acrescimosDoPedidoParaOPrompt(pedidoNaCozinha.id)` para o robô saber se está aguardando / aceito / recusado.
   - Canal de app: explicar que não dá, oferecer pedido novo e chamar a cozinha (`[[CHAMAR_ATENDENTE]]` se o cliente quiser);
     nunca emitir `ACRESCIMO_PEDIDO`.
   - Injetar `${blocoDeAcrescimo}` como sub-itens da **regra 28**.
2. **Tratar o marcador (`chatbot-ai.ts`)** — depois do bloco do `syncAiOrderToDatabase` e ANTES do `prometeuCozinha`:
   se `acrescimoExtraido.json`, `JSON.parse` → `registrarAcrescimo({ franchiseeId: targetFranchiseeId, telefone: clientPhoneDigits,
   remoteJid, payload, storeProducts: products, timezone: user.storeTimezone })`. Registrado: acrescentar ao texto
   "🕐 Pedido de acréscimo enviado para a cozinha conferir: <lista>. Te aviso aqui assim que responderem!".
   Não registrado: trocar `cleanText` por `mensagemParaOCliente` (+ `[[CHAMAR_ATENDENTE]]` se `chamarAtendente`).
   Marcar `acrescimoTratado = true`.
3. **Trava "confirmação sem lastro"** — hoje qualquer "já está na cozinha" sem `PEDIDO_IA` finalizado troca a resposta por
   "tive um probleminha técnico". No acréscimo isso é frase normal. Pular a trava quando `acrescimoTratado`, e quando houver
   `pedidoNaCozinha` usar o regex estrito (só "pedido confirmado/registrado/anotado/fechado" e "enviado/foi para a cozinha").
4. **API** `src/app/api/store/acrescimos/route.ts`: `GET` → `listarAcrescimosPendentes(loja)`; `POST {id, decisao: "ACEITAR"|"RECUSAR", motivo}`
   → `responderAcrescimo`. Loja da sessão: `ownerId || id` (padrão de `api/cash-session/movimentacao`).
5. **Tela** `src/components/customer/AvisoAcrescimoPedido.tsx`, montado em `src/app/store/layout.tsx` ao lado do
   `HumanSupportFloatingWidget`: consulta a cada 5 s, modal com som (WebAudio, ver `OrderAlertSound.tsx`):
   "Pedido #48 — Gabi quer acrescentar: 1x Coca-Cola 2L (R$ 12,00). Pedido em preparo. Dá tempo?" → **Sim** / **Não**
   (no Não, campo de motivo + atalhos "Pedido já saiu", "Cozinha já fechou esse pedido"). Estilo inline, igual aos outros `Aviso*`.
6. **Verificar**: `node scripts/teste-acrescimo-do-pedido.mjs`, `node scripts/teste-marcador-json.mjs`,
   `node scripts/teste-tipo-do-pedido-do-robo.mjs`, `npx prisma generate` e `npx tsc --noEmit -p tsconfig.json`.
7. Só então merge no `master` (deploy).

## Cuidados

- O repositório local é **compartilhado entre agentes**: commitar só os próprios arquivos; se outro agente mexer no
  mesmo arquivo, commit parcial com `git apply --cached --recount`.
- No PC do Douglas o Prisma local não alcança o Neon por IPv6; para ler o banco use `@neondatabase/serverless`
  com `dns.setDefaultResultOrder('ipv4first')`.
- Pedido do site hoje vem com pagamento na entrega (pagamento online desligado), mas `responderAcrescimo` já anota
  "cobrar R$ X na entrega" quando o pedido estiver pago.
