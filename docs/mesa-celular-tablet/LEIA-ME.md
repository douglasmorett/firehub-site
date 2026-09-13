# Módulo de mesa no celular e no tablet

Branch: `feat/mesa-celular-tablet` (base `a6abb763`, 13/09/2026). **Não está no master** — push no master dispara deploy no Coolify.

## A reclamação

Cliente: "no módulo de mesa tá muito pequeno na hora de ver e escolher os pedidos da mesa, pelo celular e pelo tablet".
Douglas: "talvez abrir uma tela cheia podendo escolher os produtos e incluir na mesa, podendo voltar para a sessão anterior".

## O que foi medido (loja de teste, garçom logado pelo link)

Fotos nesta pasta (`mesa-ux-*.png`).

| Onde | Medida |
|---|---|
| Celular 390x844, Mesa 5 aberta (6 pessoas, 3 pedidos) | Painel da mesa espremido em 46% da altura, embaixo do mapa. A lista **Pedidos da mesa fica com 16px** visíveis para 551px de conteúdo. O **Total fica abaixo da tela** (y=916). |
| Tablet em pé 820x1180 | Lista de pedidos com 99px visíveis. Itens em 12px cinza. |
| Tablet deitado 1180x820 | Lista de pedidos com ~170px. |
| Celular, lançar pedido | Com 1 item no carrinho, o **cardápio cai para 224px** e o carrinho ocupa 371px (44vh). |
| Celular, carrinho | O selo "▲ Ver tudo" **nunca aparece**: a regra `.mesa-comanda-acao { display: none }` foi declarada depois do `@media (max-width: 900px)` no `ESTILO_TABLET` e ganha dele. |
| Tela de lançar pedido | **O toast não existe nessa tela** (só é desenhado no `return` do mapa): "Coca: 2x no pedido" e "❌ Erro ao adicionar pedido" nunca aparecem para o garçom. |
| "← Voltar" | Faz `setCart([])` sem perguntar. Não há `pushState`: o **gesto de voltar do Android sai do módulo**. Recarregar perde o carrinho. |
| Item simples | Não há como pôr observação ("sem gelo"); só combo, pelo `ComboModal`. |

O diagnóstico completo dos agentes (66 problemas, 20 graves, e 20 padrões de apps de garçom com fonte) está em
[diagnostico-dos-agentes.md](diagnostico-dos-agentes.md).

## Direção

1. **Mesa em tela cheia no toque** (celular e tablet): tocar numa mesa ocupada abre a mesa inteira, com os pedidos
   grandes e legíveis, o total sempre à vista e "+ Lançar pedido" na zona do polegar. Desktop com mouse continua com o
   painel lateral.
2. **Cardápio em tela cheia**: o carrinho vira uma faixa fixa no rodapé ("4 itens · R$ 36,50 · Revisar") que abre por
   cima para conferir e enviar. O cardápio nunca perde a tela.
3. **Voltar em camadas**: o gesto de voltar do celular fecha carrinho → cardápio → mesa, nessa ordem, e só depois sai.
4. **Pedido não se perde**: o carrinho é guardado no aparelho por mesa aberta e volta ao reabrir o cardápio.
5. Consertos: toast na tela de lançar, selo "Ver tudo", observação em item simples, hover grudado no toque.

## Estado

Feito e testado:

- [x] `src/lib/voltar-em-camadas.ts`: a conta de quem fecha no voltar (camadas empilhadas, entradas soltas).
- [x] `src/components/mesas/useVoltarDoCelular.ts`: liga cada camada ao `history` (`pushState`/`popstate`). O Next 16 copia o estado interno dele no `pushState` nativo e não recarrega (`copyNextJsInternalHistoryState` em `next/dist/client/components/app-router.js`).
- [x] `src/lib/rascunho-da-mesa.ts`: guarda e restaura o carrinho por sessão da mesa (12h de validade, preço atual para item simples, item fora do cardápio e pessoa que saiu são avisados).
- [x] `node scripts/teste-voltar-e-rascunho-da-mesa.mjs`: 30 casos passando.

Falta:

- [ ] Ligar o hook e o rascunho em `src/components/mesas/MesasApp.tsx`.
- [ ] Tela cheia da mesa (toque) e cardápio com carrinho no rodapé.
- [ ] Consertos da lista acima.
- [ ] Testar de ponta a ponta no celular e no tablet (roteiro abaixo) e revisar as regras de dinheiro (dono do item, conta = fechamento).

## Como reproduzir as fotos

1. Postgres descartável: `npx prisma dev` (anote a URL TCP) e `npx prisma db push` com ela.
2. `DATABASE_URL=<URL TCP>&pgbouncer=true node scripts/e2e-seed-mesa.cjs`: cria a loja `pizzaria-e2e`, 24 produtos, 16 mesas e o garçom `joao` (senha `garcom123`). Recusa rodar fora de localhost.
3. `next dev --webpack` com essa `DATABASE_URL`. Entrar em `/garcom/pizzaria-e2e`, abrir as mesas 2, 3, 5, 8 e 13 e lançar pedidos (a sessão original usou as rotas `table-sessions` e `add-order` pelo navegador).
