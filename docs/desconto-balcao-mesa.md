# Desconto com motivo no Balcão e na Mesa

Branch: `feat/desconto-balcao-mesa` (base `a6abb763`, 12/09/2026). Push no `master` dispara deploy no Coolify.

## O pedido do Douglas

"No balcão e na mesa, opção de dar desconto para o cliente e informar a descrição do motivo."

## Como ficou

**Regras das duas telas** (`src/lib/desconto-manual.ts`, a mesma conta na tela e no servidor):

- Desconto em **R$** ou em **%**, sempre sobre o consumo (itens). Nunca maior que a conta; percentual até 100%.
- **Motivo obrigatório** (3 a 200 letras), com atalhos: Cliente fiel, Pedido atrasou, Cortesia da casa, Item com problema.
- O servidor refaz a conta: o que a tela manda é só tipo, valor e motivo.
- Grava nos campos que o resto do sistema já lê: `discountTotal` + `discountMerchant` (a loja bancou, então o
  caixa não soma de volta como subsídio de parceiro) e `discountDetails[]` com `description` "Desconto 10%: Cliente fiel",
  `motivo`, `tipo`, `por` (nome de quem deu, nunca o e-mail) e `em`. O painel mostra o `description` no pedido.

**Balcão** (`/store/venda-presencial`): botão "🏷️ Dar desconto" abaixo das formas de pagamento → Subtotal / Desconto / TOTAL.
A taxa do vale é calculada sobre o valor já com desconto. A comanda impressa pelo Assistente mostra a linha
genérica "Desconto (Cupom - Loja)" (rótulo do Assistente instalado nas lojas; o motivo fica no painel).

**Mesa** (`/store/mesas`, modal "Fechar Conta"):

1. O desconto fica na **sessão** da mesa enquanto ela está aberta (`TableSession.discountType/Value/Reason/By/At`).
   Percentual acompanha pedido que chegar depois.
2. A conta, a divisão por pessoa ("− R$ X desconto" em cada uma) e a **conta impressa** (linha negativa
   "Desconto: motivo") saem de `lib/conta-da-mesa.ts`.
3. **Taxa de serviço é sobre o consumo antes do desconto**: a comissão do garçom não muda porque a loja deu desconto.
4. **Só a loja** dá desconto: pelo link do garçom a rota responde 403 e a tela do garçom só mostra o desconto, sem o botão.
5. No **fechamento**, o desconto é espalhado pelos pedidos da mesa na proporção de cada um, no centavo
   (`ratearDesconto`), com `discountDetails` alvo `MESA`. Relatório, DRE e faturamento somam `totalAmount` dos pedidos.
   A sessão guarda `discountTotal`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `src/lib/desconto-manual.ts` | `valorDoDesconto`, `validarDesconto`, `rotuloDoDesconto`, `detalheDoDesconto`, `ratearDesconto`. |
| `src/app/store/venda-presencial/page.tsx` | Caixa de desconto do balcão e total. |
| `src/app/api/store/orders/presencial/route.ts` | Valida (400 com o motivo do erro) e grava o desconto no pedido. |
| `src/app/api/store/table-sessions/[id]/desconto/route.ts` | `POST {tipo, valor, motivo}` dá/troca, `DELETE` tira. Só loja, só mesa aberta. |
| `src/lib/conta-da-mesa.ts` | Desconto na conta, na divisão por pessoa e no cupom. |
| `src/app/api/store/table-sessions/[id]/close/route.ts` | Total com desconto e rateio nos pedidos. |
| `src/components/mesas/MesasApp.tsx` | Bloco de desconto no "Fechar Conta". |
| `prisma/schema.prisma` + `src/lib/garantir-colunas.ts` | 6 colunas novas em `TableSession`, criadas no boot com `ADD COLUMN IF NOT EXISTS` (sem `db push`). |

## Testes

| Comando | Casos |
|---|---|
| `node scripts/teste-desconto-manual.mjs` | 34: valor, limites, motivo, rótulo, rateio |
| `npx tsx scripts/teste-conta-da-mesa-desconto.ts` | 32: sem desconto cada pessoa paga igual ao rateio antigo, R$, %, 100%, centavos, cupom |

Conferido de ponta a ponta num Postgres descartável (`prisma dev`) com a tela rodando:

- **Balcão:** R$ 34,90 com 10% "Cliente fiel" gravou total 31,41 e desconto 3,49. O servidor recusou
  pedido sem motivo, desconto maior que a conta e 150%.
- **Mesa:** R$ 10 "Pedido atrasou 40 minutos" em R$ 89,98 (81,80 + 10% de taxa) fechou em R$ 79,98.
  Os pedidos ficaram com 61,26 + 10,54 = 71,80 e descontos de 8,54 + 1,46 = 10,00.
