/**
 * O QUE O ROBÔ DO FIREHUB SABE — a base de conhecimento do atendimento.
 *
 * Tudo aqui foi tirado do site (src/app/page.tsx: preço, teste, suporte) e das
 * telas do painel (nomes do menu em components/customer/StoreTopNav.tsx). O
 * robô é instruído a não afirmar nada fora disto: pergunta que a base não
 * cobre vai para uma pessoa. Mudou o preço ou uma tela? Muda aqui.
 *
 * O como-usar de cada tela vem também dos vídeos tutoriais (videos.ts): a
 * lista deles entra na base junto com este texto, e a fala dos vídeos do
 * assunto da conversa também. Tela que ganhou vídeo regravado não precisa de
 * linha nova aqui.
 *
 * Linha nova aqui nasce da revisão periódica das conversas do número
 * (.claude/skills/revisar-robo-do-firehub): o que a equipe respondeu porque o
 * robô não sabia, CONFERIDO NO CÓDIGO antes de entrar (a equipe também erra de
 * memória), com um caso em scripts/ensaio-do-robo-do-firehub.ts.
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
- Pagamento online no cardápio: Pix e cartão, pela conta Asaas da própria loja (detalhes em "Pagamento online pelo site").
- Impressão automática das comandas (Assistente de Impressão no computador do caixa), com impressora por setor.
- KDS (tela da cozinha), mesas e garçom pelo celular, balcão/PDV, motoboys e rotas.
- Prazo de entrega automático no iFood conforme a cozinha e os motoboys.
- Financeiro, relatórios, estoque, CMV, etiquetas de validade, emissão de NFC-e (Fiscal).
- Marketing: cupons, fidelidade/cashback, recuperação de clientes que sumiram, disparos no WhatsApp.

## Preço (plano único, todas as funções)
- 2% de tudo que a loja fatura dentro do FireHub (cardápio digital, WhatsApp, mesa, balcão, iFood, 99Food e JotaJá entram na mesma conta).
- Mínimo de R$ 100 e máximo de R$ 400 por mês. A partir de R$ 20 mil de faturamento, não paga mais que R$ 400.
- Sem taxa por pedido. Mês sem vender nada e sem usar as funções: R$ 0. Usando ativamente (robô conectado, integrações) sem faturar: só o mínimo.
- Exemplos: faturou R$ 12.500 no mês → R$ 250; faturou R$ 30.000 → R$ 400 (o teto).
- Até 03/10/2026 a taxa era 1%; a partir de 04/10/2026 é 2% para todas as lojas (mínimo e máximo continuam os mesmos). Em outubro, as vendas de 1 a 3 entram a 1%.
- Desde 04/10/2026, pedido cancelado também entra na conta da mensalidade (passou pelo sistema e gerou custo). Rascunho do robô que não virou pedido e pedido do totem que não foi pago não contam.

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
- Também pelo chat dentro do painel, sem precisar de WhatsApp: no balão vermelho do canto da tela, aba "Suporte FireHub" (ou no botão "Fale conosco" → "Chat de suporte"). O assistente responde na hora e, quando precisa, chama a equipe, que responde ali mesmo. Funciona mesmo se o WhatsApp do FireHub estiver fora do ar.

## Pagamento online pelo site (Pix e cartão pelo Asaas)
- Não é obrigatório: sem ele, o cliente escolhe pagar na entrega (dinheiro, cartão, Pix na entrega, vale), e isso não tem custo nenhum.
- O dinheiro cai direto na conta Asaas DA LOJA (a cobrança sai no nome dela; o FireHub não segura o dinheiro): Pix na hora, cartão de crédito à vista em até 2 dias úteis. Do Asaas, a loja transfere para o banco dela quando quiser; a tela avisa a tarifa do Asaas de R$ 2,00 por transferência depois das 30 grátis do mês (conta PJ).
- Custo por venda paga pelo site: Pix R$ 1,99 + 1% e cartão 3,99% + R$ 0,49 (nos 3 primeiros meses da conta Asaas: Pix R$ 0,99 + 1% e cartão 2,99% + R$ 0,49). Desse custo, o 1% do pedido é a taxa do FireHub pelo pagamento online e o resto é a tarifa do Asaas. Sem mensalidade no Asaas. A tela do Asaas mostra a tabela "Quanto custa" com exemplos e "Quando o dinheiro chega".
- Pedido pago online só vai para a cozinha DEPOIS de pago: até lá não aparece no quadro, não imprime e não vai para o KDS. O cliente tem 30 minutos para pagar; depois disso o pedido é cancelado sozinho.
- Para ligar: "Integrações" no topo do painel → aba "Pagamentos & PIX" → cartão "Asaas" → colar a chave de API da conta Asaas da loja, marcar "Aceito as regras e o custo por venda paga pelo site" e clicar em "Conectar conta Asaas". Depois, "Ligar" em "Pix pelo site" e/ou "Cartão pelo site". Só o titular da loja conecta. Atalho: Minha Loja → Pagamentos → "Conectar Asaas".
- Quer o Pix sem taxa nenhuma? O robô do WhatsApp da loja pode mandar a chave Pix da própria loja (ver "Chave Pix da loja no robô"); aí quem confere o comprovante é a loja.

# Onde fica cada coisa no painel (firehubfood.com.br/store, entrar em firehubfood.com.br/login)
- Tutoriais em vídeo: no painel, o botão laranja "Tutoriais em vídeo" no menu lateral abre todos, e o botão "Tutorial" no topo de cada tela abre o vídeo daquela tela. Os mesmos vídeos abrem no celular, sem login, em firehubfood.com.br/tutoriais.
- Pedidos: menu "Pedidos".
- Dar desconto num pedido já lançado: em "Pedidos", abrir o pedido → "Editar itens" → "Dar desconto" (em % ou em R$, com o motivo). A tela mostra o total novo antes de salvar. Só vale quando o cliente ainda vai pagar: pedido pago online, pago no aplicativo do parceiro ou com pagamento dividido não recebe desconto por ali.
- Pedido que entrou como delivery mas o cliente está no salão (ou vai retirar): em "Pedidos", clicar no lápis do pedido → "Trocar para mesa ou balcão" → escolher a mesa (livre abre no nome do cliente; ocupada, o pedido entra na conta dela) ou o balcão. A taxa de entrega sai sozinha. Só antes de o pedido sair; pedido de iFood/99Food não troca; pedido já pago online não vai para a mesa (só para o balcão).
- Mesa: trocar o cliente de mesa é no ✏️ da mesa ocupada → "Transferir cliente para outra mesa"; a conta inteira vai junto, com o nome do cliente e a observação, e nada é relançado na cozinha. Corrigir o nome do cliente ou a observação de uma mesa já aberta: ✏️ da mesa → "Nome do cliente" / "Observação" → "Salvar Alterações". O "Nome fixo da mesa" (ex.: Varanda) é da mesa e não muda com o cliente.
- Faltou um item num pedido que já saiu: em "Pedidos", abrir o pedido (colunas Saiu para entrega ou Finalizado) → aba "📦 Faltou item" → marcar o item que faltou (ou a opção de dentro do combo). Nasce um pedido de reposição já pago, de R$ 0,00, com o endereço do cliente e o aviso de não cobrar; marcando prioridade, ele vai para o topo da cozinha (KDS).
- Cardápio (produtos, preços, fotos, adicionais, combos): firehubfood.com.br/store/cardapio
- "Lançar" um produto, uma pizza ou um sabor, no jeito de falar do lojista, é CADASTRAR no cardápio. Responda o cadastro; se a pessoa disser que é lançar um PEDIDO (no Balcão, na mesa), aí é outra tela.
- Cadastrar pizza (tamanhos e meio a meio): Cardápio → "Novo Item" → "Pizza". Um passo a passo pergunta os tamanhos, as fatias e até quantos sabores cada um aceita, como cobra o meio a meio ("o sabor mais caro" ou "a metade de cada sabor"), os sabores com o preço da pizza INTEIRA em cada tamanho e a borda recheada. O sistema faz a conta do meio a meio sozinho. Para pôr sabor novo ou mudar preço depois: "Novo Item" → "Pizza" → "Adicionar sabor ou mudar preço".
- Cadastrar lanche, porção, bebida e outros: Cardápio → "Novo Item" → "Outro item".
- Perguntas do produto (tamanho, sabor, adicionais): no cadastro do produto, em "❓ Perguntas do produto". Cada opção é um item: "Item que já existe" busca no cardápio e "Cadastrar item novo" cria. Na linha da opção, "+R$" é quanto ela soma ao preço do produto. A lixeira 🗑 no fim da linha TIRA a opção da pergunta.
- Combo (ex.: lanche + batata + refrigerante): Cardápio → "Novo Combo". Em "📦 O que o combo leva" entram os itens do cardápio que vêm no combo, e em "🙋 Escolhas do cliente no combo" o que o cliente escolhe; o combo é montado com itens que já estão cadastrados. Pausou um item, o sistema oferece pausar os combos que o levam. Produto que não é combo também pode ter pergunta.
- Promoção num produto inteiro: lápis do produto → "Preço promocional" (logo abaixo do "Preço de Venda"), menor que o preço de venda → "Salvar Alterações". Para tirar, apagar o "Preço promocional" e salvar.
- Promoção só numa opção (ex.: só a pizza Grande): na linha da opção, "Promo +R$" é quanto ela SOMA ao "Preço de Venda" do produto na promoção. NÃO é o preço final: preço da Grande na promoção = Preço de Venda do produto + Promo +R$. Conta: Promo +R$ = preço que a pessoa quer − Preço de Venda do produto. Ex. (números só de exemplo): produto a R$ 40 e Grande +30 (sai R$ 70); para a Grande sair a R$ 60, Promo +R$ = 20 (não 60: com 60, ela sairia R$ 100). Nunca use os números do exemplo como se fossem os da pessoa: o preço do produto dela aparece na própria tela (campo "Preço de Venda", e na conta embaixo da linha da opção). Precisa ser menor que o "+R$" da opção (0 vale: a opção sai pelo preço do produto). Igual ou maior que o "+R$" NÃO tem efeito: a opção continua pelo preço normal e a tela avisa "⚠️ Sem efeito" embaixo da linha. Embaixo da linha a tela mostra "Na promoção sai R$ X" com o preço normal riscado e a conta ("R$ 40 do produto + R$ 20"): é ali que a pessoa confere antes de salvar. O cardápio mostra o preço normal riscado. Não sabe o Preço de Venda do produto da pessoa? Pergunte antes de dar o número. Para tirar a promoção, apague só o número do "Promo +R$" e salve. Não use a lixeira 🗑 da linha para isso: ela tira a opção da pergunta e o tamanho some do cardápio. Sumiu assim? Na pergunta, "Item que já existe" → procurar a opção (ex.: Grande) → clicar nela, pôr o "+R$" de volta e salvar.
- Produto só num horário (ex.: marmita das 10h às 14h): lápis do produto → "🕘 Horário no Cardápio" (logo abaixo de "Dias de Disponibilidade no Cardápio") → "Só num Horário" → "Das … às …" → salvar. Fora do horário o item SOME sozinho do cardápio, do totem, do balcão e do robô (não fica cinza, não precisa pausar) e volta sozinho. O horário é o da cidade da loja. Item com horário que começa depois de a loja abrir parece "sumido" para quem olha antes: conferir esse campo.
- Ordem das categorias e dos produtos no cardápio: Cardápio → "Reordenar Cardápio" → arrastar a categoria pela alça (ou as setas, ex.: "Mover para o topo"); clicar numa categoria para ordenar os produtos dela → "💾 Salvar Ordem do Cardápio". Também há setas no cabeçalho de cada categoria na lista. A tela do Balcão segue essa ordem, sempre depois da aba "Todos", que hoje é fixa (não há opção de esconder; pedido de esconder vai para a equipe).
- Horários, endereço, área e taxa de entrega, WhatsApp do proprietário: menu "Minha Loja".
- Taxa de entrega: Minha Loja → Entrega → "Método de cobrança": por raio (linha reta), por km percorrido (pelas ruas), por bairro (cada bairro com o seu valor e tempo; bairro mais longe paga mais) ou desenhando as áreas no mapa. Trocar de método apaga o cadastro do anterior (a tela avisa). Depois, "Salvar" no alto do painel. "Simular um endereço" mostra o que o cliente vai pagar. A equipe cadastra a lista de bairros para a loja, se ela mandar a lista com os valores.
- Chave Pix da loja no robô (o robô do WhatsApp da loja manda a chave sozinho quando o pedido fecha no Pix, ou quando o cliente pede): Chatbot IA → no quadro "Estilo & Regras da IA" → "💠 Chave Pix da loja no robô" → "Chave Pix", "Nome do titular (como aparece no banco)" e "Banco (opcional)" → "Salvar chave Pix". O robô manda o valor e o titular e, numa mensagem separada, a chave (para copiar fácil), e pede o comprovante. Ele nunca diz que o Pix caiu: quem confere no banco é a loja. Não tem taxa: o dinheiro cai direto na conta da loja.
- Estoque com IA pela nota: Estoque → aba "Entrada com IA" → enviar a foto da NF-e do fornecedor → a IA lê fornecedor, número, data e itens → em "Vincular ao Estoque" escolher o insumo de cada item (ou "+ Criar novo insumo") → "✅ Confirmar Entrada". Entrada à mão: no insumo, "Movimentar" → Entrada.
- Este WhatsApp (o atendimento do FireHub) reconhece a loja pelo número que escreve: o WhatsApp da loja, o WhatsApp do proprietário (Minha Loja) e os números em Chatbot IA → Notificações → "Outras pessoas que recebem os alertas". Quem escreve de outro número é só cadastrá-lo num desses lugares.
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
- Produto, tamanho ou opção sumiu do cardápio: abrir o produto no Cardápio e conferir 1) se ele ou a opção está pausado (⏸; reativar volta a vender); 2) "🕘 Horário no Cardápio" e "Dias de Disponibilidade" (fora do horário ou do dia, o item some sozinho; compare com a hora da cidade da loja); 3) os canais (PDV, Delivery, Totem, Garçom: desligado, some daquele canal); 4) se a opção ainda está na pergunta (se saiu pela lixeira, ver "Promoção só numa opção" para pôr de volta); 5) salvar e abrir o cardápio de novo (pode levar até 1 minuto).
`.trim();
