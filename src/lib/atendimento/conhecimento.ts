/**
 * O QUE O ROBÔ DO FIREHUB SABE — a base de conhecimento do atendimento.
 *
 * Tudo aqui foi tirado do site (src/app/page.tsx: preço, teste, suporte) e das
 * telas do painel (nomes do menu em components/customer/StoreTopNav.tsx). O
 * robô é instruído a não afirmar nada fora disto: pergunta que a base não
 * cobre vai para uma pessoa. Mudou o preço ou uma tela? Muda aqui.
 *
 * Checklist e auditoria com IA NÃO entram: são do FireCheck, outro produto,
 * mesmo aparecendo na landing (decisão do Douglas).
 */
export const CONHECIMENTO_DO_FIREHUB = `
# O FireHub
Sistema para delivery e restaurantes (hamburgueria, pizzaria, esfiharia, lanchonete, açaí, restaurante). Funciona 100% no navegador — celular, tablet ou computador, sem instalar aplicativo. Site: firehubfood.com.br

## O que tem (tudo incluído no mesmo plano)
- Cardápio digital próprio, sem taxa por pedido: delivery, retirada, mesa e balcão. Endereço: firehubfood.com.br/loja/NOME-DA-LOJA
- Robô de atendimento com IA no WhatsApp da loja: responde, monta o pedido, calcula a taxa de entrega e manda para a cozinha, 24h.
- Gestão de pedidos num quadro só: site, WhatsApp, balcão, mesa, iFood, 99Food e JotaJá.
- Integrações: iFood, 99Food, JotaJá (os pedidos entram direto no FireHub).
- Pagamento online no cardápio: Pix e cartão, pela conta Asaas da própria loja.
- Impressão automática das comandas (Assistente de Impressão no computador do caixa), com impressora por setor.
- KDS (tela da cozinha), mesas e garçom pelo celular, balcão/PDV, motoboys e rotas.
- Prazo de entrega automático no iFood conforme a cozinha e os motoboys.
- Financeiro, relatórios, estoque, CMV, etiquetas de validade, emissão de NFC-e (Fiscal).
- Marketing: cupons, fidelidade/cashback, recuperação de clientes que sumiram, disparos no WhatsApp.

## Preço (plano único, todas as funções)
- 1% de tudo que a loja fatura dentro do FireHub (cardápio digital, WhatsApp, mesa, balcão, iFood, 99Food e JotaJá entram na mesma conta).
- Mínimo de R$ 100 e máximo de R$ 400 por mês. Acima de R$ 40 mil de faturamento, não paga mais que R$ 400.
- Sem taxa por pedido. Mês sem vender nada e sem usar as funções: R$ 0. Usando ativamente (robô conectado, integrações) sem faturar: só o mínimo.
- Exemplo: faturou R$ 25.000 no mês → R$ 250.

## Teste grátis
- 15 dias completos, sem cartão de crédito, sem compromisso, sem multa. Todas as funções liberadas.
- Cadastro em menos de 2 minutos: firehubfood.com.br/cadastro — o cardápio fica no ar na hora.
- Ou pelo WhatsApp mesmo: o atendimento cria a conta com nome, nome da loja, cidade, e-mail e CPF (CNPJ se tiver). A senha a pessoa cria pelo link que chega no e-mail.

## A gente monta a loja — grátis e no mesmo dia
- Quem já vende em outro lugar manda o link do cardápio que usa hoje (iFood, Anota AI, cardápio digital, site) e a equipe do FireHub deixa a loja igualzinha: produtos, preços, fotos, adicionais e combos.
- Sem link, vale foto do cardápio físico (impresso, quadro, papel): a equipe lança tudo a partir dela.
- A equipe também configura bairros e taxas de entrega e os horários de funcionamento. A loja fica pronta para usar no mesmo dia, sem custo nenhum.
- Quem copia é a equipe (não é na hora da conversa): ela continua o atendimento pelo WhatsApp.

## Suporte
- Humano, pelo WhatsApp, 7 dias por semana.

# Onde fica cada coisa no painel (firehubfood.com.br/store, entrar em firehubfood.com.br/login)
- Pedidos: menu "Pedidos".
- Pedido que entrou como delivery mas o cliente está no salão (ou vai retirar): em "Pedidos", clicar no lápis do pedido → "Trocar para mesa ou balcão" → escolher a mesa (livre abre no nome do cliente; ocupada, o pedido entra na conta dela) ou o balcão. A taxa de entrega sai sozinha. Só antes de o pedido sair; pedido de iFood/99Food não troca; pedido já pago online não vai para a mesa (só para o balcão).
- Cardápio (produtos, preços, fotos, adicionais, combos): firehubfood.com.br/store/cardapio
- Horários, endereço, área e taxa de entrega, WhatsApp do proprietário: menu "Minha Loja".
- Robô do WhatsApp: menu "Chatbot IA". Para conectar: abrir o WhatsApp Business no celular da loja → Aparelhos conectados → Conectar aparelho → ler o QR que aparece na tela. Sem câmera: "Conectar com número de telefone" e digitar o código de 8 letras que o painel mostra.
- Impressora: ícone de impressora no topo do painel (firehubfood.com.br/store/impressoras) → "Baixar Instalador (.exe)" no computador ligado à impressora. O Assistente de Impressão precisa ficar aberto (ícone 🔥 perto do relógio do Windows), com o computador ligado e com internet.
- iFood, 99Food, JotaJá e pagamento online (Asaas): botão "Central de Integrações" no topo do painel.
- Fatura do FireHub: menu "Financeiro" → Fatura.
- Contas a pagar (boletos, acordos, contas sem código de barras): menu "Financeiro" → Contas a Pagar → "Lançar conta", pela foto do boleto (a IA preenche) ou digitando. Código de barras e categoria são opcionais; a categoria se escolhe da lista ou se escreve uma nova, e dá para pôr ou trocar depois clicando em "+ categoria" na conta. O sistema não categoriza sozinho.
- Nota fiscal (NFC-e): menu "Fiscal".
- Motoboys, Garçons, KDS, Estoque, Relatórios: cada um tem o seu item no menu.
- Esqueci a senha: firehubfood.com.br/esqueci-senha (o link chega no e-mail da conta).

# Problemas comuns
- Comanda não imprime: 1) o computador do caixa está ligado e com internet? 2) o Assistente de Impressão está aberto (ícone 🔥 perto do relógio)? Se não estiver, abrir pelo atalho "FireHub Assistente de Impressao" (área de trabalho ou menu Iniciar). 3) a impressora está ligada, com papel e aparece como pronta no Windows? 4) versão antiga do Assistente: baixar o instalador de novo em Impressoras e instalar por cima.
- Robô do WhatsApp não responde: conferir em "Chatbot IA" se está conectado. Desconectado → conectar de novo pelo QR. Conectado e mudo → pode ser o celular sem internet ou o WhatsApp deslogado dos aparelhos conectados.
- Mensagem chegando como "Aguardando mensagem" para os clientes: reiniciar a conexão do robô resolve na maioria das vezes (sem precisar de QR novo).
- Pedido do iFood não entra: conferir em Central de Integrações se o iFood aparece conectado; se caiu, conectar de novo.
`.trim();
