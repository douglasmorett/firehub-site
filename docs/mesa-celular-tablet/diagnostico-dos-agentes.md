## Problemas encontrados (66)

Ordenados por gravidade. Cada leitor olhou uma parte: painel da mesa, tela de lançar pedido, fluxos em volta.

### [alta] Feedback / erros na tela de lançar — ambos (L01)
- **O que acontece:** O aviso flutuante (toast) não aparece na tela de lançar pedido. A tela de pedido tem um return próprio, que sai antes do resto do componente, e o toast só é desenhado no return do mapa. Por isso ficam invisíveis: o aviso 'Coca-Cola: 2x no pedido' de cada toque, os erros do Enviar ('❌ Erro de conexão', '❌ Erro ao adicionar pedido'), a falha do '+ Pessoa' e o aviso de rota proibida do garçom. O código conta com esse aviso para evitar que o garçom toque de novo 'para garantir' (comentário em 1028-1029).
- **Evidência:** MesasApp.tsx:1316-1618 (return da tela de pedido, sem {toast}); o toast só é desenhado em MesasApp.tsx:3006-3016, dentro do return do mapa (1622-3020). O showToast é chamado com a tela de pedido aberta em 1032, 795, 797, 626 e 259. Foto celular-4: 4 toques e nenhum aviso na tela.
- **Efeito no garçom:** Quando o envio falha, o botão volta de 'Enviando...' para 'Enviar' sem mensagem nenhuma. O garçom pode achar que foi e sair, e a cozinha não recebe. Ou toca de novo, e se a primeira chamada chegou ao servidor e só a resposta se perdeu, o pedido sai duas vezes. No toque do produto, a única confirmação é um número de 10px no canto do card.

### [alta] Voltar / perda do carrinho — ambos (L02)
- **O que acontece:** O '← Voltar' apaga o carrinho na hora, sem perguntar (setCart([])). A tela de pedido não entra no histórico do navegador: não há pushState nem popstate no MesasApp. Assim, o gesto ou botão voltar do Android e o gesto de borda do iOS saem do módulo. O carrinho só existe na memória do React, então recarregar a página, a aba ser descartada ou a tela bloquear e recarregar também perdem tudo.
- **Evidência:** MesasApp.tsx:1330 (onClick do Voltar: setView('grid'); setCart([]) sem confirm). O estado do carrinho fica só em useState em MesasApp.tsx:349-354. O grep por pushState, popstate e beforeunload no MesasApp.tsx não acha nada. Quem já usa history é o ComboModal.tsx:135-144, então o padrão já existe no projeto.
- **Efeito no garçom:** Com 8 itens de uma mesa de 6 pessoas no carrinho, basta um toque no Voltar (fica no canto de cima, onde o polegar esbarra) ou o gesto de voltar do celular para perder tudo. O garçom tem que lembrar e relançar cada item, cada dono e cada combo.

### [alta] Espaço do cardápio x carrinho (celular) — celular (L03)
- **O que acontece:** No celular, 248px do topo são fixos: cabeçalho roxo 64px, busca e categorias 122px, 'Lançar para' 62px. Abaixo de 900px o carrinho vai para o rodapé com até 44vh. Com o carrinho vazio, a mensagem 'Toque nos produtos para adicionar' ocupa 224px e a grade fica com 372px. Com 1 item ou mais, a grade cai para 224px, cerca de 26% da tela: 2 cards inteiros e o topo de mais 2. Num aparelho real, com pointer coarse, os botões sobem para min-height 44px (categorias de 35 para 44, chips de 36 para 44, busca de 40 para 44). Isso soma uns 21px e deixa a grade em torno de 203px.
- **Evidência:** ESTILO_TABLET em MesasApp.tsx:153-163 (grid-template-rows 1fr auto; .mesa-comanda max-height 44vh) e 200-203 (min-height 44px). Empty state com padding 40 em MesasApp.tsx:1535-1537. Foto celular-3: grade de y=248 a 620 (372px), carrinho vazio de 620 a 844 (224px). Foto celular-4: grade de 248 a 472 (224px), carrinho de 472 a 844 (372px).
- **Efeito no garçom:** É exatamente o 'tá muito pequeno' do cliente. Para achar a 7ª bebida o garçom rola uma faixa de dois dedos, que mostra 2 produtos por vez, com uma mão só e o bloco ou a bandeja na outra.

### [alta] Carrinho expandido invisível / cardápio some — celular (L04)
- **O que acontece:** O selo '▲ Ver tudo / ▼ Recolher' nunca aparece. A regra base .mesa-comanda-acao{display:none} foi declarada DEPOIS do @media (max-width:900px), tem a mesma especificidade e por isso ganha. Só que o cabeçalho '🛒 Carrinho (N itens)' inteiro continua sendo um botão que alterna .aberta (max-height 86vh). Um toque sem querer nessa faixa de 50px, logo abaixo da grade onde o polegar rola, expande o carrinho sem nenhuma indicação de como recolher. Com cerca de 70px por linha, 5 linhas no carrinho deixam a grade com uns 68px (844-528-248). Com 8 linhas o carrinho bate 726px, a primeira linha do grid fica com 118px e nem cabem o cabeçalho e a busca (186px): o cardápio desaparece. O estado comandaAberta nunca é zerado, nem ao enviar nem ao trocar de mesa.
- **Evidência:** MesasApp.tsx:167 (display inline-flex dentro do @media) contra MesasApp.tsx:179-183 (display none depois, fora do media). Cabeçalho-botão com onClick setComandaAberta em MesasApp.tsx:1509-1528. Regra .aberta max-height 86vh em MesasApp.tsx:166. setComandaAberta só aparece em 1511 (grep). Foto celular-5: carrinho 'aberto' sem o selo visível. Medida dada: display none calculado em 390px.
- **Efeito no garçom:** No meio do pico o cardápio 'some' e o garçom não sabe o que fez nem como desfazer. A tendência é apertar Voltar, que apaga o carrinho (L02).

### [alta] Observação em item simples — ambos (L05)
- **O que acontece:** Não existe como pôr observação ('sem cebola', 'sem gelo', 'bem passado') num produto simples. O handleProductClick só abre o modal quando o produto tem grupos de combo; nos demais, soma 1 direto. O ComboModal já sabe funcionar como tela de produto simples, com observação e quantidade, mas a mesa nunca o abre nesse modo. A linha do carrinho também não tem campo nem botão de observação. O addToCart aceita notes, mas só o modal de combo passa esse valor.
- **Evidência:** MesasApp.tsx:1023-1027 (o modal só abre com groups.length > 0). MesasApp.tsx:1040-1047 (notes só vem por parâmetro). MesasApp.tsx:1540-1590 (a linha do carrinho só mostra c.notes, sem editar). ComboModal.tsx:94-96, 269 e 753 (modo 'PRODUTO SIMPLES' pronto e sem uso na mesa). O add-order envia notes em MesasApp.tsx:774.
- **Efeito no garçom:** O X-Burguer sem cebola chega na cozinha com cebola. O garçom tem que ir até a cozinha ou gritar a observação, ou escrever num papel. Isso anula o sistema justamente no pedido mais comum de salão.

### [alta] 'Lançar para' (dono do próximo toque) — ambos (L06)
- **O que acontece:** A pessoa escolhida em 'Lançar para' continua valendo entre um pedido e outro. Depois de 'Lançar itens para Marcos' no menu da pessoa, um '+ Novo Pedido' mais tarde já entra com Marcos marcado: nem o Novo Pedido nem o envio voltam para 'Mesa'. No celular de 390px só aparecem Mesa, Marcos e Júlia (cortada). Se a pessoa ativa é Duda ou Gui, o chip marcado fica fora da tela e não há scrollIntoView. Nenhum outro ponto da tela diz para quem vai o toque: o card, o badge, o modal de combo e o botão Enviar não mostram. O carrinho mostra '🍽️ Da mesa' em 11px cinza #94A3B8, e nem existe botão para mudar o dono de uma linha.
- **Evidência:** setPessoaAtiva(acaoPessoa.id) em MesasApp.tsx:2946. '+ Novo Pedido' em MesasApp.tsx:1844 não zera. addOrderToSession em MesasApp.tsx:778-781 não zera. Só zera em 652 (pessoa removida) e 662 (troca de sessão). Faixa com overflowX auto em MesasApp.tsx:1426-1429, e o grep por scrollIntoView não acha nada. Dono gravado em addToCart, MesasApp.tsx:1042. Rótulo do carrinho em MesasApp.tsx:1553-1558. Foto celular-3: chips visíveis só até 'Júlia R$ 48,0…'.
- **Efeito no garçom:** A porção para dividir vai para a conta do Marcos, e não para o rateio da mesa. Quem descobre é o cliente na hora de pagar, com a mesa discutindo a conta. O próprio sistema diz que 'item com tableGuestId é da pessoa', então o erro vira dinheiro cobrado da pessoa errada.

### [alta] Tela de lançar pedido / feedback — ambos (P01)
- **O que acontece:** O toast só existe na tela do mapa. A tela de lançar é outro return do componente e não desenha o toast. Por isso nada do que é avisado com showToast aparece enquanto o garçom está lançando: a confirmação "Coca-Cola: 2x no pedido" feita para ele não tocar de novo, o erro ao enviar ("Erro ao adicionar pedido", "Erro de conexão", mesa já fechada), a falha ao adicionar pessoa pelo "+ Pessoa" e o aviso de rota proibida do chamar(). Quando o envio falha, o botão sai de "Enviando..." e volta para "Enviar Pedido para Mesa" sem dizer nada.
- **Evidência:** MesasApp.tsx:3006-3016 ({toast && ...} só no return da grade, que começa em 1622). O return da tela de pedido (1297-1619) não tem {toast}. Chamadas que ficam sem aparecer: 1032 (toque no produto), 795 e 797 (erro ao enviar), 626 (+ Pessoa), 259 (chamar). grep 'toast' no arquivo: só 287, 3006, 3014.
- **Efeito no garçom:** Em horário de pico ele toca Enviar, a tela não muda e não aparece mensagem nenhuma. Ou fica tocando de novo, ou toca Voltar (que apaga o carrinho) achando que foi. A cozinha não recebe e ninguém fica sabendo.

### [alta] Envio do pedido / duplicidade — ambos (P02)
- **O que acontece:** O add-order não tem chave de idempotência. Se a rede cai depois de o servidor gravar (Wi-Fi fraco no fundo do salão), o cliente cai no catch, mantém o carrinho e libera o botão de novo. O segundo toque cria outro pedido, com outro número diário, e manda imprimir de novo na cozinha. Como o erro não aparece (P01), o segundo toque é praticamente certo.
- **Evidência:** MesasApp.tsx:763-777 (corpo sem id de requisição), 797 (catch só chama o toast, carrinho fica), 1604 (disabled só enquanto actionLoading). add-order/route.ts:131-165 cria customerOrder a cada POST e enfileira a impressão (~190). grep 'idempot' na rota: nada.
- **Efeito no garçom:** Pedido em dobro na cozinha e na conta da mesa. Ele só descobre no fechamento, na frente do cliente, e precisa cancelar o pedido pelo painel.

### [alta] Lançar para (dono do item) — ambos (P03)
- **O que acontece:** A pessoa escolhida em "Lançar para" continua escolhida depois de enviar, de tocar Voltar e de tocar "+ Novo Pedido". Só volta para Mesa quando se troca de sessão ou quando a pessoa é removida. O próximo pedido cai na conta da mesma pessoa. No celular a faixa de chips rola na horizontal e só mostra Mesa, Marcos e Júlia: se a pessoa ativa for Gui, o chip marcado fica fora da tela e nada rola até ele.
- **Evidência:** MesasApp.tsx:294. setPessoaAtiva(null) só em 652 (pessoa removida) e 662 (troca de sessão). Não é chamado em addOrderToSession (780-781), no Voltar (1330) nem no + Novo Pedido (1844). O atalho da pessoa fixa o dono em 2946. Faixa com overflowX auto em 1426-1429 e nenhum scrollIntoView no arquivo. Foto celular-3/4: 3 dos 8 chips visíveis.
- **Efeito no garçom:** A cerveja da mesa vai para a conta da Júlia (item com tableGuestId é da pessoa). No rateio a Júlia paga o que não consumiu e a discussão acontece na hora de pagar.

### [alta] Voltar da tela de pedido / conferir a mesa — ambos (P04)
- **O que acontece:** "← Voltar" esvazia o carrinho na hora, sem perguntar. A tela de lançar não mostra o que a mesa já pediu, então para conferir ("já lancei a Coca?") o garçom precisa sair. Sair apaga o que ele montou. O botão também fica no canto de cima à esquerda, longe do polegar, e é a ação destrutiva da tela.
- **Evidência:** MesasApp.tsx:1330 (setView('grid'); setCart([]) sem confirm). O return 1297-1619 não usa sessionDetail. Foto celular-3: Voltar em y≈32.
- **Efeito no garçom:** Com 7 itens no carrinho, voltar para conferir custa relançar os 7. Um toque errado no Voltar também joga fora o pedido inteiro.

### [alta] Botão/gesto voltar do celular — ambos (P05)
- **O que acontece:** O arquivo não tem pushState nem popstate. O voltar do Android ou o gesto de borda não fecha modal, não sai da tela de pedido e não fecha o painel: sai da página. No link do garçom, a entrada anterior do histórico é /garcom/<slug>, porque o login usa location.assign. Essa página vê o cookie e redireciona de volta para /mesas: recarrega tudo e cai no mapa sem mesa selecionada. Se ele abriu o link direto pelo WhatsApp, o voltar fecha a aba ou volta para o WhatsApp.
- **Evidência:** grep 'history|popstate|beforeunload' em MesasApp.tsx: nada. LoginDoGarcom.tsx:60 window.location.assign(.../mesas). garcom/[slug]/page.tsx:31-33 redirect para /mesas quando logado. Modais só fecham pelo fundo ou botão: 2415, 2101, 2927, combo 1259.
- **Efeito no garçom:** Usar o voltar do celular, que é o reflexo natural, apaga o carrinho, fecha a mesa aberta na tela e o fechamento de conta em andamento. Ele recomeça do mapa.

### [alta] Recarregar / puxar para atualizar / fim do turno — ambos (P06)
- **O que acontece:** Carrinho, view e mesa selecionada existem só no estado React: não vão para a URL nem para o storage. Recarregar perde tudo. O layout do garçom diz no comentário que evita o "puxar para atualizar", mas só bloqueia o zoom. O totem faz overscrollBehavior none e o garçom não. O mapa rola sem overscroll-behavior, então no Android puxar para baixo no topo recarrega a página. Além disso, o polling de 8 s continua na tela de pedido: se o caixa fechar (fim do turno), o chamar() redireciona para o login no meio do carrinho, sem aviso.
- **Evidência:** MesasApp.tsx:284-286 e 349 (useState). Nenhum localStorage ou sessionStorage (grep). garcom/layout.tsx:10-19 (comentário x código). totem/[slug]/layout.tsx:34-37 (overscrollBehavior 'none'). Grade de mesas 1688-1693 sem overscroll. Polling 672-675 ativo nas duas views, redirect em 262.
- **Efeito no garçom:** Um arrasto sem querer para baixo no mapa, uma queda de rede que força recarregar ou o gerente fechando o caixa apaga o pedido que ele estava montando. Ele não tem como recuperar.

### [alta] Dois garçons na mesma mesa — ambos (P07)
- **O que acontece:** O polling atualiza só a lista de mesas. selectedTable, sessionDetail e pessoas continuam como estavam quando a mesa foi tocada. O garçom A não vê pedido, pessoa ou pagamento lançado pelo B. Se B fecha ou transfere a mesa, A continua no painel e na tela de pedido. O envio volta 400 "Session is not open" e fica invisível (P01). "Liberar Mesa" aparece com o total antigo de R$ 0,00, e ao tocar o toast mostra o código interno "pagamento_incompleto". Com a mesa transferida, o cabeçalho de A continua dizendo Mesa 5 quando a conta já está na 8.
- **Evidência:** MesasApp.tsx:672-675 (setInterval só fetchTables). 390-407 (setTables, sem setSelectedTable). 1869 e 732 (Liberar usa selectedTable.openSession.totalAmount antigo). 752 (usa err.error, não mensagem). close/route.ts:86-87 (error 'pagamento_incompleto'). add-order/route.ts:43-45. transferir/route.ts:84-86 (mesma sessão, muda tableId).
- **Efeito no garçom:** Ele lança numa mesa que já fechou e o pedido some. Ou confere a comanda no painel e não vê o que o colega lançou, e acaba relançando o mesmo item.

### [alta] Painel da mesa no celular — celular (P08)
- **O que acontece:** O painel tem max-height 46vh, overflow visible e fica dentro de .mesa-conteudo com overflow hidden. Quando as seções fixas passam dos 388px, o excesso é cortado e não há como rolar até ele. Consumo, Taxa e Total ficam abaixo da tela (Total em y=916 numa tela de 844) e a lista de pedidos fica com 16px. Não existe gesto que leve até eles.
- **Evidência:** MesasApp.tsx:169-174 (max-height 46vh), 1796-1800 (painel sem overflow), 1686 (.mesa-conteudo overflow hidden), 1974 (lista flex:1 encolhe). Medida: 388px de painel, lista 16/551px, Total y=916. Foto celular-2.
- **Efeito no garçom:** O cliente pergunta quanto está a conta e o garçom não consegue ver no celular. Precisa abrir o Fechar Conta só para ler o total, ou pegar um tablet.

### [alta] Pessoas da mesa — ambos (P09)
- **O que acontece:** O ✕ ao lado do nome remove a pessoa num toque, sem confirmar e sem desfazer. Ele fica colado ao nome, que é justamente o alvo que abre as ações da pessoa, com padding 0 2px e cor #CBD5E1. "Tirar da mesa" no menu da pessoa também não confirma. Os itens dela voltam a ser da mesa e entram no rateio, e recadastrar a pessoa não devolve os itens.
- **Evidência:** MesasApp.tsx:1936-1939 (✕ sem confirm), 2984 (Tirar da mesa sem confirm), 640-655 (DELETE e toast só informativo 'voltaram para a conta da mesa'). Foto celular-2: ✕ a poucos px de 'Júlia R$ 48,00'.
- **Efeito no garçom:** Ao tocar no nome da Júlia para lançar, o dedo acerta o ✕. Os R$ 48 dela passam a ser divididos entre os outros 5, sem jeito de desfazer pela tela.

### [alta] Painel da mesa no celular: lista de pedidos e Total — celular (P01)
- **O que acontece:** No celular o painel fica com 46vh (388px) presos embaixo do mapa. Cabeçalho (~67px), 4 botões de ação (~105px) e PESSOAS (~188px) somam cerca de 360px antes da lista. A lista é o único filho com overflow e encolhe até sobrar 16px. O rodapé (Consumo/Taxa/Total) passa do painel e é cortado pelo overflow:hidden do container, então não dá para chegar nele nem rolando: o Total (y=916) fica abaixo da tela (844).
- **Evidência:** MesasApp.tsx:169-174 (.mesa-detalhe max-height 46vh), :1686 (.mesa-conteudo overflow hidden), :1796-1798 (painel flexShrink 0, sem overflow), :1974 (lista flex:1 overflowY auto, única que encolhe), :2143-2215 (rodapé). Foto celular-2: 'PEDIDOS DA MESA' cortado na borda de baixo (y≈833), sem nenhum item nem Total visível. Agravante: as fotos foram tiradas SEM pointer:coarse (o botão '2x ✎' mede 30px, que é o minHeight inline de :2040, e os chips medem 48px por causa do button{min-height:36px} global em globals.css:200). Num celular de verdade a regra :201 sobe todo botão do painel para 44px (o ✕ do chip vira 44px e o chip 56px; ações, Cancelar e Add também sobem), são uns 40-50px a mais, e a lista cai para 0px.
- **Efeito no garçom:** Na mesa, com o celular, o garçom não consegue conferir o que foi pedido nem falar o total ao cliente. Para ver o valor precisa abrir 'Fechar Conta' (e arriscar mexer no fechamento) ou tentar arrastar dentro de uma faixa de 16px. Foi exatamente essa a reclamação: 'muito pequeno'.

### [alta] Painel da mesa no tablet: pouco espaço para os pedidos — tablet (P02)
- **O que acontece:** Tablet retrato (820x1180): o painel vai para o rodapé com 46vh e a lista mostra 99px de 551px, pouco mais de um item. Tablet paisagem (1180x820): o painel tem só 300px de largura e a lista mostra ~170px. Com essa largura cada item quebra em 3-4 linhas ('Pizza Quatro Queijos / com Borda de / Catupiry — R$ 169,80 / 🍽️ mesa') e cabem 1,5 item. Enquanto isso o mapa ocupa 880px com uma faixa vazia embaixo.
- **Evidência:** MesasApp.tsx:147-151 (@media max-width 1180px: .mesa-detalhe width 300px), :169-174 (46vh no retrato), texto do item 12px #64748B em :2015-2066. Fotos tablet-retrato-2 (lista entre y≈950 e 1045) e tablet-paisagem-2 (painel x 880-1180, recorte com 2 itens quebrados em 3 linhas). Em pointer:coarse (:201) os botões sobem para 44px e o espaço fica ainda menor (estimo ~50px no retrato).
- **Efeito no garçom:** No aparelho principal do garçom, conferir uma mesa de 6 pessoas com 8 itens exige rolar uma janela de 1-2 itens, com a mão livre segurando o tablet. Vira erro de conferência e demora no pico.

### [alta] Taxa de serviço: total da tela diferente da comanda impressa e do fechamento — ambos (P03)
- **O que acontece:** O rodapé do painel calcula o Total com o estado serviceFee/useServiceFee, que começa na taxa padrão da loja. O botão 'Imprimir comanda' ignora esse estado e manda sempre taxaSugeridaDaMesa, que é a comissão do garçom ou a taxa padrão. Se o garçom desmarca a taxa no painel (o cliente não quer pagar), a tela mostra 'sem taxa' e a comanda sai COM taxa. Se o garçom tem commissionRate diferente da taxa da loja (0% de salário fixo, ou 8%), o painel mostra 10% e o papel sai com 0% ou 8%. Na primeira abertura do Fechar Conta, abrirFechamento troca serviceFee para a taxa sugerida, e o total muda de novo.
- **Evidência:** MesasApp.tsx:1856 imprimirConta(taxaSugeridaDaMesa(selectedTable)) sem olhar useServiceFee; :810-818 (taxa sugerida = comissão do garçom); :878-889 (abrirFechamento sobrescreve serviceFee); :2155-2211 (Total do painel com serviceFee); rota imprimir-conta/route.ts:82-84 usa body.taxa quando vem.
- **Efeito no garçom:** O garçom fala 'dá R$ 453,60' olhando a tela e entrega um papel de R$ 498,96, ou o contrário. Discussão com o cliente na hora de pagar, que é justamente a regra 'conta e fechamento precisam dar o mesmo total'.

### [alta] Chips de pessoa: ✕ colado remove a pessoa sem confirmação — ambos (P04)
- **O que acontece:** Cada chip tem o nome (a área que abre o menu da pessoa) e, a 6px dele, um ✕ de ~15px de largura (fontSize 13, padding 0 2px) na cor #CBD5E1 sobre #F8FAFC (contraste 1,42:1, quase invisível). Um toque no ✕ chama removerPessoa direto, sem confirm e sem desfazer, e os itens da pessoa passam a ser 'da mesa' e entram no rateio. O 'Tirar da mesa' do menu da pessoa também não confirma.
- **Evidência:** MesasApp.tsx:1936-1940 (✕ com onClick={() => removerPessoa(pes.id)}), :1927-1929 (nome clicável 12px ao lado), :640-656 (removerPessoa sem confirm; toast 'item(ns) voltaram para a conta da mesa'), :2980-2990 ('🚪 Tirar da mesa' sem confirm). Recorte da foto celular-2: ✕ claríssimo encostado em 'Marcos', 'Pedro', 'Rafa'.
- **Efeito no garçom:** Com uma mão, mirando no nome 'Júlia' para lançar para ela, o dedo pega o ✕: Júlia some e os R$ 48 dela viram rateio da mesa inteira, sem aviso claro. Na hora de rachar, a conta sai errada e ninguém entende por quê.

### [alta] Painel mostra pedidos e total de OUTRA mesa enquanto carrega — ambos (P05)
- **O que acontece:** Tocar numa mesa ocupada troca selectedTable e dispara o fetch, mas não limpa sessionDetail. Até a resposta chegar, o cabeçalho diz 'Mesa 3' e a lista e o Total mostram os pedidos da Mesa 5. As pessoas já foram limpas, então os itens aparecem como '👤 cliente'. fetchSessionDetail não confere se a resposta é da mesa atual: com 4G lento, tocar 3 e depois 5 pode fazer a resposta da 3 chegar por último e ficar na tela da 5. Na primeira abertura (sessionDetail nulo) aparece 'Nenhum pedido ainda / Toque em + Novo Pedido' enquanto carrega, e para sempre se a chamada falhar, porque o erro é silencioso.
- **Evidência:** MesasApp.tsx:1733-1734 (setSelectedTable + fetchSessionDetail sem limpar), :512-520 (sem checar o id e catch silencioso), :1202-1204 (sessionTotal soma sessionDetail sem conferir a sessão), :659-665 (pessoas limpas na troca, pedidos não), :2089-2095 (estado vazio mostrado durante o carregamento), :1830 (só o ✕ limpa sessionDetail).
- **Efeito no garçom:** No pico, com rede ruim, o garçom lê o total de uma mesa em outra, ou vê 'Nenhum pedido ainda' numa mesa que já pediu e lança tudo de novo (pedido duplicado para a cozinha).

### [media] Combos no carrinho — ambos (L07)
- **O que acontece:** A linha do carrinho não mostra as escolhas do combo (sabores, adicionais, bebida). Duas 'Pizza meio a meio' com sabores diferentes aparecem iguais, com o mesmo nome e o mesmo preço. Combo com quantidade 3 no modal vira 3 linhas separadas iguais, cada uma com seu −/nº/+. O card do produto também não ganha badge nem borda para combos, porque a contagem filtra !c.comboSelections.
- **Evidência:** Linha do carrinho em MesasApp.tsx:1546-1559 (nome, notes, preço e pessoa, sem comboSelections). comboSelections só é desenhado no painel da mesa, em MesasApp.tsx:2056 (parseComboSelections). Laço de qty em MesasApp.tsx:1270-1272. Badge com filtro em MesasApp.tsx:1468-1470.
- **Efeito no garçom:** O garçom não consegue conferir 'qual pizza é a de calabresa' antes de mandar. Para tirar a errada, adivinha qual '−' tocar. E depois de confirmar um combo o card não muda nada, então ele não tem certeza de que entrou.

### [media] Identidade das linhas do carrinho (uid) — ambos (L08)
- **O que acontece:** O uid é `${item.id}-${prev.length}-${dono}`, o que o faz repetir depois de uma remoção. Cenário: um combo C com quantidade 2 gera as linhas C-0-mesa e C-1-mesa. O garçom tira a primeira ('sabor errado') e sobra [C-1-mesa]. Ao lançar o combo de novo, prev.length=1 gera outra vez C-1-mesa: duas linhas com o mesmo uid. A partir daí o '+' soma nas duas, digitar a quantidade altera as duas e o '−' em 1 apaga as duas, porque tudo filtra ou mapeia por uid. O React também recebe key duplicada.
- **Evidência:** Geração do uid em MesasApp.tsx:1045. Linha nova por combo ou observação em 1046-1047. Remoção por uid em 1563. +/− e input por uid em 1564, 1577 e 1583. key={c.uid} em 1541.
- **Efeito no garçom:** O garçom toca '+' num combo e dois sobem. A cozinha recebe um combo a mais, e ele só percebe se reparar no Total. Ou tenta tirar um e somem os dois.

### [media] Busca — ambos (L09)
- **O que acontece:** A busca compara com toLowerCase().includes, sem tirar acento. No teclado do celular, acento exige toque longo. 'agua' não acha 'Água sem Gás 500ml', 'guarana' não acha 'Guaraná Antarctica Lata' e 'acai' não acha 'Açaí'. A busca também só olha o nome (não a categoria) e respeita a categoria selecionada: com 'Pizzas' marcada, buscar 'coca' dá tela branca. Quando nada é encontrado não aparece mensagem, e o campo não tem botão de limpar.
- **Evidência:** MesasApp.tsx:1183-1192 (filtro por nome e categoria juntos, sem normalize). MesasApp.tsx:1465 (filteredMenu.map sem estado vazio). Os produtos 'Água sem Gás 500ml' e 'Guaraná Antarctica Lata' aparecem nas fotos celular-3 e tablet-retrato-1.
- **Efeito no garçom:** Ele digita 'agua', não aparece nada e conclui que o produto não está no sistema. Vai rolar a grade de 224px procurando ou desiste de lançar.

### [media] Busca com autoFocus / teclado — celular (L10)
- **O que acontece:** O campo de busca tem autoFocus. A tela de pedido monta no mesmo toque do '+ Novo Pedido', dentro do gesto do usuário, então no celular o teclado tende a subir sozinho e cobrir a metade de baixo, onde estão o carrinho e o Enviar. Isso não foi medido em aparelho: é o comportamento esperado de focus() dentro do gesto. O campo tem outline:none e nenhum estilo de foco, então não se vê que está focado. O fontSize:14 inline ganha da regra .mesa-lancar input{font-size:16px} do CSS, porque estilo inline vence stylesheet sem !important. No painel /store/mesas (viewport maximumScale 5) o iOS dá zoom ao focar. No link do garçom o maximumScale 1 evita o zoom.
- **Evidência:** autoFocus em MesasApp.tsx:1352. Inline fontSize 14 e outline none em MesasApp.tsx:1353-1357. Regra do CSS em MesasApp.tsx:202, com o comentário em 205-206 dizendo que 16px evita o zoom. Viewport em src/app/layout.tsx:9-14 (maximumScale 5) contra src/app/garcom/layout.tsx:13-19 (maximumScale 1). Entrada da tela em MesasApp.tsx:1844.
- **Efeito no garçom:** Ele abre o pedido para tocar em 'Chopp' e antes precisa fechar o teclado, que come a tela. É um passo a mais em todo pedido. Na maioria dos lançamentos o garçom navega por categoria, não digita.

### [media] Tamanho e conteúdo do card de produto — ambos (L11)
- **O que acontece:** Card de 172x157 no celular. Produto sem foto ganha uma área de 75px (48% do card) com o emoji 🍔 para qualquer item que não seja combo, inclusive Coca-Cola e Água. O nome tem 0.8rem (12.8px). A categoria, em 0.7rem (11.2px) e cor #94A3B8 (contraste de uns 2.6:1 no branco), repete em todos os cards e ocupa uma linha inútil, já que a aba selecionada já diz a categoria. No tablet retrato (820px), o minmax(118px) gera 6 colunas de uns 122px: nomes quebram em 3-4 linhas ('Pizza Quatro Queijos com Borda de Catupiry') e as linhas da grade ficam com alturas diferentes. No paisagem (1180px, que ainda cai no @media max-width:1180) são 6 colunas de uns 131px.
- **Evidência:** Placeholder de 75px e emoji 🍔 em MesasApp.tsx:1482-1487. Nome 0.8rem em 1488. Categoria 0.7rem #94A3B8 em 1489. Preço 14px em 1490. Colunas em 142, 149 e 168. Foto celular-3: card de x 12→183, y 262→417. Foto tablet-retrato-1: 6 colunas, com preços cortados na borda de y≈786.
- **Efeito no garçom:** Metade de cada card é um hambúrguer genérico, e ele lê o nome em fonte de rodapé, andando e com luz ruim. Numa tela onde cabem 2 cards, desperdiçar metade de cada um é o que torna tudo 'pequeno'.

### [media] Feedback do toque no card — ambos (L12)
- **O que acontece:** Não há feedback de pressão: nenhum :active, escala ou vibração. O único sinal é o badge de 20x20px com número em 0.65rem (10.4px) no canto. O badge soma o produto de todas as pessoas, então com 'Marcos' ativo a Coca mostra '2' mesmo que as duas sejam da Mesa, e ignora combos. Cada toque soma 1 sem proteção contra toque duplo. O onMouseEnter deixa a borda rosa #FCA5A5 grudada depois do toque, e ela se confunde com a borda vermelha #C62828 de 'no carrinho'.
- **Evidência:** Card em MesasApp.tsx:1473-1476 (div com onClick, transition all 0.15s, onMouseEnter e onMouseLeave). Badge em 1477-1481. Soma de todas as linhas em 1468-1470. Fotos celular-3 (Guaraná com borda rosa e carrinho com 0 itens) e tablet-retrato-1/paisagem-1 (X-Burguer com borda rosa sem badge).
- **Efeito no garçom:** Sem o toast (L01), ele não sabe se o toque pegou, toca de novo e lança 2. O card rosa parece 'selecionado' sem estar no carrinho, e o badge contando itens de outra pessoa faz parecer que Marcos já pediu.

### [media] Tirar item / mudar dono — ambos (L13)
- **O que acontece:** O único jeito de tirar um item é o '−' do carrinho. Com a quantidade em 1, ele apaga a linha na hora, sem desfazer e sem confirmação. Um combo apagado assim obriga a refazer todas as escolhas. Não há '−' no card do cardápio. Não dá para mudar o dono de uma linha: lançou para a pessoa errada, tem que apagar e lançar de novo depois de trocar o chip. No celular, o carrinho mostra 3 linhas por vez em 209px.
- **Evidência:** Botão − em MesasApp.tsx:1562-1569 (qty<=1 faz filter, sem undo). Linha do carrinho em 1540-1590, sem controle de guestId. Foto celular-4: lista de y 523→732 com 3 de 4 linhas visíveis.
- **Efeito no garçom:** Para corrigir um item ele precisa rolar o carrinho espremido, acertar um botão de 38px de largura colado no campo de quantidade, e torcer para não apagar um combo montado.

### [media] Rolagens concorrentes — celular (L14)
- **O que acontece:** No celular a mesma tela tem 4 áreas de rolagem: a grade vertical (224px), a lista do carrinho vertical (uns 209px visíveis), as categorias horizontais e 'Lançar para' horizontal. A foto mostra duas barras de rolagem verticais uma embaixo da outra. O dedo que começa o gesto na fronteira rola a área errada.
- **Evidência:** Grade com overflowY auto em MesasApp.tsx:1464. Lista do carrinho com overflowY auto em 1533. Categorias com overflowX auto em 1359. Pessoas com overflowX auto em 1426-1429. Foto celular-4: duas scrollbars verticais (x≈382, y 255-465 e y 540-725).
- **Efeito no garçom:** Querendo descer o cardápio, ele rola o carrinho, ou o contrário. Com uma mão só, sobra pouca área neutra para segurar o aparelho sem disparar rolagem ou toque.

### [media] Estado que sobra entre pedidos — ambos (L16)
- **O que acontece:** Depois de enviar, a busca e a categoria não são limpas: só o Voltar limpa. Se o último pedido foi feito buscando 'coca', o próximo '+ Novo Pedido' abre o cardápio mostrando só Coca-Colas. Somado a L06 (pessoa ativa) e L04 (carrinho expandido), a tela de lançar herda três escolhas do pedido anterior.
- **Evidência:** addOrderToSession em MesasApp.tsx:778-781 faz só setCart([]) e setView('grid'). O Voltar em MesasApp.tsx:1330 faz setMenuSearch('') e setMenuCat('Todos').
- **Efeito no garçom:** Ele abre o pedido da mesa seguinte e 'o cardápio só tem 2 itens'. Perde tempo sem entender, ou acha que o sistema travou.

### [media] '+ Pessoa' na tela de lançar — celular (L17)
- **O que acontece:** O '+ Pessoa' cria uma pessoa genérica (quantidade 1, sem nome), não a seleciona e o chip novo vai para o fim da faixa horizontal, fora da tela no celular. O próximo toque continua indo para quem estava ativo. Se falhar, o aviso de erro também não aparece (L01).
- **Evidência:** Botão em MesasApp.tsx:1457-1461 (adicionarPessoas(1)). adicionarPessoas em MesasApp.tsx:617-627: POST { quantidade }, recarrega as pessoas, não chama setPessoaAtiva.
- **Efeito no garçom:** 'Chegou mais um, lança o chopp dele.' Ele toca '+ Pessoa', toca Chopp, e o chopp vai para a Mesa ou para a pessoa anterior.

### [media] ComboModal no celular (texto de cliente, não de garçom) — celular (L19)
- **O que acontece:** O modal é o mesmo do cardápio do cliente. Com foto, o topo gasta 220px de imagem antes do primeiro grupo. O botão diz 'Confirmar item' ou 'Adicionar à sacola' e não mostra para quem vai (pessoa ativa) nem a mesa. Na escolha única, tocar de novo na opção marcada desmarca. Não há avanço automático para o próximo grupo, e a observação fica no fim, depois de todos os grupos. A quantidade não tem teto.
- **Evidência:** Hero de 220px em ComboModal.tsx:788 e 315-329. Texto do botão em 752-754. Desmarcar ao tocar de novo em 178-186. Observação em 621-651, depois do map de grupos (365-619). Quantidade sem teto em 705-707. A mesa passa só product, onClose e onConfirm em MesasApp.tsx:1256-1275.
- **Efeito no garçom:** Numa pizza de 3 grupos ele rola bastante, e um toque duplo na borda desmarca o sabor. Confirma sem ver que o combo vai para 'Marcos' (L06) e depois não confere as escolhas no carrinho (L07).

### [media] Trocar de mesa no mapa — ambos (P10)
- **O que acontece:** Tocar outra mesa ocupada troca selectedTable, mas não limpa sessionDetail. Enquanto a busca não volta (4G lento), o painel mostra "Mesa 3" no título com os pedidos da Mesa 5. Se a busca falhar, o erro é engolido e os pedidos da mesa anterior ficam lá de vez.
- **Evidência:** MesasApp.tsx:1731-1734 (setSelectedTable + fetchSessionDetail, sem setSessionDetail(null)). 512-520 (catch silencioso).
- **Efeito no garçom:** Ele confere ou edita a comanda da mesa errada, ou diz ao cliente um consumo que é de outra mesa.

### [media] Estado que sobra de um pedido para o outro — ambos (P11)
- **O que acontece:** Depois de enviar, a busca e a categoria continuam aplicadas: só o Voltar limpa. O próximo "+ Novo Pedido" abre filtrado ("coca"), com poucos itens. O estado comandaAberta também nunca é zerado, e o cabeçalho inteiro do carrinho alterna entre 44vh e 86vh. O selo "Ver tudo/Recolher" fica sempre escondido, então um toque sem querer no cabeçalho deixa o carrinho em 86vh, a grade com cerca de 118px e nenhuma pista de como desfazer.
- **Evidência:** MesasApp.tsx:780-781 (sucesso não limpa menuSearch/menuCat) x 1330 (Voltar limpa). 367 (comandaAberta sem reset). 1509-1511 (botão do cabeçalho inteiro alterna). 166 (86vh). 179-183 declarado depois do @media 167 (display none vence; medido em 390px).
- **Efeito no garçom:** Ele acha que o cardápio sumiu ou que a tela travou, e perde segundos procurando como voltar ao normal.

### [media] Teclado ao entrar no pedido — celular (P12)
- **O que acontece:** A busca tem autoFocus. No Android, e no iOS quando o foco vem do toque, o teclado sobe assim que a tela de pedido abre e cobre cerca de 300px. No celular sobram só 224px de cardápio quando há item no carrinho.
- **Evidência:** MesasApp.tsx:1348-1352 (autoFocus). Medida: grade 224px e carrinho 371px em 390x844.
- **Efeito no garçom:** Ele precisa fechar o teclado antes de cada pedido: um toque a mais, e sem ver produto nenhum.

### [media] Orientação (celular deitado) — celular (P13)
- **O que acontece:** Com o celular deitado (844x390) vale o layout abaixo de 900px. Pelas medidas, cabeçalho, busca, categorias e "Lançar para" já ocupam 249px (844-371-224). O carrinho ocupa até 44vh=172px, mesmo vazio, porque o estado vazio tem cerca de 180px. Sobra 390-249-172 < 0: a grade de produtos fica com 0px. No mapa, o painel fica com 46vh=179px, que não cabe nem o cabeçalho e as ações.
- **Evidência:** MesasApp.tsx:153-163 (max-width 900, max-height 44vh) e 173 (46vh). 1535-1538 (estado vazio com padding 40 e ícone 40px). Cálculo sobre as medidas fornecidas.
- **Efeito no garçom:** Girar o celular sem querer, com a mão ocupada ou o celular apoiado na bandeja, faz o cardápio desaparecer.

### [media] Abrir mesa — ambos (P14)
- **O que acontece:** "Ocupar Mesa" só seleciona a mesa e mostra o painel. Lançar exige mais um toque em "+ Novo Pedido". Se outro garçom abriu a mesma mesa segundos antes, aparece em inglês "Table already has an open session", o modal continua aberto e o mapa não é recarregado (a mesa segue verde por até 8 s). Depois do sucesso, a tela faz dois GET /api/store/tables seguidos antes de mostrar o painel.
- **Evidência:** MesasApp.tsx:700-720 (seleciona, não chama setView('order'); 705 e 707 = dois GETs). 721-724 (erro sem fechar modal nem fetchTables). table-sessions/route.ts:133-135 (mensagem em inglês). Mesmo padrão de dois GETs em 782-784 e 1156-1157.
- **Efeito no garçom:** Toque extra em todo atendimento novo. Na corrida pela mesa, ele lê uma mensagem técnica em inglês e não sabe se pode lançar.

### [media] Teclado cobrindo campos / modais que não cabem — celular (P15)
- **O que acontece:** (a) O campo "Nome (ex: João)" fica no fim do painel (y≈788) e o teclado cobre esse trecho inteiro. O painel não rola e nenhum campo usa scrollIntoView. (b) O modal Ocupar Mesa é centralizado, sem maxHeight e sem rolagem, e o botão Ocupar fica abaixo do campo de nome, embaixo do teclado. (c) O Fechar Conta usa 92vh e não dvh: com a barra do navegador visível, o rodapé com "Fechar Conta e Liberar Mesa" pode ficar cortado. É o mesmo bug que o time já corrigiu na .mesa-tela e no ComboModal. (d) No modo loja (/store/mesas) há campos com 12-14px (nome, renomear, taxa) e o iOS dá zoom ao focar. No link do garçom o maximumScale=1 evita isso.
- **Evidência:** MesasApp.tsx:1951-1960 (input 12px no fim do painel). Foto celular-2 (input em y≈788). grep scrollIntoView: nada. 2227-2230 (modal sem maxHeight). 2418 (92vh). 131-134 (correção dvh só na .mesa-tela). ComboModal.tsx:783-786 (94dvh). 202 e 207 (16px só em .mesa-lancar e .mesa-modal-conta). 1923, 2172, 2262 (12, 13, 14px).
- **Efeito no garçom:** Ele digita o nome às cegas, precisa fechar o teclado para achar o botão de confirmar e, no fechamento, rola procurando o botão final.

### [media] Fechar conta / rachar — ambos (P16)
- **O que acontece:** "Conta por pessoa" vem aberta por padrão. Com 6 pessoas, estimo mais de 500px de lista antes do formulário de pagamento. "+ pagar" em cada pessoa só muda o estado do formulário lá embaixo, sem rolar e sem focar o valor. Parece que o toque não fez nada. "Receber o pagamento de X", no menu da pessoa, abre com o valor vazio, enquanto "+ pagar" preenche. Tocar nos 12px de fundo em volta fecha o modal.
- **Evidência:** MesasApp.tsx:308 (verContaPorPessoa=true). 2482-2489 (+ pagar só setState). 2592 em diante (formulário abaixo da lista). 2960-2964 com 891 (setValorPagamento('')). 2415 (clique no fundo fecha).
- **Efeito no garçom:** Com o cliente segurando o cartão, ele toca "+ pagar", não vê mudança, toca de novo e rola procurando. É o tipo de lentidão que gera erro de valor.

### [media] Toast sobre botões — ambos (P17)
- **O que acontece:** O toast fica fixo a 24px do fundo, com zIndex 2000 e sem pointer-events none. Durante 3 s ele cobre e engole o toque no que estiver embaixo. Isso inclui o "Fechar Conta e Liberar Mesa" (modal com z 1000) logo depois do "✅ R$ X registrado", e o rodapé do painel da mesa. Os timers não são cancelados: um toast mostrado 2,5 s depois de outro some em 0,5 s. Sem largura definida, com left 50% o texto quebra em uma coluna de cerca de 195px no celular.
- **Evidência:** MesasApp.tsx:3006-3013 (fixed bottom 24, z 2000, sem pointerEvents). 384-387 (setTimeout sem clearTimeout). 996 (toast ao registrar pagamento). 2728 (botão de fechar no rodapé do modal).
- **Efeito no garçom:** Ele toca Fechar Conta logo depois de registrar o pagamento e o toque não pega. Toca de novo quando o toast some.

### [media] Conexão — ambos (P18)
- **O que acontece:** Todas as buscas engolem o erro em silêncio e não há listener de online/offline nem indicador de "atualizado há X s". Sem rede, mapa, valores e comanda ficam congelados parecendo atuais.
- **Evidência:** MesasApp.tsx:404 (fetchTables), 519 (fetchSessionDetail), 600 (pessoas), 974 (pagamentos): catch silencioso. grep 'online|visibilitychange': nada.
- **Efeito no garçom:** No fundo do salão, sem Wi-Fi, ele lê o total errado para o cliente ou acha que uma mesa está livre.

### [media] Carrinho: dono da linha — ambos (P19)
- **O que acontece:** No carrinho, "👤 Júlia" ou "🍽️ Da mesa" é só texto. Não dá para trocar o dono de uma linha: é preciso remover e relançar com o chip certo. Se outro garçom remove a pessoa que está ativa neste aparelho, o servidor grava o item como da mesa sem avisar.
- **Evidência:** MesasApp.tsx:1553-1559 (só exibe). add-order/route.ts:120-129 e 160 (tableGuestId inválido vira null em silêncio).
- **Efeito no garçom:** Esquecer de tocar na pessoa antes do produto, o erro mais comum, custa remover e relançar item por item. Senão a conta rachada sai errada.

### [media] Zoom bloqueado — ambos (P20)
- **O que acontece:** O link do garçom desliga o zoom por pinça (maximumScale 1, userScalable false). O Android respeita. A queima é justamente que está tudo pequeno (itens da comanda em 12px #64748B), e o garçom não consegue nem ampliar com dois dedos.
- **Evidência:** garcom/layout.tsx:13-19. MesasApp.tsx:2021 (itens 12px #64748B).
- **Efeito no garçom:** Garçom com vista cansada, ou em ambiente escuro, não tem alternativa para ler a comanda.

### [media] Contagem de toques — ambos (P22)
- **O que acontece:** Do "cheguei na mesa livre" ao "pedido na cozinha" são no mínimo 4+N toques: card da mesa, Ocupar Mesa, + Novo Pedido, N produtos, Enviar. Some +1 se o autoFocus abrir o teclado e +1 por troca de pessoa. Com mesa já aberta, 3+N. Lançar pelo nome da pessoa custa 3 toques antes do cardápio (nome, "Lançar itens para", cardápio) contra 1 toque no chip. Cadastrar 6 nomes custa 6 x (tocar no campo + digitar + Add). "Quantas pessoas" (2p/3p/4p) só aparece no painel, e só enquanto a mesa não tem ninguém.
- **Evidência:** MesasApp.tsx:1731-1738 (card), 2308 (Ocupar), 711-719 (não abre pedido), 1844 (+ Novo Pedido), 1604 (Enviar), 1352 (autoFocus), 1927 e 2944 (caminho pela pessoa), 1886-1895 (2p/3p/4p só com zero pessoas), 1951-1968 (nome + Add).
- **Efeito no garçom:** Em pico, com a mão ocupada, cada atendimento novo custa pelo menos 2 toques que não precisavam existir.

### [media] Painel não se atualiza sozinho (polling só do mapa) — ambos (P06)
- **O que acontece:** O intervalo de 8s só chama fetchTables. sessionDetail, pessoas e selectedTable são fotos do momento do toque. Se outro garçom ou o caixa lança, edita ou fecha a Mesa 5, o card do mapa muda e o painel aberto continua velho. O rodapé 'N pedidos · Aberta há' e a condição de 'Liberar Mesa' usam selectedTable antigo: depois de cancelar todos os pedidos o botão não aparece, e freeTable recusa com 'mesa com consumo'. O editor de quantidade mostra 'Lançado: Nx' velho e grava quantidade ABSOLUTA, então apaga a alteração do colega.
- **Evidência:** MesasApp.tsx:672-675 (setInterval(fetchTables, 8000) apenas), :576-590 (cancelarPedidoMesa não atualiza selectedTable), :1869 (Liberar usa selectedTable.openSession.totalAmount), :730-735 (freeTable usa o valor velho), :2214 (orderCount velho), :537-545 (PATCH com quantity absoluta).
- **Efeito no garçom:** Dois garçons na mesma praça ou o caixa mexendo pelo painel: o garçom confere uma comanda que não é mais a real, corrige quantidade por cima da correção do colega, ou tenta lançar numa mesa que o caixa já fechou.

### [media] Total por pessoa nos chips fica desatualizado — ambos (P07)
- **O que acontece:** carregarPessoas (que traz o total de cada pessoa) só roda ao trocar de mesa, abrir mesa e adicionar, renomear ou remover pessoa. Depois de lançar, editar quantidade, remover item ou cancelar pedido, o chip continua com o valor antigo. O menu da pessoa diz 'ainda não pediu nada' logo depois de lançar para ela.
- **Evidência:** Chamadas de carregarPessoas só em MesasApp.tsx:625, 637, 653, 664, 717. Ausente em addOrderToSession (:759-800), editarQtdItem (:537-553), removerItemPedido (:555-574) e cancelarPedidoMesa (:576-590). Texto do menu em :2937-2940.
- **Efeito no garçom:** O garçom usa o valor do chip para responder 'quanto deu o meu?' e passa um valor errado, ou desconfia que o item não foi lançado e lança de novo.

### [media] Leitura de quem pediu o quê — ambos (P08)
- **O que acontece:** O dono do item vem como sufixo de 11px depois do nome do produto e do preço, e quebra junto com o texto. '🍽️ mesa' fica em #94A3B8 (2,45:1). Não há agrupamento por pessoa nem subtotal ao lado dos itens: para saber o que a Júlia pediu é preciso ler todos os pedidos. Os pedidos vêm em ordem crescente, então o último lançado fica no fim de uma lista de 16-170px. A hora de cada pedido tem 10px em #CBD5E1 (1,42:1), ilegível. Rótulos de seção em #94A3B8 sobre branco (2,56:1).
- **Evidência:** MesasApp.tsx:2046-2069 (nome, preço e dono na mesma linha 12px/11px), :2082-2083 (hora 10px #CBD5E1), :1976 e :1889 (rótulos #94A3B8). API table-sessions/route.ts:26 orderBy createdAt asc. Recorte tablet-paisagem-2: '🍽️ mesa' solto numa terceira linha abaixo do preço.
- **Efeito no garçom:** Na hora de conferir ou rachar ('esse chopp é de quem?'), o garçom não acha a informação de relance e precisa ler linha por linha, em fonte miúda e cinza.

### [media] Observação do item ('sem cebola') não aparece no painel — ambos (P09)
- **O que acontece:** A observação por item é gravada (OrderItem.notes) e a API de sessão devolve todos os campos do item, mas o tipo SessionOrder não tem notes e a linha do item não mostra. Só o carrinho mostra a observação antes de enviar.
- **Evidência:** prisma/schema.prisma:1028 (OrderItem.notes); MesasApp.tsx:42-59 (SessionOrder sem notes); :2015-2080 (render sem notes); :1547 (só o carrinho exibe c.notes); table-sessions/route.ts:20-26 (include items completo).
- **Efeito no garçom:** Ao conferir a mesa ou responder 'pedi sem cebola, né?', o garçom não tem como confirmar pela tela.

### [media] Alvos de toque na lista de pedidos — ambos (P10)
- **O que acontece:** 🗑️ sem padding (fontSize 13, padding 0 2px), com ~18px de largura, colado na borda direita. O botão de quantidade '2x ✎' tem minHeight 30 INLINE, que ganha da regra (pointer:coarse) de 44px porque estilo inline vence stylesheet: fica 30px até no tablet. 'Cancelar' (pedido inteiro) usa fonte 11px, padding 2px 8px, vermelho, grudado no valor do pedido. O ✕ de fechar o painel tem 32px de largura.
- **Evidência:** MesasApp.tsx:2076 (🗑️), :2040 (minHeight: 30 inline) x :201 (.mesa-detalhe button min-height 44px), :1998-2010 (Cancelar), :1832 (✕ 32x32). Recorte tablet-paisagem-2: botão '2x' ≈53x30px, 'Cancelar' ≈71x35px, 🗑️ ≈18px de largura.
- **Efeito no garçom:** Com uma mão, errar o 🗑️ ou o 'Cancelar' custa um confirm() nativo no meio do atendimento. Errar o '2x' abre o editor de quantidade quando a intenção era só rolar a lista.

### [media] Chip de pessoa não parece tocável e a área útil é só o texto — ambos (P11)
- **O que acontece:** O chip é uma div. Só o <span> do nome (12px, ~15px de altura) tem onClick. O padding do chip e o espaço entre nome e ✕ não fazem nada. A única dica de que tocar abre 'Lançar itens para X / Receber pagamento' é um title, que não existe no toque. Visualmente é uma tag com ✕, e ✕ lê como 'remover'.
- **Evidência:** MesasApp.tsx:1906-1912 (div do chip), :1927-1929 (span com onClick e title 'Tocar para lançar itens...'), :2923-3003 (menu útil, mas escondido).
- **Efeito no garçom:** O fluxo bom (lançar direto no nome da pessoa) fica escondido. Quem descobre erra o toque no meio do chip e acha que a tela travou.

### [media] Ordem das seções do painel — ambos (P12)
- **O que acontece:** A ordem é cabeçalho, 4 botões de ação em 2x2 (Imprimir e Mudar de mesa ocupam uma linha inteira), bloco PESSOAS com o campo 'Nome (ex: João)' + 'Add' SEMPRE visível, e só depois os pedidos. O Total fica no fim. O que o garçom precisa ao chegar na mesa (total, itens, '+ Pedido') fica atrás do que ele usa pouco (cadastrar pessoa, imprimir, mudar de mesa).
- **Evidência:** MesasApp.tsx:1839-1875 (ações), :1878-1966 (pessoas + input sempre visível em :1948-1966), :1974 (pedidos), :2143 (rodapé). Foto celular-2: de y=458 a y≈818 só cabeçalho, ações e pessoas.
- **Efeito no garçom:** O painel usa a tela inteira mostrando botões e um campo de texto, e esconde exatamente a conferência e o valor.

### [media] Taxa de serviço: um toque sem querer desliga a taxa e o estado vale para todas as mesas — ambos (P13)
- **O que acontece:** O <label> do rodapé envolve o checkbox de 16x16, o texto 'Taxa de serviço', o campo %, o '%' e o valor 'R$ 45,36'. Tocar no texto ou no valor liga e desliga a taxa (comportamento nativo do label). useServiceFee e serviceFee são estados únicos da tela, não por mesa: desmarcar na Mesa 5 deixa a Mesa 3 sem taxa no painel, some o '+10%' de todos os cards e muda o padrão do Fechar Conta. O garçom também edita o % direto no rodapé.
- **Evidência:** MesasApp.tsx:2155-2179 (label envolvendo tudo), :376-377 (estados globais), :1782 (card depende de useServiceFee), :884 e :2436 (fechamento usa o mesmo estado).
- **Efeito no garçom:** Rolando a lista com o dedão, ele encosta no valor da taxa e o total da mesa cai 10% sem perceber. A próxima mesa aberta herda isso.

### [media] Card de mesa com rótulo longo transborda o card — ambos (P14)
- **O que acontece:** O card mostra o rótulo NO LUGAR do número, com fonte 26px/900. 'Varanda 1' quebra em 2 linhas. Quando o mapa é mais alto que a área (tablet retrato com painel aberto, ou celular com 16 mesas), as linhas da grade ficam presas no min-height de 120px e o conteúdo desenha para fora da borda, por cima do gap de 12px até a mesa de baixo: na foto, 'R$ 81,90' e '1 ped. · 2min · +10%' ficam abaixo da borda do card. Além disso o card diz 'Varanda 1' e o toast e a transferência dizem 'Mesa 13'.
- **Evidência:** MesasApp.tsx:1755 (minHeight 120), :1760-1763 (26px, label || número), :1688-1692 (grade com flex:1/overflow auto = altura definida, e as linhas não crescem além da base). Recorte tablet-retrato-2 (x 330-500, y 350-530): valor e linha de info fora da borda rosa. Nomenclatura: :779 e :2771 usam selectedTable.number.
- **Efeito no garçom:** Card bagunçado e valor que parece pertencer à mesa de baixo. O garçom procura 'Mesa 13' que o toast citou e no mapa só existe 'Varanda 1'.

### [media] Mapa com 16+ mesas no celular — celular (P15)
- **O que acontece:** Em 390px: padding 20 + gap 12 + mínimo de 112px por coluna dão só 2 colunas de ~169x120px. 16 mesas são 8 linhas (~1100px). Sem painel cabem ~5 linhas (10 mesas) abaixo de um cabeçalho de 124px (os contadores quebram em 3 linhas). Com o painel aberto sobram ~334px, umas 2,5 linhas. Não há filtro (ocupadas, minhas, livres), agrupamento por ambiente, busca por número nem ordenação por status: a ordem é só por número.
- **Evidência:** MesasApp.tsx:1688-1692 (grid clamp(112px, 22vw, 145px), padding 20, gap 12), :1630-1684 (header), tables/route.ts:26 (orderBy number). Fotos celular-1 (2 colunas, cabeçalho até y≈124, 12 mesas visíveis) e celular-2 (mapa até y≈458).
- **Efeito no garçom:** Numa casa de 30-40 mesas, achar 'a 27' ou 'as minhas mesas' é rolar várias telas com o polegar, e repetir isso a cada pedido.

### [media] Informação do card: tempo, sem pedido, dono — ambos (P16)
- **O que acontece:** A linha de info tem 10px #9CA3AF sobre #FEF2F2 (2,32:1). O tempo é desde a ABERTURA, não desde o último pedido, e a API nem manda o horário do último pedido. Mesa aberta sem pedido (08) difere da mesa com consumo só pelo fundo laranja-claro: o mesmo 🔴 e nenhum texto 'sem pedido há X min'. Vermelho é a cor de 'ocupada', que é o estado normal, e não sobra cor para alerta. O card não mostra garçom, cliente nem pessoas. O '+10%' se repete em todos os cards.
- **Evidência:** MesasApp.tsx:1767 (🔴 para qualquer ocupada), :1745-1748 (só o fundo diferencia hasValue), :1777-1782 (linha 10px com '+10%'), tables/route.ts:41-50 (openSession sem lastOrderAt). Foto celular-1: Mesa 08 'R$ 0,00 · 0 ped. · 0min · +10%'.
- **Efeito no garçom:** O garçom não vê de relance a mesa esquecida (aberta há 30 min sem pedido) nem qual mesa é dele. O mapa não ajuda a priorizar no pico.

### [media] Botão/gesto voltar do Android com o painel aberto — celular (P17)
- **O que acontece:** Não existe pushState/popstate no arquivo. Com a mesa aberta, o 'voltar' do Android não fecha o painel: sai do módulo de mesas. O único jeito de fechar é o ✕ de 32px no canto superior direito do painel, longe do polegar.
- **Evidência:** grep por pushState|popstate|visibilityState em MesasApp.tsx = 0 ocorrências; ✕ em :1830-1834.
- **Efeito no garçom:** O gesto natural para 'voltar ao mapa' leva para fora da tela (ou de volta ao login), e ele precisa entrar de novo e achar a mesa.

### [baixa] Categorias — celular (L15)
- **O que acontece:** Os chips de categoria têm texto de 12px e seguem ordem alfabética ('Bebidas, Lanches, Pizzas, Porções, Sobremesas'), não a ordem do cardápio da loja. Em 390px a última aba ('Sobremesas') fica fora sem indicação: não há degradê nem seta, e a barra nativa não tem estilo. Em 'Todos' não há cabeçalho por categoria, a grade é uma lista corrida.
- **Evidência:** Chips com fontSize 12 e padding 5px 12px em MesasApp.tsx:1361-1366. Ordem com .sort() em 504-505 (reais = Array.from(new Set(...)).sort()). Estilo de scrollbar só para .mesa-quem-pede em 188-189. Foto celular-3: 'Porções' cortada e 'Sobremesas' invisível. Foto tablet-retrato-1: grade sem divisórias.
- **Efeito no garçom:** Ele não sabe que existe 'Sobremesas' sem arrastar as abas. Em 'Todos' não tem referência de onde acabam as bebidas e começam os lanches.

### [baixa] Campo de quantidade no carrinho — ambos (L18)
- **O que acontece:** Apagar o número faz o campo virar 1 imediatamente (Number('')||1). Quem apaga com backspace e digita 3 fica com '13'. Tocar no campo abre o teclado numérico, que no celular cobre o próprio carrinho do rodapé. O limite é 99 sem aviso.
- **Evidência:** MesasApp.tsx:1573-1582 (onChange com Math.max(1, ... Number(e.target.value) || 1), onFocus select).
- **Efeito no garçom:** Ele queria 3 chopps e lançou 13. Sem conferência por item antes do Enviar, isso vai para a cozinha e para a conta.

### [baixa] Aviso de itens ocultos no topo — celular (L20)
- **O que acontece:** O botão amarelo 'N itens do cardápio não aparecem aqui — toque para ver quais e por quê' e a lista expandida, que traz instruções de cadastro, aparecem também no modo garçom. Ficam no cabeçalho fixo, acima da grade. Aberta, a lista não tem max-height e empurra a grade até sumir no celular.
- **Evidência:** MesasApp.tsx:1375-1419 (sem condição ehGarcom e sem maxHeight na lista). Fica dentro do bloco fixo de busca, 1347-1420.
- **Efeito no garçom:** Ele perde mais uns 30px do cardápio com uma mensagem de gerente ('Conserto: ligar o interruptor do garçom no cadastro'), que não pode resolver. Se tocar sem querer, a grade some.

### [baixa] Carrinho no tablet — tablet (L21)
- **O que acontece:** No tablet retrato (820x1180), o carrinho no rodapé toma 388px (33%) com só 3 itens e a grade fica com 562px. No paisagem (1180x820), a coluna do carrinho cai para 290px, porque 1180 ainda casa com o @media max-width:1180. Os nomes quebram em 2 linhas ('Coca-Cola Lata / 350ml'), sobra uns 420px de branco entre a lista e o Total, e a grade usa 6 colunas estreitas.
- **Evidência:** MesasApp.tsx:147-151 (1fr 290px e minmax 116px até 1180px). MesasApp.tsx:155-163 (rodapé 44vh abaixo de 900px). Foto tablet-retrato-1: grade y 230→792, carrinho 792→1180. Foto tablet-paisagem-1: coluna do carrinho x 890→1180, lista acaba em y≈290 e Total em y≈733.
- **Efeito no garçom:** No tablet ele vê mais itens, mas pequenos. A fonte de 12.8px em cards de 122-131px não aproveita a tela grande que a loja comprou justamente para isso.

### [baixa] Custo de render por toque — celular (L22)
- **O que acontece:** A cada render, cada card filtra o carrinho inteiro e recalcula os grupos do combo e o preço mínimo (getEffectiveComboGroups, precoMinimoDoProduto, precoVariaPorEscolha), com JSON.parse do comboConfig quando precisa. O render acontece a cada toque e a cada refresh das mesas de 8s, que continua rodando com a tela de pedido aberta. Numa loja de 186 produtos (a Pastelaria da Paulista citada no código), são centenas de cálculos por toque. Não foi medido: é risco de atraso de toque em aparelho barato.
- **Evidência:** MesasApp.tsx:1465-1497 (cálculo dentro do map, sem useMemo por produto). MesasApp.tsx:104-116 (JSON.parse). setInterval de fetchTables a cada 8000ms em MesasApp.tsx:672-675. Comentário sobre os 186 itens em MesasApp.tsx:453-455.
- **Efeito no garçom:** Em celular de entrada, o toque pode demorar a marcar. Sem feedback visível (L01), isso gera toque duplo e item em dobro.

### [baixa] Depois de enviar — celular (P21)
- **O que acontece:** Depois do envio a tela volta para o mapa, com o painel em que a lista de pedidos mostra 16px: ele não vê o pedido que acabou de mandar. Os valores por pessoa (chips "Júlia R$ 48,00" no painel e em "Lançar para") não são recarregados, porque o efeito que carrega pessoas só dispara quando muda a sessão.
- **Evidência:** MesasApp.tsx:781 (setView('grid')). 789-790 (só fetchSessionDetail, sem carregarPessoas). 659-665 (dependência openSession.id, que não muda). Medida da lista: 16px.
- **Efeito no garçom:** Não tem confirmação visual do que foi para a cozinha, e os valores por pessoa na tela ficam errados até ele trocar de mesa.

### [baixa] Sair do acesso do garçom — ambos (P23)
- **O que acontece:** "Sair" apaga o cookie e volta ao login num toque, sem confirmar. Fica no topo, ao lado do nome.
- **Evidência:** MesasApp.tsx:1665-1668 e 1171-1176.
- **Efeito no garçom:** Um toque errado obriga a redigitar a senha no meio do atendimento.

### [baixa] Diálogos nativos — ambos (P24)
- **O que acontece:** Remover item, cancelar pedido, transferir mesa e os erros de edição usam confirm() e alert() do navegador. São caixas com texto pequeno, fora do visual da tela e sem botões grandes. Em navegador embutido de app (link aberto pelo WhatsApp ou Instagram) podem ser bloqueadas ou retornar falso.
- **Evidência:** MesasApp.tsx:547, 551, 560, 569, 572, 578, 585, 588, 2771.
- **Efeito no garçom:** Numa caixa pequena é fácil tocar OK sem ler "CANCELA o pedido inteiro".

### [baixa] Card de mesa com rótulo — tablet (P25)
- **O que acontece:** No tablet em retrato, o card "Varanda 1" ocupado quebra o rótulo em duas linhas com fonte 26px, e o valor "R$ 81,90 / 1 ped." aparece abaixo da borda do card.
- **Evidência:** Foto tablet-retrato-2 (y≈490-510 fora da borda). MesasApp.tsx:1759-1763 (fontSize 26 com label inteiro), 1755 (minHeight 120).
- **Efeito no garçom:** Fica difícil ler o valor da mesa e o card parece quebrado.

### [baixa] Campos do painel com fonte menor que 16px (zoom do iOS) — celular (P18)
- **O que acontece:** O campo 'Nome (ex: João)' tem 12px, o de renomear 12px e o % da taxa 13px. A regra de 16px em pointer:coarse cobre só .mesa-lancar e .mesa-modal-conta, não .mesa-detalhe. No iPhone, focar o campo dá zoom na página, e com o painel em 46vh o teclado cobre o resto.
- **Evidência:** MesasApp.tsx:1958 (12px), :1922-1923 (renomear 12px), :2171-2173 (taxa 13px); regras :202 e :207 não incluem .mesa-detalhe.
- **Efeito no garçom:** Cadastrar o nome de quem sentou vira zoom, rolar e desfazer zoom na frente do cliente.

### [baixa] Polling e 'Sair' — celular (P19)
- **O que acontece:** fetchTables roda a cada 8s mesmo com a aba em segundo plano e recebe todos os pedidos com todos os itens de todas as mesas abertas só para somar o total. O 'Sair' fica colado no nome do garçom no cabeçalho e desloga sem confirmar. No painel, o cabeçalho repete o nome do próprio garçom logado ('👤 João Pedro'), ocupando a linha de subtítulo que quebra no tablet paisagem.
- **Evidência:** MesasApp.tsx:672-675; tables/route.ts:15-23 (include orders.items); MesasApp.tsx:1665-1668 e :1171-1176 (sairDoGarcom sem confirm); :1812-1816 (waiterName no subtítulo). Foto tablet-paisagem-2: 'Aniversário / Marcos' quebrado.
- **Efeito no garçom:** Bateria e dados do celular do garçom gastos à toa ao longo do turno. Um toque errado no topo desloga no meio do serviço.

## Oportunidades apontadas

- Tela cheia em 2 etapas no celular (a ideia do Douglas): etapa 1 é o CARDÁPIO ocupando 100% da altura, sem carrinho no rodapé, só com uma barra fixa de uns 64px embaixo: '🛒 4 itens · R$ 36,50 · Ver pedido ›'. A grade passa de 224px para uns 530px (844 − 248 − 64). Etapa 2 é a CONFERÊNCIA em tela cheia (sheet ou página) com as linhas agrupadas por pessoa, as escolhas dos combos, a observação e o botão Enviar. As duas etapas entram no histórico com history.pushState, e um popstate volta para a anterior. Assim o voltar do Android fecha o carrinho, depois o cardápio, e só então sai. O padrão já existe em ComboModal.tsx:135-144.
- Voltar nunca apaga calado: com itens no carrinho, perguntar 'Descartar 4 itens da Mesa 5?' com as opções 'Guardar rascunho' e 'Descartar'. Salvar o carrinho em sessionStorage/localStorage com a chave do openSession.id, a cada mudança, e restaurar ao reabrir o pedido da mesma mesa. Recarregar ou bloquear o celular deixa de perder o pedido.
- Desenhar o toast também na tela de lançar (mover o bloco de MesasApp.tsx:3006-3016 para um fragmento renderizado nos dois returns, como já foi feito com modalDeCombo). Para erro de envio, não depender de toast: mostrar faixa vermelha fixa acima do botão 'Não foi enviado: toque para tentar de novo'. Mandar uma chave de idempotência por envio no add-order, para que o novo toque não duplique na cozinha.
- Modo LISTA para o garçom como padrão no celular (e automático quando a loja não tem fotos): linha de 56-64px com nome em 16px, preço à direita e um stepper '− 2 +' de 44px na própria linha. O garçom soma e tira sem abrir o carrinho, e o número fica grande. Botão para alternar lista/grade, lembrado em localStorage. Na grade, esconder o placeholder 🍔 quando não há imageUrl (o card cai de 157 para uns 80px) e tirar a linha de categoria repetida.
- Tablet: grade com minmax(170-190px) e nome em 15-16px, que dá 4 colunas no retrato e 5 no paisagem. Carrinho do paisagem com 340px mesmo em 1180px, e no retrato a mesma barra '4 itens · Ver pedido' do celular em vez do rodapé de 44vh.
- 'Lançando para' impossível de ignorar: faixa colorida fixa acima da grade com 'Lançando para: MARCOS' em letra grande, cada pessoa com uma cor que tinge o badge do card e a linha do carrinho. Voltar para 'Mesa' ao entrar por '+ Novo Pedido' e depois de enviar. scrollIntoView no chip ativo. '+ Pessoa' já seleciona a pessoa nova e pergunta o nome. No carrinho, tocar no dono da linha abre o seletor para mover o item de pessoa, sem apagar e relançar.
- Observação em qualquer item: toque longo no card (ou botão 📝 na linha do carrinho) abre o ComboModal no modo produto simples, que já existe (ComboModal.tsx:94-96, 753), ou um mini-sheet com chips rápidos configuráveis pela loja ('sem cebola', 'sem gelo', 'bem passado', 'sem sal', 'para viagem') mais texto livre. A linha com observação continua separada, como addToCart já faz em MesasApp.tsx:1046.
- Feedback físico no toque: :active com scale(0.97) e fundo lilás, navigator.vibrate(15) onde houver suporte, badge maior (28px, fonte 14px) com animação de pulso. Hover só dentro de @media (hover:hover), para acabar com a borda rosa grudada. Contar os combos no badge também.
- Busca de garçom: normalizar com normalize('NFD').replace(/[̀-ͯ]/g,'') nos dois lados, buscar também por categoria e código, buscar em TODAS as categorias quando há texto, botão ✕ para limpar e estado vazio 'Nada para "coca" em Pizzas. Ver em Todos?'. Tirar o autoFocus em pointer:coarse, ou trocar a caixa por um ícone 🔍 no cabeçalho roxo que abre a busca e economiza uns 52px de altura. Font-size 16px de verdade (tirar o inline 14).
- Categorias grudadas no topo ao rolar, com a ordem do cardápio da loja em vez da alfabética. Em 'Todos', cabeçalhos de seção ('Bebidas · 7') e toque na aba rolando até a seção. Degradê na borda direita indicando que tem mais abas. Aba 'Mais pedidos' primeiro (top da loja nos últimos 30 dias), porque Coca, Chopp e Água resolvem boa parte das idas à mesa.
- Carrinho para conferir de verdade: mostrar as escolhas do combo em cada linha (reusar parseComboSelections, como no painel em MesasApp.tsx:2056), agrupar por pessoa com subtotal, juntar combos idênticos (mesmas escolhas, dono e observação) numa linha com quantidade. Tirar item com undo ('Removido · Desfazer' por 5s) em vez de apagar direto.
- Correções pequenas e seguras: (1) mover a regra base .mesa-comanda-acao para antes do @media em ESTILO_TABLET, ou ganhar com .mesa-comanda .mesa-comanda-acao dentro do media, e zerar comandaAberta ao entrar ou enviar; (2) gerar o uid com crypto.randomUUID() ou um contador em useRef em vez de prev.length; (3) campo de quantidade aceitar vazio enquanto digita e só limitar a 1..99 no onBlur; (4) limpar busca e categoria depois de enviar; (5) esconder o aviso de itens ocultos quando ehGarcom, ou limitar a lista com max-height e rolagem.
- ComboModal com prop modoGarcom: sem a imagem de 220px, título 'Combo X para MARCOS · Mesa 5', botão 'Adicionar para Marcos', rolagem automática para o próximo grupo obrigatório depois de uma escolha única, sem desmarcar ao tocar de novo na opção marcada, chips rápidos de observação no topo e teto de quantidade (ex.: 20) com aviso.
- Atalhos de salão: 'Repetir rodada' (relança os itens de bebida do último pedido da mesa ou da pessoa, abrindo no carrinho para conferir antes de enviar) e toque longo no '+' ou no card abrindo um teclado de quantidade 1-10 para '6 chopps' sem 6 toques.
- Performance do cardápio: calcular uma vez, com useMemo por menuItems, um mapa id → {preçoTexto, grupos} e outro mapa id → qtdNoCarrinho por cart, em vez de recalcular dentro do map de cada card. Pausar o setInterval de 8s de fetchTables enquanto view === 'order'.
- Navegação em níveis com histórico real: Mapa > Mesa (tela cheia) > Lançar > (Combo/Fechar conta). Cada nível entra com history.pushState({nivel}) e um listener de popstate fecha o nível de cima. Assim o voltar e o gesto do celular fecham o modal, saem do lançamento para a mesa e da mesa para o mapa, sem sair do módulo. É o pedido do Douglas ("abrir tela cheia e poder voltar") feito do jeito que o Android espera.
- Mesa em tela cheia no celular e no tablet em retrato: tocar a mesa abre uma tela própria, sem o mapa atrás, com três abas grandes (Pedidos | Pessoas | Conta) e uma barra fixa embaixo com Consumo/Taxa/Total sempre visíveis e dois botões na zona do polegar: "+ Lançar" e "Fechar conta". Resolve o P08 (Total inalcançável) e a lista de pedidos de 16px. No tablet em paisagem, alargar o painel lateral para cerca de 45% quando houver mesa selecionada.
- Guardar o estado na URL (?mesa=<id>&tela=lancar, com router.replace) e o carrinho em localStorage por sessionId+garcomId. Ao reabrir: faixa "Você tem 4 itens não enviados na Mesa 5 — Continuar / Descartar". Apagar só no envio com sucesso. Recarregar, puxar para atualizar, cair a rede ou ser deslogado pelo fim do turno deixa de apagar o pedido.
- Voltar com carrinho cheio pergunta "Descartar 4 itens?", com a opção "Guardar e ver a mesa". Melhor ainda: manter um carrinho por mesa (Map sessionId → itens), para ir e voltar entre a mesa e o lançamento sem perder nada.
- Dentro da tela de lançar, uma faixa recolhível "Já na mesa: 3 pedidos · R$ 453,60" que abre a lista do sessionDetail em modo leitura. O garçom confere o que já saiu sem sair do lançamento.
- Feedback sempre visível: tirar o toast do return da grade (como já foi feito com modalDeCombo) para aparecer nas duas telas. Toast no topo no celular, com pointer-events none e clearTimeout do anterior. Erro de envio vira faixa vermelha fixa no carrinho com "Tentar de novo", nunca toast.
- Idempotência no add-order: o cliente gera um uuid quando o carrinho nasce e manda como clientRequestId. O servidor grava numa coluna única e, ao repetir, devolve o pedido já criado. O reenvio depois de erro de rede nunca duplica na cozinha.
- Dono do item à prova de erro: "+ Novo Pedido" e o envio voltam "Lançar para" para Mesa. O chip ativo rola até ficar visível (scrollIntoView). O botão diz o que vai acontecer: "Enviar 4 itens (2 da Júlia, 2 da mesa)". Tocar no rótulo "👤 Júlia / 🍽️ Da mesa" de uma linha do carrinho abre um seletor para trocar o dono.
- Carrinho como barra recolhida no celular: por padrão só uma barra fixa embaixo "🛒 4 itens · R$ 36,50 · Enviar" (cerca de 64px) e a grade de produtos com o resto da tela. Tocar na barra sobe um bottom sheet em 90dvh, que o voltar do celular fecha. Resolve os 224px de cardápio, o celular deitado (P13) e o selo "Ver tudo" que nunca aparece.
- Menos toques para abrir: no modal Ocupar Mesa, chips "Quantas pessoas? 1 2 3 4 5 6+" e o botão principal "Ocupar e lançar pedido", que já cai na tela de lançar. Uma mesa nova passa de 4+N para 2+N toques. Tirar o autoFocus da busca quando pointer: coarse.
- No fechamento, quando o pedido é para pagar: a linha da pessoa vira o próprio botão, abrindo um bottom sheet "Receber da Júlia — R$ 52,80" com o valor preenchido, as formas de pagamento como botões grandes (Dinheiro/Pix/Débito/Crédito) e Registrar. "Conta por pessoa" começa recolhida no celular. Modal com 92dvh.
- Pessoas: confirmação ou "Desfazer" por 5 s ao remover (o servidor pode religar os itens a partir da lista devolvida). Tirar o ✕ de dentro do chip e deixar a remoção só no menu da pessoa. Novas pessoas nascem com nome editável direto no chip, sem o campo no rodapé que o teclado cobre.
- Sincronização entre garçons: com mesa selecionada, o polling de 8 s também recarrega sessionDetail, pessoas e pagamentos (e ao voltar o foco, via visibilitychange). Se a sessão fechou ou mudou de mesa, mostrar faixa "A Mesa 5 foi fechada/transferida para a 8 por Maria" e levar o garçom para o lugar certo. Traduzir e tratar "Table already has an open session": selecionar a mesa já aberta e oferecer lançar nela.
- Mapa para o garçom: filtro "Minhas mesas" ligado por padrão no modo garçom (waiterId === garcom.id), nome do cliente e número de pessoas no card, número grande com rótulo pequeno embaixo ("05 · Varanda"), e um campo "Ir para mesa nº" com teclado numérico para casas com 40+ mesas.
- Indicador de conexão no cabeçalho (bolinha verde/vermelha + "atualizado há 12 s"), usando navigator.onLine e o horário do último fetchTables bem-sucedido.
- Garçom layout: adicionar overscroll-behavior: none em html/body, como o totem, para matar o puxar para atualizar. Liberar o zoom por pinça ou oferecer um botão "A+ texto grande" salvo em localStorage, que aumenta os tokens de fonte da tela (itens da comanda de 12px para 15-16px).
- Tablet do garçom: pedir navigator.wakeLock.request('screen') enquanto a tela de mesas estiver aberta (a tela não apaga entre uma mesa e outra) e navigator.vibrate(10) ao tocar produto, como confirmação física no Android.
- Trocar confirm()/alert() nativos por bottom sheets próprios com botões de 48px e texto grande, principalmente em "Cancelar pedido inteiro" e "Transferir".
- TELA CHEIA DA MESA no celular e no tablet retrato (pedido do Douglas): tocar numa mesa ocupada abre uma view 'mesa' (position fixed inset 0, como a view 'order' de :1297) em vez da meia-tela de 46vh, com history.pushState({tela:'mesa'}) e listener de popstate. O voltar do Android fecha a mesa e volta ao mapa, e o voltar dentro de 'Novo pedido' volta para a mesa (pilha mapa > mesa > lançar). Layout de uma mão: faixa superior fixa de ~64px com 'Mesa 5', tempo e TOTAL grande (24px+); lista rolando ocupando todo o meio; barra inferior fixa de 64px com '+ Pedido' (verde, 2/3 da largura) e 'Conta'. Imprimir, Mudar de mesa e Liberar vão para um menu '⋯'.
- Tablet paisagem: painel com 40% da largura (mínimo 400px) em vez de 300px (:147-151), ou a mesma tela cheia da mesa. O mapa de 16 mesas cabe em 3-4 colunas e sobra espaço para os itens não quebrarem em 3 linhas.
- Lista em duas visões com um seletor no topo: 'Por pessoa' (Júlia R$ 48,00 com os itens dela embaixo; 'Da mesa · dividido' em bloco próprio) e 'Por pedido' (atual, com o mais recente PRIMEIRO e destaque 'enviado há 2 min'). Fonte 15-16px para o nome do produto, 14px para o preço, dono como etiqueta colorida no início da linha, observação do item ('sem cebola') em linha própria, hora relativa legível em vez de 10px #CBD5E1.
- Tocar na LINHA INTEIRA do item (alvo de 56px) abre uma folha de baixo com botões grandes: Quantidade (o editor que já existe em :2098-2140), 'Passar para outra pessoa', 'Remover item', 'Cancelar pedido #4'. Tira da lista o 🗑️ de 18px, o '2x ✎' de 30px e o 'Cancelar' de 11px, e mantém a regra de só gravar ao confirmar.
- Taxa só-leitura no painel ('Taxa 10% · R$ 45,36', sem label clicável). Editar taxa fica só no Fechar Conta. Guardar a taxa por sessão (Map sessionId -> {usa, pct}) em vez de estado global, e fazer 'Imprimir comanda' mandar a MESMA taxa que a tela mostra (useServiceFee ? serviceFee : 0), iniciando serviceFee com taxaSugeridaDaMesa já ao selecionar a mesa. Assim tela, papel e fechamento dão o mesmo número.
- Pessoas como barra horizontal de chips inteiros-botão (min 44px, sem ✕) no topo da tela da mesa, que funcionam também como filtro ('Todos | Marcos | Júlia R$48 | Mesa'). Tocar abre a folha que já existe (:2923-3003). 'Tirar da mesa' com confirmação dizendo 'os 2 itens da Júlia (R$ 48,00) vão para o rateio da mesa'. O campo 'Nome' só aparece depois de tocar em '+ pessoa'.
- Dados sempre frescos: no mesmo intervalo de 8s, quando há mesa aberta, recarregar também sessionDetail e pessoas (ou um endpoint único 'mesa completa'). Limpar sessionDetail ao trocar de mesa e descartar resposta cujo id != mesa atual. Mostrar 'Carregando pedidos…' em vez de 'Nenhum pedido ainda', e erro visível com 'Tentar de novo'. Chamar carregarPessoas depois de lançar, editar, remover ou cancelar. Sincronizar selectedTable com tables a cada polling. Pausar o polling com document.hidden.
- Depois de 'Enviar' (addOrderToSession :759) voltar para a TELA DA MESA com o pedido novo no topo e destacado por alguns segundos, e toast 'Pedido #7 enviado · 3 itens · R$ 58,00'. O garçom confirma com o cliente sem procurar.
- Mapa no celular com 3 colunas: minmax(96px,1fr), padding 12, gap 8, card de ~100px com número 28px, valor 14px e tempo 12px com contraste AA. Rótulo em 1 linha com ellipsis e fonte menor quando passa de 4 caracteres, ou número grande + rótulo pequeno embaixo. Cabeçalho de 1 linha (~56px), sem 'R$ em consumo' no modo garçom e com 'Sair' dentro de um menu com confirmação.
- Filtros no topo do mapa: 'Todas · Ocupadas · Minhas · Livres' (o modo garçom já tem garcom.id e a sessão tem waiterId). Grupos por ambiente quando o rótulo tiver prefixo ('Varanda', 'Salão'). Campo 'Ir para mesa nº' com teclado numérico para casas com 30+ mesas.
- Card com status em texto e cor de alerta de verdade: livre (verde), ocupada (neutro/azul com valor), 'sem pedido há 25 min' (âmbar) e 'conta pedida' ou 'aguardando pagamento' (vermelho). Para isso a rota /api/store/tables precisa mandar lastOrderAt e a quantidade de pessoas. Tirar o '+10%' repetido de cada card e mostrar o garçom da mesa (iniciais) no modo loja.
- Atalho de uma mão no mapa: segurar o card de uma mesa ocupada vai direto para 'Novo pedido' daquela mesa, e o toque simples abre a tela da mesa. Menos passos no fluxo mais repetido do turno.
- Inputs do painel com 16px em pointer:coarse (incluir .mesa-detalhe na regra :202) e redimensionar as áreas com dvh em vez de vh (:173) para o teclado e a barra do navegador não cobrirem o conteúdo.

## Pesquisa: como os apps de garçom resolvem

### Cabeçalho que encolhe e botões de envio presos no rodapé
- **Quem usa:** Toast Go 2/3 (handheld)
- **Como funciona:** No handheld, o cabeçalho do pedido (mesa, garçom, pessoas) encolhe sozinho assim que o primeiro item entra. Os botões Hold / Stay / Send ficam presos no rodapé. Imprimir e Pagar ficam sempre visíveis, e o cardápio abre e fecha para dar lugar ao pedido. Ações que o garçom usa pouco (taxa de serviço, dividir, desconto, transferir, cancelar item, reimprimir) vão para um menu de três pontinhos.
- **Por que ajuda:** O cardápio ganha quase a tela inteira enquanto ele lança os itens, e o botão de enviar fica sempre no mesmo lugar, perto do polegar. O que é raro não ocupa espaço na tela pequena.
- **Fonte:** https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens

### Tela de pedido sem barra de navegação e barra inferior no celular
- **Quem usa:** Lightspeed Restaurant K-Series (nova navegação)
- **Como funciona:** No iPhone, a barra de navegação (Mesas, Pedidos, Clientes, Recibos, Mais) fica embaixo, para usar com uma mão. No iPad ela fica em cima e mais fina. Quando a tela de pedido (Register) abre, a barra some para dar espaço ao pedido, e o garçom volta tocando Fechar no canto superior esquerdo. O botão '+' no canto superior direito abre um pedido novo direto do mapa de mesas.
- **Por que ajuda:** No celular, o polegar alcança a navegação. Na hora de lançar o pedido, a tela cheia fica só para o cardápio e a comanda.
- **Fonte:** https://k-series-support.lightspeedhq.com/hc/en-us/articles/43162671781659-About-the-new-POS-navigation

### Cardápio por categoria com troca rápida ou lista única rolável
- **Quem usa:** Lightspeed L-Series (iPhone), Toast (menu → grupo → itens), Saipos Garçom (botão + ao lado de cada produto)
- **Como funciona:** No Lightspeed para iPhone há dois modos. No modo por categoria, ele mostra os produtos da primeira categoria e um deslize para a direita abre a lista de categorias. No modo 'todos os produtos', tudo aparece numa lista única que se rola para cima e para baixo. O resumo do pedido abre com um deslize para a esquerda ou pelo botão 'View Order'. Na Saipos, cada produto da lista tem um botão + ao lado, sem abrir outra tela.
- **Por que ajuda:** A lista única rolável com o nome da categoria preso no topo evita trocar de tela a cada item. O + na própria linha lança um item simples com um toque só.
- **Fonte:** https://resto-support.lightspeedhq.com/hc/en-us/articles/229679927-Basic-ordering-on-an-iPhone-iPod | https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens | https://meajuda.saipos.com/hc/pt-br/articles/20211650734484-Como-lan%C3%A7ar-vendas-de-sal%C3%A3o-pelo-Saipos-Gar%C3%A7om

### Cabeçalho de categoria grudado: pequeno, opaco e parcialmente persistente
- **Quem usa:** Diretriz da NN/g para cabeçalho grudado no celular (os manuais dos POS não detalham esse ponto; é a regra de usabilidade aplicável)
- **Como funciona:** O cabeçalho grudado deve ser baixo, ter cor opaca diferente do fundo e alvos de toque de pelo menos 1 cm × 1 cm. A NN/g recomenda a versão parcialmente persistente: o cabeçalho some quando a pessoa rola para baixo e volta quando rola para cima, com animação de 300 a 400 ms. Aplicado ao cardápio: uma faixa horizontal de categorias (chips) que acompanha a rolagem e destaca a categoria visível.
- **Por que ajuda:** O garçom sempre sabe em que parte do cardápio está e pula para 'Bebidas' com um toque, sem perder muita altura de tela.
- **Fonte:** https://www.nngroup.com/articles/sticky-headers/

### Busca no topo do cardápio com itens recentes logo abaixo
- **Quem usa:** Toast POS e Toast Go
- **Como funciona:** No Toast Go, uma lupa fica no topo da área do cardápio. A busca procura pelo nome do item, pelo nome no POS e pelo SKU (se ativado), e o resultado mostra onde fica o botão do item. Itens em falta aparecem em cinza. Logo abaixo da barra de busca aparecem os itens selecionados recentemente, para repetir rápido.
- **Por que ajuda:** Com cardápio grande, digitar 'coca' é mais rápido que navegar. Os recentes funcionam como favoritos automáticos, e o item em falta já aparece marcado antes de ser oferecido ao cliente.
- **Fonte:** https://support.toasttab.com/en/article/Menu-Item-Search

### Lançamento por código (PLU / código do produto)
- **Quem usa:** Lightspeed L-Series (iPhone: código do produto ou PLU), Lightspeed K-Series (teclado numérico com quantidade + item), Link Garçom (busca por descrição, código ou grupo)
- **Como funciona:** O garçom digita o código numérico do produto (ou a quantidade seguida do item no teclado numérico) e o item entra direto na comanda. No K-Series, o teclado numérico abaixo do resumo do pedido serve para quantidade e número da mesa.
- **Por que ajuda:** Garçom experiente decora os códigos dos mais pedidos ('12' = chope). Com teclado numérico grande, lança sem rolar nada, com uma mão.
- **Fonte:** https://resto-support.lightspeedhq.com/hc/en-us/articles/229679927-Basic-ordering-on-an-iPhone-iPod | https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328394-Understanding-the-Register-screen | https://apps.apple.com/br/app/link-gar%C3%A7om/id1626904261

### Página de favoritos / grade de atalhos editável
- **Quem usa:** Square for Restaurants (Checkout > Favorites), Garfo APP (favoritos + busca)
- **Como funciona:** Na Square, a grade de itens fica em Checkout > Favorites. Um toque longo num quadrado vazio ou o + adiciona item, grupo ou função. A grade permite arrastar os quadrados, criar páginas com nome e ajustar o tamanho automaticamente, e o layout é editado no próprio app ('Edit POS layout').
- **Por que ajuda:** Os 10 a 20 itens que saem mais ficam sempre na primeira tela e no mesmo lugar, e o gesto vira memória muscular.
- **Fonte:** https://squareup.com/help/us/en/article/8334-set-up-item-grid | https://garfo.app/

### Escolher o assento (pessoa) antes do item, com seção 'Compartilhado'
- **Quem usa:** Toast (Order by Seat), TouchBistro (barras coloridas por assento), Lightspeed K-Series (Add a seat), Square (Sort cart > By Seat)
- **Como funciona:** Toast: o garçom escolhe o assento e tudo o que adiciona entra sob o cabeçalho daquele assento. Ele troca de assento tocando no cabeçalho ou em 'Prev. seat' / 'Next seat'. Com assento obrigatório, a comanda já nasce com cabeçalhos numerados conforme o número de pessoas, e o cabeçalho 'Share' fica no topo para itens da mesa. TouchBistro: toca a barra colorida do próximo assento e lança; para itens divididos, usa a barra 'Shared Order For Table'. Lightspeed: + acima do cardápio, escolhe o número do assento e toca o item.
- **Por que ajuda:** Escolher o assento uma vez e lançar vários itens é mais rápido que perguntar 'de quem é?' a cada item. Depois, a divisão da conta por pessoa e a entrega do prato certo saem prontas.
- **Fonte:** https://support.toasttab.com/en/article/Order-by-Seat | https://cdn.touchbistro.com/help/articles/taking-orders/ | https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089273-Adding-orders-in-Table-Service-mode | https://squareup.com/help/us/en/article/8583-manage-seats-in-your-restaurant

### Mover item de assento e ajustar pessoas depois
- **Quem usa:** Square for Restaurants, Toast, Saipos Garçom (várias comandas por mesa e número de pessoas)
- **Como funciona:** Na Square, o garçom seleciona itens e usa 'Move to Seat', ou 'Move All Items to Seat' para mover um assento inteiro. Assentos são adicionados com 'Add a seat' e removidos deslizando para a esquerda. No Toast, o garçom seleciona o item e escolhe outro assento. Na Saipos, na revisão ele ajusta a quantidade de pessoas e pode prender várias comandas na mesma mesa.
- **Por que ajuda:** Erro de assento se corrige sem apagar e relançar, e mesa que cresce no meio do atendimento não trava o fluxo.
- **Fonte:** https://squareup.com/help/us/en/article/8583-manage-seats-in-your-restaurant | https://support.toasttab.com/en/article/Order-by-Seat | https://meajuda.saipos.com/hc/pt-br/articles/20211650328596-Conhecendo-o-aplicativo-Saipos-Gar%C3%A7om

### Modificadores obrigatórios abrem sozinhos; observação livre no item
- **Quem usa:** Toast (modifier groups required + POS prompt, special request), Saipos Garçom (opcionais + observação + Confirmar), Consumer (perguntas personalizadas na Comanda Mobile)
- **Como funciona:** Toast: grupos obrigatórios aparecem primeiro e não deixam seguir sem escolha. Depois vêm os opcionais marcados com 'POS prompt', que exigem escolher ou tocar Done, e por último os opcionais comuns. O 'special request' é um texto livre que a cozinha vê. Saipos: ao tocar +, se o produto tem opcionais eles aparecem nessa etapa, com campo de observação e botão 'Confirmar'. Consumer: perguntas obrigatórias do tipo Observação ('ponto da carne'), Complemento (com limite de quantidade) e Produto ('Deseja um refrigerante?') abrem sozinhas durante o pedido, também na Comanda Mobile.
- **Por que ajuda:** Impede enviar hambúrguer sem ponto ou pizza sem sabor, porque o sistema pergunta na hora certa. A venda guiada lembra o adicional e aumenta o ticket.
- **Fonte:** https://doc.toasttab.com/doc/platformguide/adminSettingsAndConditionsThatAffectModifierGroupDisplay.html | https://meajuda.saipos.com/hc/pt-br/articles/20211650734484-Como-lan%C3%A7ar-vendas-de-sal%C3%A3o-pelo-Saipos-Gar%C3%A7om | https://ajuda.programaconsumer.com.br/como-criar-perguntas-personalizadas-na-hora-de-realizar-pedidos/

### Carrinho vivo como faixa-resumo que abre por cima (bottom sheet)
- **Quem usa:** Square (live cart panel no mobile), Consumer Garçom (resumo 'Mesa 04 Pedido: 3 itens · R$ 87,00'), Lightspeed L-Series iPhone ('View Order'); comportamento da folha segundo Apple HIG e NN/g
- **Como funciona:** A Square mostra um painel de carrinho que se atualiza em tempo real enquanto o item é configurado, com ações em lote sem sair do item. O Consumer mostra uma faixa com mesa, quantidade de itens e total. A faixa abre como folha de baixo para cima. Pela Apple HIG, a folha tem alturas de repouso: 'medium' (cerca de metade) e 'large' (tela cheia), e se expande ao arrastar a alça ou rolar o conteúdo. Pela NN/g, a folha deve ter um X visível além da alça, fechar com o Voltar e não substituir fluxos de página inteira. Folha minimizada não bloqueia o fundo; expandida, vira modal.
- **Por que ajuda:** O garçom vê a contagem e o total sem sair do cardápio, confere a comanda com meio arrasto e volta a lançar sem perder a posição da rolagem.
- **Fonte:** https://squareup.com/help/us/en/article/8152-take-orders-tableside-with-square-for-restaurants-mobile-pos | https://consumer.com.br/aplicativo-para-garcom | https://developer.apple.com/design/human-interface-guidelines/sheets | https://www.nngroup.com/articles/bottom-sheet/

### Enviar / Enviar e continuar / Segurar (Send, Stay, Hold)
- **Quem usa:** Toast POS e Toast Go
- **Como funciona:** 'Send' dispara os itens destacados para cozinha ou bar e sai da comanda. 'Stay' dispara e mantém o garçom na tela do pedido para lançar mais. 'Hold' deixa os itens na comanda sem disparar. São três botões explícitos no rodapé, sem diálogo 'tem certeza?'.
- **Por que ajuda:** As bebidas saem já com 'Stay' enquanto o garçom continua anotando os pratos. A escolha do destino acontece no próprio botão e não custa um toque extra de confirmação.
- **Fonte:** https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens

### Revisão antes do envio, com confirmação só quando há risco real
- **Quem usa:** Saipos Garçom (tela de revisão → 'Enviar para cozinha' → opção de impressão), Lightspeed L-Series (popup de Cursos ao imprimir); diretriz NN/g
- **Como funciona:** Na Saipos, o passo 9 é a revisão dos itens, com identificação do cliente e ajuste de pessoas, e termina em 'Enviar para cozinha'. No Lightspeed L-Series, com cursos configurados, aparece um popup de cursos ao mandar para a cozinha. A NN/g recomenda confirmar apenas ações graves ou irreversíveis. O texto deve dizer o que vai acontecer, com botões nomeados pela ação ('Enviar 3 itens para a cozinha' / 'Continuar editando'), e o desfazer é preferível ao diálogo. Diálogo em toda ação vira hábito e ninguém lê.
- **Por que ajuda:** A revisão fica dentro da própria folha do carrinho, sem um 'OK?' a cada envio. A confirmação fica para casos como cancelar item já enviado ou sair com itens não enviados.
- **Fonte:** https://meajuda.saipos.com/hc/pt-br/articles/20211650734484-Como-lan%C3%A7ar-vendas-de-sal%C3%A3o-pelo-Saipos-Gar%C3%A7om | https://resto-support.lightspeedhq.com/hc/en-us/articles/229679927-Basic-ordering-on-an-iPhone-iPod | https://www.nngroup.com/articles/confirmation-dialog/

### Cursos: segurar e disparar o próximo tempo do handheld
- **Quem usa:** Square for Restaurants (ícone de fogo por curso), Lightspeed K-Series (Fire course), Clover Dining (Enable coursing)
- **Como funciona:** Na Square, o garçom toca o ícone de fogo ao lado dos cursos que quer mandar e depois Send. No Lightspeed, os itens caem no primeiro curso por padrão, 'Add a course' cria outros e 'Fire course' imprime na cozinha o aviso de que a mesa está pronta para o próximo tempo. No Clover, os cursos são disparados em sequência para dar ritmo à refeição.
- **Por que ajuda:** O pedido da mesa inteira é lançado uma vez só, e o prato principal é liberado da mesa, sem voltar ao caixa.
- **Fonte:** https://squareup.com/help/us/en/article/8152-take-orders-tableside-with-square-for-restaurants-mobile-pos | https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089273-Adding-orders-in-Table-Service-mode | https://www.clover.com/help/take-clover-dining-orders-and-payments

### Repetir item / repetir rodada
- **Quem usa:** Square for Restaurants (deslizar para a direita num item enviado; 'Repeat a round of drinks in a few taps'), Toast (opção 'repeat' ao selecionar o item)
- **Como funciona:** Na Square, deslizar para a direita um item já enviado adiciona mais um igual à comanda. Para rodadas de bebida, a própria Square indica 'Edit Items' e anuncia repetir a rodada em poucos toques. No Toast, ao selecionar um item da comanda aparecem quantidade, repetir, excluir, curso e pedido especial. A Apple HIG pede que todo gesto tenha alternativa em botão visível ('Offer alternatives to gestures').
- **Por que ajuda:** 'Mais uma rodada' vira um ou dois toques, com os mesmos modificadores e assentos, sem relançar cada chope.
- **Fonte:** https://community.squareup.com/t5/Questions-How-To/Square-for-Restaurants-Repeat-order-glitch/m-p/84060 | https://squareup.com/ca/en/point-of-sale/restaurants/bars | https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens | https://developer.apple.com/design/human-interface-guidelines/accessibility

### Status da cozinha de volta no aparelho do garçom
- **Quem usa:** Toast (notificação 'Fulfilled tickets' ao aparelho que lançou), Anota AI / iFood Salão (tag na mesa quando a cozinha finaliza), Consumer (acompanhamento do preparo)
- **Como funciona:** No Toast, quando a cozinha marca o ticket como pronto no KDS, o aparelho que fez o pedido recebe um alerta visual e sonoro (Front of house > POS notifications > 'Fulfilled tickets (alerts person who placed the order)'). No App Garçom da Anota AI, o pedido é acompanhado em tempo real, e quando a cozinha termina aparece uma tag na mesa ou comanda.
- **Por que ajuda:** O garçom só vai ao passe quando o prato está pronto e sabe, pela lista de mesas, qual mesa tem prato esperando.
- **Fonte:** https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380 | https://anota.ai/ajuda/app-garcom/ | https://consumer.com.br/comanda-mobile

### Mesas em lista compacta com status, tempo e valor (além do mapa)
- **Quem usa:** Toast (painel Table Details), Square (cores por tempo), Goomer Gestor de Mesas (status + busca por número), Consumer Garçom (ocupada / livre / chamando)
- **Como funciona:** Toast: o painel lista todas as mesas ativas com número de pessoas, garçom, itens e subtotal. No mapa, cada mesa mostra pessoas, tempo desde a abertura, total e iniciais do garçom num selo com a cor dele. Com zoom afastado, só o essencial aparece, em letra maior. Square: amarelo depois de X minutos e vermelho depois de Y ('Turn Yellow After' / 'Turn Red After'). Goomer: status Disponível / Em consumo / Pagamento parcial, busca digitando o número da mesa e atualização automática em segundos. Consumer: status de ocupada, pronta para liberar ou chamando.
- **Por que ajuda:** No celular, o mapa desenhado não cabe. A lista ordenada, com número grande, cor de status, tempo e total, mostra em um olhar qual mesa está esquecida, e a busca pelo número abre a mesa direto.
- **Fonte:** https://support.toasttab.com/en/article/New-POS-Managing-Tables | https://squareup.com/help/us/en/article/8146-customize-table-management-settings | https://ajuda.goomer.com.br/goomergo/painel/pedidos/gestor-de-mesas | https://consumer.com.br/aplicativo-para-garcom

### Retrato no celular, paisagem ou retrato no tablet
- **Quem usa:** Toast (handheld não gira para paisagem no layout de mesas), Lightspeed (suporte de iPad em retrato ou paisagem; navegação no topo do iPad e embaixo do iPhone)
- **Como funciona:** O FAQ do Toast diz que handhelds não giram para paisagem para ver o layout de mesas: o celular é tratado como retrato fixo. O Lightspeed tem suportes de iPad para as duas orientações, e a tela de pedido do iPad usa três áreas: resumo do pedido à esquerda, teclado numérico abaixo e cardápio à direita.
- **Por que ajuda:** No celular, uma coluna só com carrinho em folha. No tablet em paisagem, comanda fixa ao lado do cardápio, sem folha. Quem segura com uma mão não sofre com a rotação acidental.
- **Fonte:** https://support.toasttab.com/en/article/New-POS-FAQ | https://k-series-support.lightspeedhq.com/hc/en-us/articles/24657218555803-Setting-up-Lightspeed-iPad-Stands | https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328394-Understanding-the-Register-screen

### Fluxo curto: mesa → cardápio → revisar/enviar
- **Quem usa:** Consumer Garçom ('Três telas, três passos'), Saipos Garçom, Square (mesa → número de pessoas → itens)
- **Como funciona:** O Consumer resume o app em três telas: escolher a mesa, lançar do cardápio digital e fechar a conta. Na Saipos: módulo Mesas → toca a mesa (ou 'Ver comandas sem mesa') → confirma abertura → + nos produtos → opcionais/observação → revisar → 'Enviar para cozinha' → escolher impressão. Tocar de novo na mesa aberta permite adicionar comandas ou mais pratos. Na Square, ao abrir a mesa o garçom informa o número de pessoas antes dos itens.
- **Por que ajuda:** Poucos níveis de navegação, e o botão Voltar tem um significado previsível em cada nível.
- **Fonte:** https://consumer.com.br/aplicativo-para-garcom | https://meajuda.saipos.com/hc/pt-br/articles/20211650734484-Como-lan%C3%A7ar-vendas-de-sal%C3%A3o-pelo-Saipos-Gar%C3%A7om | https://squareup.com/help/us/en/article/8152-take-orders-tableside-with-square-for-restaurants-mobile-pos

### Continuar lançando com rede ruim
- **Quem usa:** Consumer (roteador local sem internet externa), Toast Go 3 (Wi-Fi + celular com troca automática); a Saipos exige conexão estável
- **Como funciona:** O Consumer opera 'via roteador local sem depender de internet externa'. O Toast Go 3 alterna sozinho entre Wi-Fi e rede celular para lançar, cobrar e imprimir. A Saipos avisa que o app precisa de 'uma boa e estável conexão com a internet'.
- **Por que ajuda:** Salão grande e área externa têm pontos cegos de Wi-Fi. Quem guarda o rascunho no aparelho e reenvia depois não perde o pedido anotado.
- **Fonte:** https://consumer.com.br/comanda-mobile | https://pos.toasttab.com/news/toast-go-3-handheld-pos-global-launch | https://meajuda.saipos.com/hc/pt-br/articles/20211650328596-Conhecendo-o-aplicativo-Saipos-Gar%C3%A7om

### Diretrizes de toque e leitura

- Apple HIG (Acessibilidade): tamanho de controle padrão no iOS/iPadOS de 44x44 pt e mínimo de 28x28 pt. O espaçamento importa tanto quanto o tamanho: cerca de 12 pt de respiro em volta de elementos com borda e cerca de 24 pt em volta de elementos sem borda. Fonte: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple HIG (Tipografia): no iOS/iPadOS o texto padrão é 17 pt e o mínimo é 11 pt. Fonte: https://developer.apple.com/design/human-interface-guidelines/typography
- Android/Material: alvos de toque de pelo menos 48x48 dp (cerca de 9 mm físicos), separados por 8 dp ou mais. O ícone pode ser 24 dp desde que a área tocável chegue a 48 dp. Fonte: https://support.google.com/accessibility/android/answer/7101858?hl=en
- WCAG 2.2: o critério 2.5.8 (nível AA) exige alvo de pelo menos 24x24 px CSS, ou espaçamento equivalente. O 2.5.5 (AAA) pede 44x44 px CSS e é o recomendado para controles importantes. Fonte: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Pegada (Hoober, 2013, 1.333 observações): 49% seguram o celular com uma mão, 36% apoiam numa mão e tocam com a outra, 15% usam dois polegares. Fontes: https://alistapart.com/article/how-we-hold-our-gadgets/ e https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/
- Hoober (2017): 75% tocam só com um polegar, mas a pegada muda o tempo todo. A pessoa prefere ler e tocar no centro da tela: ali o alvo pode ter cerca de 7 mm, e nos cantos precisa de cerca de 12 mm. Conteúdo principal no centro, ações secundárias nas bordas de cima e de baixo. Na prática: botão de rodapé fixo com largura total e mais alto (56 px ou mais), nada pequeno nos cantos superiores. Fonte: https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php
- Cabeçalho grudado (NN/g): alvos de toque de pelo menos 1 cm × 1 cm, fundo opaco com contraste em relação ao conteúdo, altura mínima. O ideal é parcialmente persistente (reaparece ao rolar para cima), com animação de 300 a 400 ms. Fonte: https://www.nngroup.com/articles/sticky-headers/
- Campos de texto no iPhone: com fonte menor que 16 px, o Safari do iOS dá zoom ao focar e desalinha a tela. Busca, observação e quantidade devem usar 16 px ou mais. Não bloqueie o zoom com maximum-scale=1, que fere a acessibilidade. Fontes: https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/ e https://defensivecss.dev/tip/input-zoom-safari/
- Escala de tipos do Material 3: Body Large 16 (linha de 24), Body Medium 14, Label Large 14, Label Medium 12, Label Small 11. Para leitura rápida num salão com pouca luz: nome do item e preço entre 16 e 17 px, rótulos secundários com pelo menos 12 px, número da mesa grande. Fonte: https://material-web.dev/theming/typography/
- Contraste mínimo de texto (WCAG 1.4.3): 4,5:1 para texto normal e 3:1 para texto grande. Status de mesa não pode depender só de cor (amarelo/vermelho): acrescente o tempo em minutos ou um rótulo. Fonte: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Gestos (Apple HIG): use o gesto mais simples possível para ações frequentes e sempre ofereça um botão visível equivalente. Exemplo: 'deslizar para repetir' precisa de um botão 'Repetir' ao lado. Fonte: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Folhas (Apple HIG): alturas 'medium' (cerca de metade) e 'large' (tela cheia), alça de arraste, Cancelar à esquerda e Concluir à direita. Não abra uma folha por cima de outra: feche a primeira antes. Fonte: https://developer.apple.com/design/human-interface-guidelines/sheets
- Bottom sheet (NN/g): botão X visível no topo além da alça, o Voltar do aparelho fecha a folha, e a folha não substitui navegação entre páginas. Fonte: https://www.nngroup.com/articles/bottom-sheet/
- Confirmações (NN/g): só para ações graves ou irreversíveis (cancelar item já enviado, sair com itens não enviados). O texto deve ser específico e os botões nomeados pela ação. Prefira desfazer a perguntar sempre, porque diálogo repetido vira clique automático. Fonte: https://www.nngroup.com/articles/confirmation-dialog/

### Voltar do celular em web app

RESUMO: cada camada que se abre por cima (folha do carrinho, modal do item/modificadores, busca expandida, confirmação) ganha uma entrada no histórico sem URL nova. O Voltar fecha só a camada do topo. Trocas reais de tela (lista de mesas → mesa 12) usam navegação do Next. O rascunho do pedido (itens, assento, observação) fica fora dos componentes que desmontam e é gravado no aparelho; assim, nenhum Voltar, recarga ou fechamento do app apaga o que foi digitado.

1) Padrão pushState/popstate (base que funciona em Chrome, Safari e Firefox)
- Ao abrir a camada, e dentro do handler do toque, chame window.history.pushState({ camada: 'carrinho' }, ''). O popstate dispara apenas com Voltar/Avançar ou history.back(), nunca no próprio pushState: https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event
- No popstate, feche a camada do topo. Se ela for fechada pelo X ou pelo arraste, consuma a entrada extra com history.back() e marque que o fechamento não veio do Voltar, para não fechar duas vezes. O projeto já usa exatamente isso em src/components/customer/CustomerStorePage.tsx (sacola/checkout, perto da linha 987) e src/components/customer/ComboModal.tsx (perto da linha 134), incluindo a lição registrada ali: o efeito depende só de 'aberto'. A etapa atual fica num ref, porque etapa nas dependências fazia o cleanup chamar back() e o 'Continuar' não saía do lugar.
- Com camadas empilhadas (modal do item por cima da folha do carrinho), NÃO deixe cada componente com seu próprio listener de popstate. Um único Voltar dispara todos os listeners e fecharia as duas. Use uma pilha única (hook/contexto 'useVoltarPilha': push ao abrir, um só listener que fecha o topo). Siga também a regra da Apple HIG de não abrir folha sobre folha: https://developer.apple.com/design/human-interface-guidelines/sheets
- Só faça pushState depois de um gesto do usuário. A intervenção do Chromium pula no Voltar as entradas criadas sem ativação do usuário, e o popstate nem dispara (anti 'back trapping'). Por isso não empurre entradas falsas ao carregar a lista de mesas: https://chromium.googlesource.com/chromium/src/+/main/docs/history_manipulation_intervention.md
- A NN/g recomenda explicitamente que o Voltar feche a bottom sheet: https://www.nngroup.com/articles/bottom-sheet/

2) Next.js App Router (o projeto usa next 16.2.6)
- A doc local (node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md, seção 'Native History API') confirma que window.history.pushState/replaceState se integram ao router e sincronizam usePathname/useSearchParams. Existe desde a 14.1: https://nextjs.org/blog/next-14-1
- Detalhe do código-fonte (node_modules/next/dist/client/components/app-router.js, linhas 252-300): o Next substitui history.pushState para copiar seu estado interno (__NA) na nova entrada. No popstate, se event.state existir mas não tiver __NA, o Next faz window.location.reload(), e tudo o que não foi salvo se perde. Consequências: (a) chame pushState só no cliente depois da hidratação (handler ou useEffect), nunca guardando uma referência ao pushState original de antes do router montar; (b) não use replaceState com um objeto 'limpo' sobre uma entrada do Next; (c) com state null o Next ignora o popstate.
- Se a etapa precisar sobreviver a uma recarga, derive-a da URL (?painel=carrinho) em vez de estado local. A doc local 02-guides/preserving-ui-state.md mostra o diálogo lido de searchParams, aberto com router.push('?edit=true') e fechado com router.replace('?', { scroll: false }). window.history.pushState com '?painel=carrinho' atualiza a URL sem refazer server components.
- cacheComponents: true (Next 16) mantém até 3 rotas escondidas com <Activity>, preservando inputs e rolagem ao voltar (02-guides/preserving-ui-state.md e 03-api-reference/05-config/01-next-config-js/cacheComponents.md). É uma mudança global e o next.config.ts atual não a ativa. Não dependa disso para o rascunho: rotas mais antigas são descartadas.
- A Navigation API (evento navigate + intercept) virou Baseline em jan/2026 (Chrome, Firefox 147, Safari 26.2): https://web.dev/blog/baseline-navigation-api. Mas o router do Next 16.2.6 ainda usa History API (há um TODO no próprio app-router.js). Misturar as duas numa app Next pode conflitar, então fique no pushState.

3) Não perder o que foi digitado
- Guarde o rascunho da comanda por mesa num store acima das telas (layout ou contexto) e persista a cada mudança em localStorage/IndexedDB (chave loja+mesa+garçom). Grave também em visibilitychange === 'hidden', que é o último momento confiável no celular. unload não é confiável e impede o bfcache. beforeunload só deve existir enquanto houver itens não enviados, removido logo depois: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Trate pageshow com event.persisted para reidratar quando a página volta do bfcache: https://web.dev/articles/bfcache
- beforeunload não dispara em navegação cliente do Next. Para 'sair da mesa com 3 itens não enviados', intercepte no popstate da tela da mesa: devolva a entrada com pushState e mostre uma confirmação específica ('Sair sem enviar 3 itens?' com 'Continuar pedido' / 'Guardar rascunho'). Na lista de mesas, mostre um selo 'rascunho: 3 itens' no card: https://www.nngroup.com/articles/confirmation-dialog/
- Campos de busca e observação com 16 px ou mais, para o zoom do iOS não desalinhar a folha ao focar.

4) CloseWatcher (melhoria progressiva)
- new CloseWatcher() recebe o 'pedido de fechar' do aparelho (Esc no desktop, Voltar no Android) com eventos cancel → close. É o jeito nativo de fazer um componente customizado se comportar como <dialog>. Hoje só existe no Chromium, então use-o apenas se existir e mantenha o pushState como base para iOS e Firefox: https://developer.mozilla.org/en-US/docs/Web/API/CloseWatcher e https://github.com/WICG/close-watcher

5) PWA instalado (display: standalone)
- iOS: não há botão Voltar na interface. Resta o gesto de deslizar da borda, que funciona dentro do escopo e em rotas cliente. Toda tela e toda folha precisam de saída visível ('‹ Mesas' no cabeçalho, X na folha): https://meta.discourse.org/t/back-button-in-ios-pwa/93909 e https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Create_a_standalone_app
- Android: com o histórico vazio, o Voltar fecha o app. Na tela raiz (lista de mesas), não tente prender o usuário. O efeito colateral útil é que o rascunho já está gravado, então reabrir o app restaura a comanda. Um contador de profundidade em history.state indica se ainda há para onde voltar dentro do app: https://github.com/pwa-builder/PWABuilder/issues/754

Observação: a ferramenta Perplexity respondeu 401 (chave inválida), então a pesquisa usou WebSearch/WebFetch e as APIs públicas das centrais de ajuda (Apple HIG JSON, Zendesk da Saipos). Clover (help center em JS) e TouchBistro (erro de SSL/redirect) foram confirmados por resultados de busca e não pela leitura integral da página.
