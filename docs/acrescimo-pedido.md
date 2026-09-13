# Acréscimo em pedido que está na cozinha (robô do WhatsApp)

Branch: `wip/acrescimo-pedido` (base `a6abb763`, 12/09/2026). Push no `master` dispara deploy no Coolify.

## O pedido do Douglas (12/09/2026, Hakim Centro)

A Gabi tinha o **#48 (site) em preparo** e voltou ao WhatsApp querendo acrescentar itens. O robô abriu um
pedido novo (rascunho #N257, "Retirada no local"), que caiu por inatividade e ainda saiu na impressora
(essa impressão foi corrigida no `master`, commit `a6abb763`).

Como ficou:

1. O robô sabe que o telefone tem pedido que ainda não saiu da loja (e de que canal), e pergunta se é para
   **acrescentar** a ele ou fazer um pedido separado (regra 28 do prompt).
2. Pedido do **site próprio ou do robô**: pergunta o que acrescentar, confere nome e preço no cardápio, diz que
   **vai conferir com a cozinha** e emite `[[ACRESCIMO_PEDIDO: {"pedido": 48, "items": [...]}]]`.
   O servidor grava o pedido de acréscimo (PENDENTE) e a resposta ganha a lista com o preço do cardápio.
3. A **tela da loja** (qualquer página do painel) abre o aviso com som: "Gabi pediu para incluir no pedido #48…
   Ainda dá tempo?" → **Sim** / **Não** (no Não, motivo com atalhos). "Responder depois" minimiza para o canto esquerdo.
4. **Sim**: itens entram no pedido (nota "➕ ACRÉSCIMO"), total somado, observação registrada, **comanda do
   acréscimo** sai nas impressoras de comanda só com os itens novos, cliente avisado no WhatsApp com o novo total.
   Pedido já pago online: a observação e a mensagem mandam cobrar a diferença na entrega.
   **Não**: cliente recebe o motivo e a oferta de anotar num pedido novo.
5. Pedido que **sai da cozinha antes da resposta** vira EXPIRADO sozinho e o cliente fica sabendo que não deu tempo.
6. Pedido de **app** (iFood, 99Food, JotaJá, Brendi, Wabiz): o robô explica que não dá para incluir (só em pedido
   do nosso site ou do WhatsApp), oferece pedido novo e chamar a cozinha — `[[CHAMAR_ATENDENTE]]` abre o chat.
7. Loja com o módulo de pedidos pela IA desligado (`aiOrderingEnabled`) não recebe acréscimo pelo robô.

## Arquivos

| Arquivo | O que é |
|---|---|
| `src/lib/acrescimo-do-pedido.ts` | Regra pura: `podeAcrescentar`, contas, textos do WhatsApp, `pedidoJaPago`, `blocoDoPromptDeAcrescimo`, `prometeuCozinha`. |
| `src/lib/acrescimo-servidor.ts` | `registrarAcrescimo`, `listarAcrescimosPendentes` (expira), `responderAcrescimo` (transação com trava), `acrescimosDoPedidoParaOPrompt`. |
| `src/lib/marcador-json.ts` | Extração do JSON de `[[MARCADOR: {...}]]`, tirada de dentro do `chatbot-ai.ts`. |
| `src/lib/itens-do-robo.ts` | `casarItensComCardapio`, movido de `syncAiOrderToDatabase` sem mudar a lógica. |
| `src/lib/chatbot-ai.ts` | Busca de pedidos traz `dailyOrderNumber` e canal; bloco da regra 28; trata `[[ACRESCIMO_PEDIDO]]`; trava "sem lastro" não confunde "seu pedido #48 já está na cozinha" com mentira; rascunho só reescreve pedido NOVO **do próprio robô** (antes podia reescrever o pedido do site recém-feito do mesmo telefone). |
| `src/app/api/store/acrescimos/route.ts` | `GET` pendentes da loja da sessão; `POST {id, decisao, motivo}`. |
| `src/components/customer/AvisoAcrescimoPedido.tsx` | O aviso Sim/Não, montado em `src/app/store/layout.tsx`. |
| `prisma/schema.prisma` + `src/lib/garantir-colunas.ts` + `src/instrumentation.ts` | `model PedidoAcrescimo`; `CREATE TABLE IF NOT EXISTS` no boot (sem `db push`). |

## Testes

| Comando | Casos |
|---|---|
| `node scripts/teste-acrescimo-do-pedido.mjs` | 67 — regra, textos, prompt, trava |
| `node scripts/teste-marcador-json.mjs` | 16 — inclui comparação com o código antigo em 364 cortes |
| `npx tsx scripts/teste-acrescimo-banco.ts` (Postgres descartável do `prisma dev`, instruções no cabeçalho) | 35 — registrar, trocar lista, canal de app, outro telefone, aceitar (itens, total, comanda), clique duplo simultâneo, outra loja, recusar, expirar, aceite atrasado, pedido pago |
| `npx tsc --noEmit -p tsconfig.json` | limpo |

O teste de banco recusa rodar fora de `localhost` e exige `EVOLUTION_API_URL=http://127.0.0.1:9` (o padrão do
código é o gateway de produção).

## Cuidados

- O repositório local do Douglas é **compartilhado entre agentes**: commitar só os próprios arquivos.
- No PC do Douglas o Prisma local não alcança o Neon por IPv6; para ler o banco use `@neondatabase/serverless`
  com `dns.setDefaultResultOrder('ipv4first')`.
