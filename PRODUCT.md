# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Dono de restaurante, pizzaria, hamburgueria ou esfiharia de bairro no Brasil, que vende por delivery
(iFood, 99Food, WhatsApp, site próprio), mesa e balcão. Lê pelo celular, entre um pedido e outro,
geralmente à noite. Não é técnico: escreve e lê como no WhatsApp.

## Product Purpose
FireHub é o sistema que junta tudo da loja num lugar só: cardápio digital sem taxa por pedido, robô
de WhatsApp com IA, quadro único de pedidos de todos os canais, KDS e impressão, entrega e motoboy,
mesa/garçom/balcão, caixa, financeiro, estoque, NFC-e e marketing. Sucesso: o lojista vende mais,
erra menos e não depende de cinco sistemas.

## Positioning
Nasceu dentro da operação do Grupo Hakim (dono da FireHub) e roda na Hakim Centro. Cobra 2% do
faturamento (mínimo R$ 100, teto R$ 400), com todas as funções incluídas. Coisas que a concorrência
não junta: alerta de bebida na comanda, prazo do iFood que acompanha a fila da cozinha, Modo
Contingência (loja segue no computador do caixa se a internet ou o FireHub cair), tráfego pago no
próprio painel.

## Capabilities and Constraints
Fatos conferidos no código em 13/10/2026 (origin/master ff32064a):
- Teste grátis de 15 dias, sem cartão. Sem multa nem fidelidade para cancelar (há multa por atraso).
- Sem venda e sem uso no mês = R$ 0. Integração ligada sem pedido não conta como uso.
- Para imprimir é preciso o Assistente de Impressão (Windows). Prazo do iFood usa extensão do Chrome
  e só escreve no iFood; o número de motoboys é informado pela loja; não pausa a loja sozinho.
- Tráfego pago: R$ 50/semana de campanha ativa (gestão), verba paga direto à Meta. A IA escreve o
  texto e gera a imagem; o Facebook decide a entrega. Não há "IA que otimiza".
- Modo Contingência: opcional, Windows no caixa; iFood não recebe pedido durante a queda; SEM
  cobrança (decisão do Douglas em 13/10/2026) — incluído no plano.
- NFC-e emissor próprio: Simples Nacional e MEI. Não prometer "todos os regimes".
- Disparo em massa está DESLIGADO. Keeta desligada até aprovação. Checklist/auditoria com IA é do
  FireCheck (produto separado) e não entra em material do FireHub.

## Brand Commitments
Nome FIRE (vermelho) + HUB, chama `/firehub-flame.png`, vermelho FireHub (#EF4444/#DC2626).
Contato: WhatsApp (22) 98111-8514, contato@firehubfood.com.br, @firehubfood.
Pixel da Meta no layout raiz. O dono decidiu manter a faixa de números atual (13/10/2026).

## Evidence on Hand
Sem depoimentos autorizados. Sem prints reais na pasta: as imagens em public/images/*.jpg são
ilustrações de IA com marcas de outros produtos e NÃO devem ser usadas. Demonstração = telas
desenhadas em HTML a partir do que o sistema realmente imprime/mostra.

## Product Principles
- Toda promessa precisa existir no código hoje.
- Escrever como WhatsApp para o dono: frase curta, palavra dele.
- Mostrar o sistema trabalhando em vez de adjetivo.
