# Plano recomendado — mesa no celular e no tablet

Gerado por um workflow de agentes em 13/09/2026: diagnóstico de 3 leitores + pesquisa de apps de garçom → 3 juízes → síntese → crítico que conferiu o plano contra o código. As 4 propostas independentes caíram por falta de internet; a síntese partiu do diagnóstico e dos juízes. **É proposta, não decisão**: as perguntas para o Douglas estão no fim.

## O que o cliente sente

- No celular, ao tocar numa mesa, o painel ocupa só a metade de baixo da tela (388px). Botões e pessoas gastam quase tudo, e a lista de pedidos fica com 16px visíveis para 551px de conteúdo. O garçom não vê nenhum item.
- No celular, o Total da mesa fica abaixo do fim da tela (posição 916 numa tela de 844) e não aparece nem rolando. O garçom não consegue dizer ao cliente quanto deu.
- No tablet em pé, a lista de pedidos mostra 99px de 551px, pouco mais de 1 item. No tablet deitado, o painel tem 300px de largura: cada item quebra em 3 ou 4 linhas e cabem 1,5 item.
- Na tela de lançar pedido do celular, com 1 item no carrinho o cardápio encolhe para 224px (cerca de 26% da tela) e cabem 2 produtos inteiros. É o 'tá muito pequeno' do cliente. Com o celular deitado, pela conta, o cardápio some.
- Metade de cada card de produto (75px de 157px) é um desenho de hambúrguer genérico, até na Coca-Cola. O nome tem 12,8px e a categoria 11px em cinza claro.
- Os itens da mesa estão em 12px cinza e a hora de cada pedido em 10px quase branco. O link do garçom bloqueia o zoom com os dedos, então não tem como ampliar.
- O 'Voltar' da tela de pedido apaga o carrinho sem perguntar. O gesto de voltar do celular sai do módulo. Recarregar ou puxar a tela para baixo também perde tudo.
- Quando o envio do pedido falha, nenhuma mensagem aparece, porque o aviso só é desenhado na tela do mapa. O garçom acha que foi, ou toca de novo e pode duplicar o pedido na cozinha.
- A pessoa escolhida em 'Lançar para' continua valendo no pedido seguinte. A porção da mesa pode cair na conta da Júlia.
- O X colado no nome da pessoa (quase invisível) remove a pessoa num toque, sem confirmar. O consumo dela passa a ser dividido entre os outros.
- Defeitos de dinheiro confirmados no código: (1) a comanda impressa pode sair com taxa diferente da tela e SEMPRE sem o desconto; (2) o desconto e a taxa desmarcada de uma mesa continuam valendo na próxima mesa; (3) a 'conta por pessoa' do Fechar Conta não se refaz quando o desconto muda, e o '+ pagar' sugere valor sem desconto; (4) o valor ao lado do nome da pessoa soma pedidos cancelados, e a conta não soma.
- Ao trocar de mesa com internet lenta, o painel mostra por alguns segundos o título da nova mesa com os pedidos e o total da anterior. Se a chamada falha, fica assim. Se o cardápio não carrega, a tela de lançar fica vazia sem aviso.

## Consertos rápidos (valem mesmo sem redesenho)

| Conserto | O que muda | Onde | Esforço |
|---|---|---|---|
| Taxa, desconto e gorjeta não passarem de uma mesa para outra | Hoje desconto, taxa marcada e gorjeta são valores únicos da tela. O desconto só volta a zero no botão de cancelar desconto, e a taxa desmarcada nunca volta a marcada. Ao fechar ou liberar a mesa E ao trocar de mesa: desconto volta a zero (e o bloco de desconto fecha), gorjeta volta a zero (ao fechar isso já acontece; falta ao trocar de mesa), a taxa volta a marcada e o percentual volta à taxa sugerida da mesa nova. Enquanto o Douglas não decide entre esta versão e a branch que grava o desconto na sessão, este é o remendo seguro. | src/components/mesas/MesasApp.tsx:381 (useServiceFee), :385-386 (desconto), :906-953 (closeSession, que só zera a gorjeta em :937), :737-765 (freeTable), efeito de troca de sessão :666-673 | pequeno (2 horas com teste nas Mesas 5 e 3) |
| Comanda impressa igual à tela e ao fechamento (taxa E desconto) | O 'Imprimir comanda' do painel passa a mandar a taxa que a tela mostra (marcada ? percentual : 0), igual ao Fechar Conta. Os dois passam a mandar também o desconto, e a rota de impressão passa a aceitá-lo com a mesma leitura da rota da conta (tipo, valor e motivo, recalculados no servidor) e a repassá-lo para o cálculo da conta. Hoje o papel sai sempre sem desconto. | src/components/mesas/MesasApp.tsx:1877 (painel) e :2805 (fechamento), imprimirConta em :837-846; src/app/api/store/table-sessions/[id]/imprimir-conta/route.ts:110 (calcularContaDaMesa sem desconto); leitura de referência em src/app/api/store/table-sessions/[id]/conta/route.ts (descontoTipo/descontoValor) | pequeno a médio (meio dia a 1 dia, testando garçom com 0%, 8%, sem comissão, com e sem desconto) |
| Conta por pessoa refeita quando o desconto muda | No Fechar Conta, mudar o desconto passa a recalcular a divisão por pessoa. Hoje ela só se refaz quando muda a taxa ou a gorjeta, e o '+ pagar' sugere o valor sem desconto. Também corrige a primeira busca da conta, que usa uma cópia antiga do desconto. | src/components/mesas/MesasApp.tsx:1257-1269 (efeito sem desconto nas dependências) e :612-622 (carregarConta com dependências vazias) | pequeno (1 hora) |
| Valor por pessoa sem contar pedido cancelado | A rota que traz as pessoas soma todos os itens delas, até os de pedidos cancelados. A conta da mesa pula os cancelados. A rota passa a ignorar pedido cancelado, igual à conta. O chip passa a dizer 'consumiu R$ 48,00', para não confundir com o 'paga R$ 52,80' da conta rateada. | src/app/api/store/table-sessions/[id]/guests/route.ts:44-62 x src/lib/conta-da-mesa.ts:118 | pequeno (1 hora) |
| Aviso aparecer também na tela de lançar, sem convidar a duplicar | O aviso flutuante passa a ser desenhado nas duas telas, como já foi feito com a janela de combo. Ele não engole mais o toque no botão de baixo (sem capturar toque) e um aviso novo substitui o anterior. Falha no envio vira faixa vermelha fixa acima do botão, em dois casos: (a) o servidor respondeu erro: 'Não foi enviado: [motivo]. Tentar de novo'; (b) caiu a internet sem resposta: a tela relê os pedidos da mesa. Se apareceu um pedido novo com esses itens, mostra 'O pedido #N chegou. Confira antes de reenviar'. Se não apareceu, oferece 'Tentar de novo'. O botão Enviar fica travado enquanto envia. | src/components/mesas/MesasApp.tsx:3091-3101 (aviso só no mapa); envio em addOrderToSession :767-808; showToast :389-392 (sem limpar o temporizador anterior) | pequeno (meio dia) |
| Voltar não apagar o carrinho calado | Com itens no carrinho, o Voltar abre uma janela da própria tela (não o confirm do navegador): 'Sair sem enviar 4 itens?', com 'Continuar pedido' e 'Descartar'. Com o carrinho vazio, volta direto. | src/components/mesas/MesasApp.tsx:1351 | pequeno (2 horas) |
| 'Lançar para' voltar para Mesa no pedido seguinte | Ao tocar '+ Novo Pedido' e depois de enviar com sucesso, a escolha volta para 'Mesa'. Quem entra pelo nome da pessoa continua com ela até enviar. O chip escolhido rola até ficar visível. '+ Pessoa' cria a pessoa pelo formato que devolve o id (hoje o formato usado devolve só a quantidade criada) e já a deixa escolhida. | src/components/mesas/MesasApp.tsx:660 e :670 (únicos resets), :1865 (+ Novo Pedido), :786-790 (sucesso do envio), :3031 (atalho pela pessoa), :626-635 (adicionarPessoas); guests/route.ts:95 ({criados}) x :107 ({guest:{id}}) | pequeno (2 a 3 horas) |
| Painel não mostrar pedidos de outra mesa | Ao tocar outra mesa, a lista antiga é limpa na hora. Aparece 'Carregando pedidos...' em vez de 'Nenhum pedido ainda', e a resposta atrasada de outra mesa é descartada. Se falhar: 'Não carregou. Tentar de novo'. | src/components/mesas/MesasApp.tsx:1754-1755 (troca de mesa), :512-519 (busca sem conferir a mesa e sem erro), :2109-2115 (estado vazio mostrado durante o carregamento) | pequeno (meio dia) |
| Cardápio que não carregou avisa | Se o cardápio não vier, a tela de lançar mostra 'Cardápio não carregou · Tentar de novo', em vez de uma grade vazia. | src/components/mesas/MesasApp.tsx:447-528 (fetchMenu com catch silencioso em :527), grade em :1485 | pequeno (1 hora) |
| Valores das pessoas atualizados depois de lançar | Os valores ao lado dos nomes são recarregados depois de lançar, mudar quantidade, remover item e cancelar pedido. | src/components/mesas/MesasApp.tsx: carregarPessoas só em :633, :645, :661, :672, :725; faltam em addOrderToSession (:767), editarQtdItem (:545), removerItemPedido (:563) e cancelarPedidoMesa (:584) | pequeno (1 a 2 horas) |
| Tirar o X que remove a pessoa num toque | O X sai do chip. O nome abre o menu da pessoa, que já existe, e o renomear passa para esse menu (hoje o campo de renomear fica dentro do chip). 'Tirar da mesa' confirma numa janela própria com texto claro: 'Os 2 itens da Júlia (R$ 48,00) vão ser divididos pela mesa'. Se ela já tem pagamento registrado, a janela avisa isso também. | src/components/mesas/MesasApp.tsx:1957-1960 (X com removerPessoa direto), :1932-1946 (renomear dentro do chip), :3069-3076 ('Tirar da mesa' sem confirmar), :648-663 (removerPessoa) | pequeno (2 a 3 horas) |
| Taxa não desligar com um toque sem querer | Hoje tocar no texto ou no valor da taxa liga e desliga a taxa, porque está tudo dentro do mesmo rótulo clicável. Só a caixinha continua ligando e desligando. | src/components/mesas/MesasApp.tsx:2176-2200 | pequeno (1 hora) |
| Botão 'Ver tudo / Recolher' do carrinho aparecer | Corrigir a ordem das regras de estilo. O carrinho volta ao tamanho normal depois de enviar e ao abrir outro pedido. Na fase do cardápio em tela cheia esse carrinho é substituído; até lá o garçom não fica preso com o cardápio sumido. | src/components/mesas/MesasApp.tsx:171 (dentro do @media 900px) x :183-187 (regra que ganha); :371 e :1532 | pequeno (1 hora) |
| Carrinho com linhas sem identificação repetida | A identificação de cada linha usa a quantidade de linhas do carrinho e se repete depois de uma remoção: um '+' aumenta dois combos e um '-' apaga dois. Passar a usar um contador que nunca repete. | src/components/mesas/MesasApp.tsx:1055 | pequeno (1 hora) |
| Quantidade digitada não virar 13 | O campo aceita ficar vazio enquanto se digita e só ajusta para 1 a 99 ao sair. | src/components/mesas/MesasApp.tsx:1593-1601 | pequeno (1 hora) |
| Busca que acha 'agua' e 'guarana' | A busca passa a ignorar acento, procura em todas as categorias quando há texto, ganha um X para limpar e mostra 'Nada encontrado para coca'. Busca e categoria são limpas depois de enviar. | src/components/mesas/MesasApp.tsx:1193-1202 (filteredMenu); sucesso do envio :786-790 | pequeno (2 a 3 horas) |
| Teclado não subir sozinho e busca sem zoom | Tirar o foco automático da busca em celular e tablet. Tirar o tamanho de letra 14 escrito no próprio campo, para valer a regra de 16px. | src/components/mesas/MesasApp.tsx:1373 (autoFocus) e :1377 (fontSize 14 inline) | pequeno (30 minutos) |
| Tamanhos mínimos de toque e de letra | (1) Tirar a altura 30 fixa do botão de quantidade do item lançado. (2) Os campos do painel (nome, renomear, taxa) passam para 16px. (3) A borda rosa de 'passar o mouse' só vale onde há mouse. (4) O aviso amarelo de 'itens que não aparecem' some no modo garçom. | src/components/mesas/MesasApp.tsx:2061 (minHeight 30), :1496-1497 (onMouseEnter/Leave), :200-209 (regras de toque, incluir .mesa-detalhe no 16px), :1396-1440 (aviso de ocultos) | pequeno (meio dia) |
| Painel da mesa mais largo no tablet deitado | O painel lateral passa de 300px para cerca de 40% da tela (entre 360 e 480px). A coluna do carrinho passa de 290px para 340px. | src/components/mesas/MesasApp.tsx:151-155 (bloco até 1180px, que também vale para notebook do caixa) | pequeno (1 hora, conferindo notebook de 1024 a 1180px) |
| Janela de Fechar Conta sem botão cortado | A altura da janela passa a descontar a barra do navegador do celular (dvh), como já foi feito na tela do mapa e no ComboModal. | src/components/mesas/MesasApp.tsx:2439 (92vh); referência :138 (.mesa-tela) e ComboModal.tsx:786 | pequeno (30 minutos) |
| Puxar para atualizar desligado no link do garçom | Arrastar a tela para baixo no mapa deixa de recarregar a página e perder o que está aberto, como o totem já faz. | src/app/garcom/layout.tsx (comentário promete, código não faz); referência src/app/totem/[slug]/layout.tsx:34-37 | pequeno (30 minutos) |
| Mensagens em português no abrir e no liberar mesa | 'Table already has an open session' vira 'Esta mesa acabou de ser aberta por outro aparelho', e o mapa é recarregado na hora. Liberar mesa mostra a explicação do servidor, não o código 'pagamento_incompleto'. | src/app/api/store/table-sessions/route.ts:94 e :134; src/components/mesas/MesasApp.tsx:730-731 (openTable) e :760 (freeTable usa err.error; closeSession em :948 já usa err.mensagem) | pequeno (1 hora) |

## Proposta principal: Mesa na mão: três telas cheias (Mesa, Cardápio, Conferir)

No celular e no tablet em pé, o garçom deixa de trabalhar em pedaços de tela e passa a ter uma tela inteira para cada coisa. Tocar na mesa abre a MESA em tela cheia, com o TOTAL grande sempre visível em cima, os pedidos no meio e dois botões grandes embaixo, no alcance do polegar ('+ Pedido' e 'Conta'). '+ Pedido' abre o CARDÁPIO em tela cheia: produtos em lista com letra grande e botões - e + na própria linha, e embaixo só uma barra '4 itens · R$ 36,50 · Ver pedido'. Essa barra abre o CONFERIR, onde ele vê de quem é cada item e toca 'Enviar'. Depois de enviar, volta para a Mesa com o pedido novo em destaque no topo. O voltar do celular (botão ou gesto) volta uma tela de cada vez e nunca apaga o que foi montado. O carrinho fica guardado no aparelho até ser enviado. Cada tela cheia só é publicada junto com o voltar dela: tela cheia sem voltar faria o gesto do Android sair do sistema a partir da mesa. O voltar e o rascunho partem do que já está pronto e testado na branch feat/mesa-celular-tablet. No computador do caixa (/store/mesas em tela larga), nada muda: continua o mapa com o painel ao lado.

### 1. Mapa de mesas

Achar a mesa e ver de relance quais estão livres, ocupadas e com valor.

- **Celular:** 3 colunas de cards de cerca de 100px, com número grande, valor e tempo em letra legível. Cabeçalho numa linha só ('Mesas · 11 livres · 5 ocupadas'). 'Sair' vai para um menu com confirmação. Rótulo longo ('Varanda 1') com número grande e o nome pequeno embaixo, numa linha só. Celular deitado: 5 a 6 colunas e cabeçalho mínimo.
- **Tablet:** Em pé: 4 a 5 colunas, e a mesa abre em tela cheia. Deitado: o mapa ocupa cerca de 60% da largura e a mesa abre no painel da direita, com cerca de 40%.

Elementos:

- Card: número grande, 'Livre' ou valor, tempo da mesa
- Selo 'rascunho: 4 itens' no card de mesa com pedido não enviado neste aparelho
- Tocar em mesa livre abre 'Ocupar mesa'; tocar em mesa ocupada abre a tela da Mesa
- Menu no topo com Sair (pede confirmação)
- Sem mesas no modo garçom: 'Peça ao gerente para cadastrar as mesas' (já existe)
- Mapa não atualiza (sem internet): faixa 'Sem conexão · atualizado há 40 s'

### 2. Ocupar mesa (janela pequena)

Abrir a mesa e já cair no cardápio, sem toque extra.

- **Celular:** Janela que sobe de baixo, com botões grandes e altura limitada à tela (rola se o teclado subir). O campo de nome é opcional e fica acima do teclado.
- **Tablet:** A mesma janela, centralizada.

Elementos:

- 'Quantas pessoas?' 1 2 3 4 5 6+ (opcional; cria 'Cliente 1..N' depois de ocupar)
- Nome do cliente ou ocasião (opcional, letra 16px)
- Botão principal 'Ocupar e lançar pedido', que já abre o Cardápio
- Botão secundário 'Só ocupar'
- Se outro aparelho abriu a mesa um segundo antes: recarrega o mapa e oferece 'A Mesa 5 já está aberta (garçom Maria). Abrir a mesa?' (o nome vem da lista de mesas recarregada)

### 3. Mesa (tela cheia)

Conferir o que a mesa já pediu, responder 'quanto deu?' e começar um novo pedido ou fechar a conta.

- **Celular:** Tela inteira, sem o mapa atrás. Faixa fixa em cima com '< Mesas', 'Mesa 5 · 25 min' e o TOTAL em letra grande (24px ou mais). Uma única rolagem no meio, com as pessoas e os pedidos. Barra fixa embaixo, de cerca de 64px: '+ Pedido' verde com 2/3 da largura e 'Conta' com 1/3. Celular deitado: faixa de cima numa linha só, com TOTAL à direita.
- **Tablet:** Em pé: a mesma tela cheia, com cada item numa linha só (nome, dono e valor lado a lado). Deitado: a mesma tela no painel da direita, com 40% da largura, ao lado do mapa.

Elementos:

- Topo fixo: '< Mesas', número da mesa, tempo, nome do cliente, TOTAL grande
- Linha abaixo do total, só leitura: 'Consumo R$ 453,60 · Taxa 10% R$ 45,36'. O TOTAL usa a mesma conta do servidor (rota conta) com a taxa desta mesa. O desconto só entra aqui se o Douglas decidir gravá-lo na sessão; senão a linha diz 'desconto no fechamento'. Mudar taxa e desconto fica no Fechar Conta, e o 'Salvar % como padrão da loja' (modo loja) vai junto para lá.
- Botão '...' no canto com Imprimir comanda, Mudar de mesa, Liberar mesa e (só no modo loja) Editar mesa
- Faixa de pessoas: chips de 44px 'Todos | Marcos | Júlia consumiu 48,00 | ... | + pessoa', sem X. Com mais de 5 pessoas, o último chip é 'Todas (12) ▾' e abre uma folha com os nomes em grade.
- Mesa sem pessoas: atalhos '2 3 4 pessoas' e o texto 'Cadastre quem está na mesa para rachar a conta no fim'
- Tocar numa pessoa filtra a lista e mostra em cima 'Júlia · consumiu R$ 48,00 · [Lançar para Júlia] [Receber da Júlia] [...]'. O '...' da pessoa tem Renomear e Tirar da mesa (confirma, citando itens e pagamentos dela).
- '+ pessoa' cria a pessoa e já pede o nome numa janelinha com letra 16px
- Pedidos com o mais recente primeiro: 'Pedido #7 · há 2 min'
- Cada item: '2x Chopp 300ml' em 16px, valor à direita, dono como etiqueta escrita (MESA dividido / JÚLIA), escolhas do combo e observação ('sem cebola') em linhas próprias. A observação precisa entrar no tipo do pedido na tela, porque a API já devolve.
- Tocar na linha inteira do item abre a folha do item (tela 4); a lixeira, o '2x' e o 'Cancelar' pequenos saem da lista
- Pedido cancelado continua riscado, no fim da lista
- Enquanto carrega: 'Carregando pedidos...'. Se falhar: 'Não carregou · Tentar de novo'. Sem pedidos: 'Nenhum pedido ainda' com seta para '+ Pedido'.
- Depois de enviar: o pedido novo aparece no topo, destacado por alguns segundos, com o aviso 'Pedido #7 enviado · 4 itens · R$ 36,50'

### 4. Folha do item já lançado

Corrigir um item sem mirar em botão minúsculo.

- **Celular:** Folha que sobe de baixo até a metade da tela, com botões de 48px ou mais e X para fechar. O voltar do celular também fecha.
- **Tablet:** A mesma folha, com cerca de 480px de largura, centralizada embaixo.

Elementos:

- Título: '2x Chopp 300ml · Pedido #7 · MESA'
- Quantidade: - 2 + com 'Salvar' (grava só ao confirmar, como hoje). O salvar manda 'de 2 para 3', e se outro aparelho já mudou o item a folha avisa 'Este item mudou para 4 em outro aparelho' em vez de sobrescrever.
- 'Remover este item' (janela própria com texto claro)
- 'Cancelar o pedido #7 inteiro' (janela própria, em vermelho e separada)
- A atualização automática não mexe no número enquanto a folha está aberta
- Mais tarde: 'Passar para outra pessoa'

### 5. Cardápio (tela cheia)

Escolher os produtos com letra grande e o máximo de itens visíveis.

- **Celular:** Tela inteira. Topo compacto com '< Mesa 5', busca e abas de categoria presas no alto ao rolar. Faixa 'Lançando para: MESA (dividido)' com os chips das pessoas. Produtos em LISTA: linha de 56 a 64px com nome em 16px, preço e '- N +' de 44px na própria linha; miniatura de 48px à esquerda só quando o produto tem foto. Embaixo só a barra fixa '4 itens · R$ 36,50 · Ver pedido >'. O cardápio passa de 224px para cerca de 530px. Celular deitado: busca, abas e 'Lançando para' numa faixa só, e a lista usa o resto.
- **Tablet:** Em pé: grade de 4 colunas com cards maiores (nome 16px, sem desenho de hambúrguer quando não há foto, sem a categoria repetida), com '- N +' no card e a mesma barra embaixo. Deitado: grade de 5 colunas, e a coluna do pedido (340px) fica fixa à direita com o Enviar, sem folha.

Elementos:

- '< Mesa 5' no topo (com itens, não pergunta: o rascunho fica guardado e a Mesa mostra 'rascunho: 4 itens · Continuar')
- Busca sem acento e sem teclado automático, com X para limpar, e 'Nada encontrado para "coca"'
- Abas de categoria na ordem cadastrada pela loja (MenuCategory.sortOrder; a rota do cardápio precisa mandar essa ordem), com sinal de que há mais para o lado. Em 'Todos', títulos 'BEBIDAS', 'LANCHES'.
- Faixa 'Lançando para: MARCOS' em letra grande e cor forte, sempre escrita (a cor só reforça)
- Chips 'Mesa | Marcos | Júlia | + pessoa' (com mais de 5: 'Todas ▾'); o chip escolhido rola até aparecer
- Linha do produto: nome, preço, '- N +'. O número mostra quanto já foi para o dono escolhido. O '-' só tira a linha simples desse dono; se houver só linhas com observação ou combo, abre o Conferir.
- Produto com escolhas (combo, pizza) mostra 'escolher >' e o número de combos já no carrinho, e abre a janela de combo que já existe, com o texto 'Adicionar para Marcos' (prop opcional; o cliente não muda)
- Toque com resposta visível: a linha pisca de leve e o número aumenta
- Cardápio não carregou: 'Não carregou · Tentar de novo'
- Barra fixa embaixo: 'N itens · R$ X · Ver pedido >' (some com o carrinho vazio)

### 6. Conferir e enviar (folha quase cheia)

Ver de quem é cada item antes de mandar para a cozinha e corrigir sem apagar e relançar.

- **Celular:** Folha que sobe até cerca de 90% da tela, com alça e X no topo. O voltar do celular fecha e volta ao cardápio sem perder nada. Enviar fixo embaixo, largo.
- **Tablet:** Em pé: a mesma folha. Deitado: não precisa, porque é a coluna fixa da direita.

Elementos:

- Itens agrupados por dono: 'MESA (dividido)', 'JÚLIA', 'MARCOS', com subtotal
- Cada linha: quantidade '- N +', nome, valor, escolhas do combo ('1/2 calabresa, 1/2 frango')
- Combos idênticos (mesmas escolhas, dono e observação) juntos numa linha com quantidade
- Botão 'observação' em cada linha ('sem cebola', 'sem gelo', 'bem passado' + texto livre)
- Tocar no dono da linha abre 'Passar para: Mesa / Marcos / Júlia...'
- Remover linha com 'Removido · Desfazer' por 5 segundos
- Antes de enviar, a tela confere se as pessoas das linhas ainda estão na mesa; se alguém saiu: 'A Júlia saiu da mesa. Escolher dono destes 2 itens'
- Botão 'Enviar 4 itens (1 da Júlia, 3 da mesa) · R$ 36,50', travado enquanto envia
- Erro com resposta do servidor: faixa vermelha com o motivo e 'Tentar de novo'. Sem resposta (internet): a tela relê a mesa antes de oferecer reenviar. O carrinho continua ali.

### Navegação

ENTRAR: Mapa > toque na mesa ocupada > Mesa (tela cheia) > '+ Pedido' > Cardápio > barra 'Ver pedido' > Conferir. Mesa livre: Mapa > 'Ocupar e lançar pedido' > Cardápio direto.

VOLTAR (sempre uma tela de cada vez): toda tela tem saída visível ('< Mesas', '< Mesa 5', X na folha), e o voltar do Android e o gesto de borda do iPhone fazem o mesmo. Conferir > Cardápio > Mesa > Mapa. Só no Mapa o voltar sai do módulo. Base: lib/voltar-em-camadas.ts + useVoltarDoCelular.ts da branch feat/mesa-celular-tablet (já testados). Cada tela aberta por toque ganha um passo no histórico, e a tela mostrada é decidida pelo passo em que o navegador parou (fecha tudo o que foi aberto depois dele), não por 'cada voltar fecha a de cima'. Isso é obrigatório por causa da janela de combo: ela cria o próprio passo e, quando fecha pelo X ou pelo confirmar, chama history.back() depois de já ter sumido da tela (ComboModal.tsx:142). Esse voltar chega atrasado e não pode fechar o Cardápio. Registrar passo só dentro de um toque e depois que a página carregou, porque um passo errado faz o Next recarregar a página. No link do garçom, o login passa a usar location.replace, para o voltar no Mapa sair de verdade em vez de ir ao login e voltar para as mesas.

SEM PERDER CARRINHO: (1) sair do Cardápio com itens, pelo botão ou pelo gesto, não apaga: o carrinho fica como rascunho e a Mesa mostra 'rascunho: 4 itens · Continuar · Descartar'. Descartar pede confirmação; (2) o carrinho é gravado no aparelho a cada toque, pela sessão da mesa (lib/rascunho-da-mesa.ts; decidir com o Douglas se também separa por garçom), e só é apagado depois do envio com sucesso, do descarte, do fechamento da mesa ou depois de 12 horas; (3) recarregar, bloquear o celular, cair a internet ou ser deslogado pelo fim do turno não apaga: ao reabrir a mesa aparece 'Você tem 4 itens não enviados na Mesa 5 · Continuar / Descartar'; (4) ao restaurar, o preço é recalculado pelo cardápio atual, e item que saiu do cardápio ou pessoa que saiu da mesa é avisado antes de enviar; (5) nada é enviado sozinho; (6) mesa transferida mantém a mesma sessão, então o rascunho vai junto; (7) puxar a tela para baixo não recarrega no link do garçom.

DEPOIS DE ENVIAR: volta para a Mesa (não para o mapa), com o pedido novo destacado no topo, 'Lançar para' de volta em 'Mesa', a busca limpa e os valores das pessoas recarregados.

### Passo a passo do garçom

1. Mesa nova: toca na mesa livre no mapa.
2. Na janela 'Ocupar mesa', toca '4 pessoas' (opcional) e 'Ocupar e lançar pedido'. Já está no cardápio.
3. A faixa diz 'Lançando para: MESA'. Toca '+' em Chopp duas vezes e em Porção de Fritas uma vez. O número na linha mostra 2 e 1.
4. O cliente diz 'o X-Burguer é meu, sem cebola'. O garçom toca no chip 'Cliente 2' (a faixa muda para 'Lançando para: CLIENTE 2') e toca '+' no X-Burguer.
5. Toca na barra '4 itens · R$ 86,00 · Ver pedido'. A folha mostra MESA: 2 Chopp, 1 Fritas | CLIENTE 2: 1 X-Burguer.
6. Na linha do X-Burguer, toca em 'observação', escolhe 'sem cebola' e confirma.
7. Toca 'Enviar 4 itens (1 do Cliente 2, 3 da mesa)'. Volta para a Mesa, com o Pedido #1 destacado no topo e o TOTAL atualizado em cima.
8. Mais tarde, toca na mesa no mapa e vê o TOTAL grande na hora para responder ao cliente.
9. 'Mais uma rodada': toca '+ Pedido' (a faixa já vem em 'MESA'), soma os itens e envia.
10. Errou uma quantidade já enviada: toca na linha do item, ajusta '- 2 +' e toca 'Salvar'. Se o colega mexeu antes, a folha avisa.
11. O celular tocou ou ele usou o voltar sem querer no meio do pedido: volta para a Mesa com 'rascunho: 4 itens · Continuar'.
12. A internet caiu no Enviar: a faixa vermelha avisa, a tela confere se o pedido chegou e só então oferece reenviar.
13. Hora da conta: toca 'Conta' na barra de baixo (Fechar Conta atual) ou toca no nome da pessoa > 'Receber da Júlia'.

### Rascunho no celular

```text
CELULAR (390x844) - TELA DA MESA
+------------------------------------+
| < Mesas     MESA 5 · 25 min    ... |
| Aniversario Marcos · 6 pessoas     |
| TOTAL            R$ 498,96         |
| Consumo 453,60 · Taxa 10% 45,36    |
+------------------------------------+
| rascunho: 2 itens  [Continuar] [x] |
+------------------------------------+
| [Todos] [Marcos] [Julia 48,00] [Todas(6)v] |
+------------------------------------+
| PEDIDO #7 · ha 2 min               |
|  2x Chopp 300ml          R$ 24,00  |
|     MESA (dividido)                |
|  1x X-Burguer            R$ 32,00  |
|     JULIA · sem cebola             |
|------------------------------------|
| PEDIDO #4 · ha 20 min              |
|  1x Pizza 4 Queijos     R$ 169,80  |
|     1/2 calabresa, 1/2 frango      |
|     MESA (dividido)                |
|            ( rola )                |
+------------------------------------+
| [      + PEDIDO       ] [ CONTA  ] |
+------------------------------------+

CELULAR - CARDAPIO (LANCAR)
+------------------------------------+
| < Mesa 5    [ Buscar: agua, coca x]|
| [Todos][Bebidas][Lanches][Pizz  >  |
| LANCANDO PARA:  MESA (dividido)    |
| (Mesa) (Marcos) (Julia) (+pessoa)  |
+------------------------------------+
| BEBIDAS                            |
| Coca-Cola Lata 350ml               |
| R$ 7,00             [-]  2  [+]    |
|------------------------------------|
| [foto] Guarana Antarctica Lata     |
|        R$ 6,50      [-]  1  [+]    |
|------------------------------------|
| Coca-Cola 2L                       |
| R$ 16,00            [-]  1  [+]    |
|------------------------------------|
| LANCHES                            |
| X-Burguer                          |
| R$ 32,00                    [+]    |
| Pizza meio a meio  (1) escolher >  |
|   ( ~8 produtos por tela, rola )   |
+------------------------------------+
| 4 itens · R$ 36,50    VER PEDIDO > |
+------------------------------------+

CELULAR - CONFERIR E ENVIAR (folha)
+------------------------------------+
|              ____             [X]  |
| Conferir pedido · Mesa 5           |
| MESA (dividido)                    |
|  Coca-Cola Lata   R$ 14,00 [-]2[+] |
|  Coca-Cola 2L     R$ 16,00 [-]1[+] |
|  [observacao]  [dono: Mesa v]      |
| JULIA                              |
|  Guarana Lata     R$  6,50 [-]1[+] |
|  [observacao]  [dono: Julia v]     |
| ! Nao foi enviado (sem internet).  |
|   Conferindo a mesa...             |
+------------------------------------+
| [ ENVIAR 4 ITENS                 ] |
| [ 1 da Julia, 3 da mesa · 36,50  ] |
+------------------------------------+

CELULAR - MAPA
+------------------------------------+
| Mesas  11 livres · 5 ocupadas  [=] |
+------------------------------------+
| +--------+ +--------+ +--------+   |
| |   01   | |   02   | |   03   |   |
| | Livre  | | 218,60 | |  90,80 |   |
| |        | | 25 min | | 12 min |   |
| +--------+ +--------+ +--------+   |
| +--------+ +--------+ +--------+   |
| |   05   | |   13   | |   08   |   |
| | 453,60 | | Varanda| |  0,00  |   |
| |rascunho| | 81,90  | |sem ped.|   |
| +--------+ +--------+ +--------+   |
+------------------------------------+

CELULAR DEITADO (844x390) - CARDAPIO
+----------------------------------------------------------+
| < Mesa 5 [Buscar] [Todos][Bebidas][Lanches] PARA: MESA v |
+----------------------------------------------------------+
| Coca-Cola Lata   R$ 7,00 [-]2[+] | Coca 2L R$ 16 [-]1[+] |
| Guarana Lata     R$ 6,50 [-]1[+] | Agua    R$ 5  [+]     |
+----------------------------------------------------------+
| 4 itens · R$ 36,50                          VER PEDIDO > |
+----------------------------------------------------------+
```

### Rascunho no tablet

```text
TABLET EM PE (820x1180) - TELA DA MESA (tela cheia)
+----------------------------------------------------------+
| < Mesas        MESA 5 · 25 min · 6 pessoas           ... |
|                TOTAL  R$ 498,96                          |
|                Consumo 453,60 · Taxa 10% 45,36           |
+----------------------------------------------------------+
| [Todos] [Marcos] [Julia 48,00] [Pedro] [Rafa] [+ pessoa] |
+----------------------------------------------------------+
| PEDIDO #7 · ha 2 min                                     |
|  2x Chopp 300ml             MESA            R$ 24,00     |
|  1x X-Burguer               JULIA           R$ 32,00     |
|     sem cebola                                           |
| PEDIDO #4 · ha 20 min                                    |
|  1x Pizza 4 Queijos c/ Borda  MESA         R$ 169,80     |
|                        ( rola )                          |
+----------------------------------------------------------+
| [           + PEDIDO             ]  [      CONTA      ]  |
+----------------------------------------------------------+

TABLET EM PE - CARDAPIO
+----------------------------------------------------------+
| < Mesa 5    [ Buscar                               x]    |
| [Todos] [Bebidas] [Lanches] [Pizzas] [Porcoes] [Sobrem.] |
| LANCANDO PARA: MESA    (Mesa) (Marcos) (Julia) (+pessoa) |
+----------------------------------------------------------+
| BEBIDAS                                                  |
| +------------+ +------------+ +------------+ +---------+ |
| | Coca-Cola  | | Coca-Cola  | | Guarana    | | Agua sem| |
| | Lata 350ml | | 2L         | | Lata       | | Gas     | |
| | R$ 7,00    | | R$ 16,00   | | R$ 6,50    | | R$ 5,00 | |
| | [-] 2 [+]  | | [-] 1 [+]  | | [-] 1 [+]  | |   [+]   | |
| +------------+ +------------+ +------------+ +---------+ |
| (com foto: foto de altura fixa no topo do card)          |
| LANCHES ...                                              |
+----------------------------------------------------------+
| 4 itens · R$ 36,50                        VER PEDIDO >   |
+----------------------------------------------------------+

TABLET DEITADO (1180x820) - MAPA + MESA AO LADO
+----------------------------------+-----------------------+
| Mesas   11 livres · 5 ocupadas   | MESA 5 · 25 min  ... X|
| +----+ +----+ +----+ +----+      | TOTAL   R$ 498,96     |
| | 01 | | 02 | | 03 | | 04 |      | [Todos][Marcos][Julia]|
| +----+ +----+ +----+ +----+      | #7 · ha 2 min         |
| +----+ +----+ +----+ +----+      |  2x Chopp  MESA 24,00 |
| | 05 | | 06 | | 07 | | 08 |      |  1x X-Burg JULIA 32,00|
| +----+ +----+ +----+ +----+      |    sem cebola         |
|        (60% da largura)          |    (40%, rola)        |
|                                  | [ + PEDIDO ] [ CONTA ]|
+----------------------------------+-----------------------+

TABLET DEITADO - CARDAPIO COM PEDIDO FIXO AO LADO
+------------------------------------------+---------------+
| < Mesa 5  [Buscar]  [Todos][Bebidas]...  | PEDIDO · 4    |
| LANCANDO PARA: MESA (Mesa)(Marcos)(Julia)| MESA          |
| +------+ +------+ +------+ +------+ +---+|  2x Coca Lata |
| |Coca  | |Coca  | |Guara-| |Agua  | |X- ||  1x Coca 2L   |
| |Lata  | |2L    | |na    | |      | |Bur||  [obs] [dono] |
| |7,00  | |16,00 | |6,50  | |5,00  | |32 || JULIA         |
| |-2+   | |-1+   | |-1+   | | +    | | + ||  1x Guarana   |
| +------+ +------+ +------+ +------+ +---+|               |
|         (5 colunas, nome 16px)           | [ENVIAR 4     |
|                                          |  R$ 36,50 ]   |
+------------------------------------------+---------------+
```

## Ideias extras

| Ideia | O que é | Quando |
|---|---|---|
| Observação em qualquer produto | Botão 'observação' visível na linha do Conferir, com opções rápidas ('sem cebola', 'sem gelo', 'bem passado', 'para viagem') mais texto livre. Hoje, na mesa, só dá para anotar em combo. A janela de combo já tem modo de produto simples, mas o botão diz 'Adicionar à sacola'. Se for usada, entra com texto de garçom por prop opcional. Nada de toque longo escondido. | junto |
| Janela de combo com texto de garçom | Props opcionais no ComboModal: texto do botão ('Adicionar para Marcos'), subtítulo 'Mesa 5' e esconder a foto grande. Sem as props, cardápio do cliente e venda presencial ficam exatamente como hoje. | junto |
| Mesa sempre atualizada entre aparelhos | Com a tela da Mesa aberta, a cada 8 segundos atualizar também pedidos e pessoas, sem mexer na lista debaixo do dedo nem no número da folha aberta. Parar quando o celular está em outra tela ou a aba está escondida, e também pausar o mapa enquanto o garçom lança. Se a mesa foi fechada ou transferida: 'A Mesa 5 foi fechada pelo caixa' e volta ao mapa. | junto |
| Pedido nunca duplicado na cozinha | Cada carrinho ganha um código único enviado no Enviar. Se a internet cair depois de o servidor gravar e o garçom reenviar, o servidor devolve o pedido já criado, sem baixar estoque nem imprimir de novo. Precisa de coluna nova no banco, em entrega separada com backup, mas ANTES de a faixa 'Tentar de novo' ficar livre. | junto |
| Filtro e busca no mapa | Chips 'Todas · Ocupadas · Livres · Minhas' (começa em 'Todas') e um campo 'Ir para mesa nº' com teclado numérico, para casas com 30 ou mais mesas. | depois |
| Card de mesa que avisa quem está esquecido | 'Sem pedido há 25 min' em amarelo e o tempo desde o último pedido, não desde a abertura. Número de pessoas e iniciais do garçom. Tirar o '+10%' repetido de todos os cards. O servidor precisa mandar a hora do último pedido. | depois |
| Passar item já enviado para outra pessoa | Na folha do item lançado, 'Passar para Júlia' sem cancelar e relançar. Precisa de rota nova e de teste do rateio (a conta por pessoa tem que continuar somando o total). | depois |
| Fechar Conta mais simples no celular | Tocar na pessoa abre 'Receber da Júlia · paga R$ 52,80' com o valor preenchido e botões grandes Dinheiro/Pix/Débito/Crédito. 'Conta por pessoa' começa recolhida. É a parte de maior risco de dinheiro, por isso vem separada e depois dos consertos da conta por pessoa. | depois |
| Prova escrita da conta da mesa | Script no padrão de scripts/teste-desconto-manual.mjs que prova, para a mesma mesa (com pessoa, item da mesa, cancelado, taxa 0/8/10 e desconto em % e em R$), que rota conta, fechamento e comanda impressa dão o mesmo total e que as partes por pessoa somam o total. | junto |
| Aba 'Mais pedidos' | Primeira aba do cardápio com os 10 a 15 itens mais vendidos da loja nos últimos 30 dias, calculada sozinha, sem o lojista configurar. | depois |
| Repetir rodada | Na tela da Mesa, botão 'Repetir' num pedido de bebidas que joga os mesmos itens no carrinho para conferir e enviar. Precisa decidir de quem é a rodada repetida. | talvez |
| Alternar lista ou grade no cardápio | Botão para o garçom escolher entre lista (padrão no celular) e grade com fotos, lembrado no aparelho. Só se lojas com fotos boas pedirem. | talvez |
| Texto grande 'A+' | Como o link do garçom bloqueia o zoom, um botão 'A+' salvo no aparelho aumenta as letras da comanda e do cardápio para quem tem vista cansada ou trabalha com pouca luz. | talvez |
| Lançar por código do produto | Teclado numérico: '12' lança Chopp. Bom para garçom experiente, mas as lojas precisam cadastrar códigos. | talvez |
| Aviso de 'prato pronto' da cozinha | Quando a cozinha marca pronto, o aparelho do garçom avisa e o card da mesa ganha um selo. Depende da tela da cozinha. | talvez |
| Indicador de internet e tela sem apagar | Bolinha verde ou vermelha 'sem internet' no topo e pedido para o tablet não apagar a tela enquanto o módulo de mesas está aberto. | talvez |

## Fases

### Fase 0 - Consertos que o cliente sente já e defeitos de dinheiro (sem mudar o desenho) (3 a 4 dias de trabalho + 1 dia de conferência na Mesa 5 de teste (celular, tablet em pé e deitado, notebook de 1024px e computador do caixa))

- Taxa volta a marcada e à sugerida da mesa; desconto e gorjeta zerados ao fechar, liberar e trocar de mesa
- Comanda impressa com a mesma taxa E o mesmo desconto da tela (rota de impressão aceita desconto)
- Conta por pessoa refeita quando o desconto muda
- Valor por pessoa sem pedido cancelado, rotulado 'consumiu'
- Aviso visível na tela de lançar; faixa vermelha no erro de envio que confere a mesa antes de oferecer reenviar
- Voltar pergunta antes de apagar o carrinho (janela própria)
- 'Lançar para' volta para Mesa depois de enviar e no '+ Novo Pedido'; '+ Pessoa' já seleciona a pessoa
- Painel não mostra pedidos de outra mesa; 'Carregando...' no lugar de 'Nenhum pedido ainda'; cardápio que não carregou avisa
- Valores por pessoa atualizados depois de lançar, editar e cancelar
- X do chip removido, renomear no menu da pessoa, 'Tirar da mesa' com confirmação (itens e pagamentos)
- Botão 'Ver tudo/Recolher', linhas do carrinho sem identificação repetida, quantidade sem virar 13
- Busca sem acento, sem teclado automático, com letra 16px, limpa depois de enviar
- Letras de 16px nos campos, sem borda rosa grudada, sem aviso de gerente no modo garçom
- Painel do tablet deitado com 40% da largura; Fechar Conta sem botão cortado
- Puxar para atualizar desligado no link do garçom; mensagens de abrir e liberar mesa em português
- Script de prova da conta da mesa (tela = conta = fechamento = impressão)

### Fase 1 - Tela da Mesa em tela cheia, já com o voltar do celular (cerca de 1 semana, com teste em Android e iPhone de verdade)

- Ligar lib/voltar-em-camadas.ts e useVoltarDoCelular.ts (branch feat/mesa-celular-tablet) no módulo: Mesa > Mapa pelo voltar do Android e pelo gesto do iPhone
- Login do garçom com location.replace (voltar no mapa sai de verdade)
- Mesa em tela cheia no celular e no tablet em pé (painel lateral largo no tablet deitado; caixa sem mudança)
- TOTAL grande fixo em cima, vindo da mesma conta do servidor, com a taxa desta mesa (desconto conforme a decisão do Douglas)
- Barra de baixo com '+ Pedido' e 'Conta'; Imprimir, Mudar de mesa, Liberar (e Editar, só no modo loja) no '...'; 'Salvar % como padrão' levado ao Fechar Conta
- Pessoas como chips grandes que filtram a lista, com 'Todas (N)' para mesa grande e atalho de quantidade para mesa sem pessoas
- Pedidos com o mais recente primeiro, nome 16px, dono escrito, escolhas do combo e observação visíveis; estados de carregando, erro e vazio
- Folha do item lançado (quantidade que só grava ao confirmar e avisa se outro aparelho mudou; remover; cancelar pedido) com janelas próprias no lugar de confirm()
- Depois de enviar, volta para a Mesa com o pedido novo destacado
- Janela 'Ocupar mesa' com quantas pessoas e 'Ocupar e lançar pedido'
- Construída em componentes novos (ex.: components/mesas/MesaTelaCheia.tsx), não dentro das 3.100 linhas do MesasApp
- 3 a 5 prints ou vídeo curto para o cliente mostrar à equipe

### Fase 2 - Cardápio em tela cheia, Conferir e rascunho guardado (cerca de 1 semana e meia)

- Cardápio ocupando a tela toda, em lista no celular (nome 16px, '- N +' na linha, miniatura só com foto), com layout próprio para celular deitado
- Grade maior no tablet (4 colunas em pé, 5 deitado), sem desenho genérico quando não há foto
- Barra '4 itens · R$ · Ver pedido' no celular e no tablet em pé; coluna fixa de 340px no tablet deitado
- Folha Conferir com itens por dono, escolhas do combo, combos iguais juntos, observação e troca de dono da linha
- Voltar em camadas Conferir > Cardápio > Mesa, convivendo com o voltar próprio da janela de combo (validar confirmar e fechar combo sem fechar o Cardápio)
- Rascunho do carrinho (lib/rascunho-da-mesa.ts): selo no card, 'Continuar/Descartar' na Mesa, preço recalculado e pessoas conferidas ao restaurar
- Faixa 'Lançando para: NOME' grande; observação em produto simples; props opcionais de texto de garçom no ComboModal
- Categorias na ordem da loja (rota do cardápio manda a ordem), presas no topo, com títulos em 'Todos'
- Preço e quantidade por produto calculados uma vez (sem recalcular a cada toque); mapa pausado enquanto lança

### Fase 3 - Segurança entre aparelhos (1 semana, em entregas separadas)

- Pedido nunca duplicado (código único por carrinho, coluna nova no banco, entrega separada com backup)
- Mesa aberta atualizando pedidos e pessoas a cada 8 segundos, parando com o celular em outra tela
- Aviso 'mesa fechada/transferida por outro aparelho' levando ao lugar certo
- Edição de quantidade recusada pelo servidor quando o item já mudou
- Decisão aplicada sobre o desconto (gravado na sessão ou só no fechamento)

### Fase 4 - Mapa e fechamento (1 a 2 semanas, em entregas separadas)

- Filtros do mapa, 'Ir para mesa nº' e card com 'sem pedido há X min'
- Fechar Conta simplificado no celular (receber por pessoa com valor preenchido)
- Indicador de internet

## Cuidados

- Dinheiro, regra 1: item com dono é da pessoa, sem dono é da mesa e entra no rateio. A troca de dono no Conferir, a remoção de pessoa (inclusive com pagamento já registrado em nome dela) e o rascunho restaurado precisam ser testados no rateio antes de ir ao ar.
- Dinheiro, regra 2: o TOTAL da tela da Mesa, a comanda impressa, a rota da conta e o fechamento precisam dar o mesmo número. Hoje não dão em três casos: a impressão ignora o desconto (imprimir-conta/route.ts:110), a conta por pessoa não se refaz com o desconto (MesasApp.tsx:1269) e a taxa desmarcada vaza para a próxima mesa. O rodapé atual do painel também soma só consumo e taxa (MesasApp.tsx:2231).
- Desconto em duas versões: o master (85ef5c3f) guarda o desconto só na memória do aparelho, calcula a taxa sobre o consumo descontado e deixa o garçom dar desconto. A branch feat/desconto-balcao-mesa (b6407264, não publicada) grava na sessão, calcula a taxa sobre o consumo cheio, só a loja dá desconto e a conta impressa sai com o desconto. Não prometer 'TOTAL com desconto em qualquer aparelho' sem essa decisão, e não trocar a regra da taxa sem avisar, porque muda o valor cobrado.
- Dinheiro, regra 3: o servidor continua recalculando o preço no envio. O rascunho guardado no aparelho não guarda preço como verdade: ao restaurar, o preço é refeito pelo cardápio atual, e item fora do cardápio é avisado (o servidor recusa o pedido inteiro).
- Dinheiro, regra 4: mudar a quantidade de item já lançado só grava ao tocar 'Salvar' (houve o caso real do '+' tocado 3 vezes virando 6). A atualização de 8 segundos não pode trocar o número com a folha aberta. Como a quantidade gravada é absoluta, dois aparelhos podem sobrescrever um ao outro: mandar 'de X para Y'.
- Retry: enquanto não existir a proteção contra pedido duplicado, nenhum botão 'Tentar de novo' reenvia sem antes reler a mesa quando o erro foi de internet (sem resposta do servidor).
- O servidor transforma em 'da mesa', sem avisar, o item cuja pessoa não existe mais (add-order/route.ts:119-127 e :160). Com rascunho guardado ou dois aparelhos, a tela precisa avisar 'a pessoa saiu da mesa, escolha o dono' antes de enviar.
- Chip da pessoa e 'Receber da pessoa' mostram números diferentes (consumo próprio x parte a pagar com rateio, taxa e desconto). Sempre rotular 'consumiu' e 'paga'.
- Modo loja: o mesmo código atende o computador do caixa (/store/mesas) e o link do garçom. As telas cheias valem só para celular e tablet em pé. As regras de largura atuais (até 900px e até 1180px) também pegam notebook e janela estreita do caixa: conferir cada fase em 1024, 1180 e 1440px.
- Janela de combo (ComboModal): é a mesma do cardápio do cliente e da venda presencial. Mudanças só por props opcionais cujo padrão é o comportamento de hoje. Ela faz o próprio passo no histórico e chama history.back() depois de fechar (ComboModal.tsx:135-143). Esse voltar chega atrasado, então o controle novo decide a tela pelo passo em que o navegador parou, e não por 'um voltar fecha a de cima'.
- Voltar no Next 16: só registrar passo no histórico dentro de um toque e depois que a página carregou. Um passo registrado sem o estado interno do Next faz a página recarregar (node_modules/next/dist/client/components/app-router.js:284-293) e perder o que não foi guardado.
- Não recomeçar o que já existe: voltar em camadas e rascunho estão prontos e testados na branch feat/mesa-celular-tablet (8f53c615). O rascunho de lá é por sessão da mesa, não por garçom: confirmar com o Douglas antes de mudar.
- Muitos tamanhos estão escritos direto em cada botão e ganham das regras gerais de estilo (altura 30 no botão de quantidade, letra 14 na busca). Ao aumentar, é preciso tirar o valor antigo do botão, não só acrescentar regra.
- As fotos de hoje foram tiradas sem simular dedo. Num celular de verdade os botões sobem para 44px e a lista do painel chega a 0px. Validar cada fase com simulação de toque ou no aparelho do cliente, com celular deitado e com a fonte do sistema aumentada.
- O link do garçom bloqueia o zoom com os dedos. Por isso letra de 16px nos itens e nos campos é obrigação, não enfeite.
- Não há executor de testes no projeto, mas há o costume de scripts de prova (scripts/teste-*.mjs). Criar a prova da conta da mesa e, antes de cada publicação, seguir o roteiro com a Mesa 5 de teste (scripts/e2e-seed-mesa.cjs na branch): lançar para a mesa e para uma pessoa, cancelar um pedido, dar desconto, desmarcar taxa, imprimir comanda, fechar conta e comparar os valores.
- Não fazer tudo de uma vez num arquivo de mais de 3.100 linhas. Uma fase por vez, cada uma publicável sozinha, e as telas novas em componentes próprios.
- Chip de pessoa: o campo de renomear hoje fica dentro do chip. Transformar o chip em botão exige levar o renomear para o menu da pessoa (campo dentro de botão é HTML inválido).
- A coluna nova contra pedido duplicado muda o banco em produção. Fazer em entrega separada, com backup, sem mexer no cálculo de preço nem na fila de impressão da cozinha.
- A mudança de lugar dos botões (Imprimir e Mudar de mesa no '...', Conta embaixo, 'Salvar % como padrão' no Fechar Conta) precisa de aviso à equipe com prints ou vídeo, senão os garçons vão achar que o botão sumiu.
- Os números de linha citados são do código de hoje (master df5b8049, MesasApp.tsx com 3.106 linhas). Quem for mexer deve se localizar pelo nome da função.

## Perguntas para o Douglas

- Desconto: vale a versão que está no ar (garçom pode dar, fica só no aparelho até fechar, taxa sobre o valor já descontado) ou a da branch feat/desconto-balcao-mesa (só a loja dá, fica gravado na mesa, sai na comanda impressa, taxa sobre o consumo cheio)? Isso decide se o TOTAL da tela da Mesa mostra o desconto em qualquer aparelho.
- Na conta da mesa, qual taxa vale: a padrão da loja (10%) ou a comissão do garçom que abriu a mesa? Hoje a tela usa uma e a comanda impressa usa a outra.
- O garçom pode desligar a taxa pelo celular, ou isso fica só no Fechar Conta (ou só para o caixa e o gerente)? A proposta tira a troca da taxa da tela da mesa, o que desfaz uma escolha recente sua.
- O garçom pode cancelar pedido já enviado e tirar pessoa da mesa, ou isso deveria ser só do gerente?
- Posso partir da branch feat/mesa-celular-tablet (voltar do celular e rascunho já testados) para a Fase 1? O rascunho deve ser só por mesa (se o garçom A começa e o B continua no mesmo tablet) ou por mesa e garçom?
- Quais aparelhos esse cliente usa: modelo do celular (Android ou iPhone) e tamanho do tablet? O tablet fica em pé ou deitado na maior parte do tempo? Algum garçom usa o celular deitado?
- As lojas costumam ter foto nos produtos? Se a maioria não tem, o cardápio em lista vira o padrão também no tablet.
- Quantas mesas tem a casa desse cliente, quantos garçons atendem ao mesmo tempo e quantas pessoas cabem na maior mesa? Um garçom atende só as mesas dele ou todos atendem todas?
- Os garçons costumam anotar o nome de cada pessoa da mesa, ou quase sempre é 'mesa dividida'? Se pessoa é pouco usada, a faixa de pessoas pode ficar mais discreta.
- Depois de enviar um pedido, o garçom prefere voltar para a tela da mesa (para conferir) ou direto para o mapa?
- A cozinha já recebe e imprime a observação do item ('sem cebola')? Quer uma lista de observações rápidas que cada loja configura?
- Pode colocar 'Imprimir comanda', 'Mudar de mesa' e 'Liberar mesa' dentro de um menu '...', e o 'Salvar % como padrão da loja' dentro do Fechar Conta, para dar espaço à lista e ao total?
- Quando o garçom abre uma mesa, faz sentido perguntar 'quantas pessoas?' logo de cara, ou atrapalha?
- Topa mostrar ao cliente os prints da Fase 1 antes de começar a Fase 2, para confirmar que resolve o 'muito pequeno'?

## Revisão do crítico

Afirmações conferidas no código: 25 (2 não conferiram e foram tiradas do plano).

| Afirmação | Confere | Evidência |
|---|---|---|
| O aviso flutuante (toast) só é desenhado na tela do mapa; na tela de lançar pedido nenhum aviso aparece, nem o erro de envio. | sim | MesasApp.tsx:3091-3101 ({toast && ...}) fica dentro do return da grade, que começa em :1642. O return da tela de pedido (:1318-1640) não tem {toast}. Com essa tela aberta, showToast é chamado em :1043 (toque no produto), :803 e :805 (erro ao enviar), :634 (+ Pessoa) e :263 (rota proibida). |
| '← Voltar' apaga o carrinho sem perguntar, e o módulo não usa histórico nem armazenamento no aparelho. | sim | MesasApp.tsx:1351 onClick={() => { setView("grid"); setCart([]); ... }}. Grep por pushState/popstate/localStorage/sessionStorage/scrollIntoView em MesasApp.tsx: 0 ocorrências. O padrão já existe em ComboModal.tsx:135-143. |
| 'Lançar para' só volta para Mesa quando a pessoa é removida ou quando se troca de sessão; o '+ Novo Pedido' e o envio não zeram a escolha. | sim | setPessoaAtiva(null) só aparece em MesasApp.tsx:660 e :670. Não é chamado em :1865 (+ Novo Pedido), nem em :786-790 (envio com sucesso), nem em :1351 (Voltar). O atalho pela pessoa fixa o dono em :3031. |
| O desconto é um estado único da tela, só volta a zero no botão de cancelar desconto, e o fechamento não o zera. Por isso vale na próxima mesa. O plano também diz para zerar 'desconto (e gorjeta) ao fechar'. | sim | Estado em MesasApp.tsx:385-386. O único reset é :2471 (setDesconto(SEM_DESCONTO)). closeSession (:906-953) não zera desconto nem mostrarDesconto, mas manda desconto em :929. Correção: a GORJETA já é zerada ao fechar (:937, setWaiterTip(0)). Ela só não é zerada ao trocar de mesa sem fechar. |
| 'Imprimir comanda' no painel manda a taxa sugerida sem olhar se a taxa está marcada; o Fechar Conta manda a taxa da tela. | sim | MesasApp.tsx:1877 imprimirConta(taxaSugeridaDaMesa(selectedTable)) contra :2805 imprimirConta(useServiceFee ? serviceFee : 0, waiterTip). taxaSugeridaDaMesa em :819-828 usa a comissão do garçom. Detalhe que o plano não tratou no conserto: NENHUMA das duas manda o desconto, e a rota nem aceita desconto. imprimir-conta/route.ts:110 chama calcularContaDaMesa(mesa, pessoas, taxaPct, gorjeta) sem o 5º parâmetro, enquanto conta/route.ts faz a leitura do desconto e o repassa. |
| O valor ao lado do nome da pessoa soma também os itens de pedidos cancelados; a conta não soma. | sim | guests/route.ts:44-62: tableGuest.findMany com include items, sem filtro de status do pedido, e total = soma de price*quantity. conta-da-mesa.ts:118 pula status CANCELADO. Cancelar só muda o status do pedido (orders/[orderId]/route.ts:145-149) e mantém os itens com tableGuestId. |
| Os valores das pessoas (carregarPessoas) só são recarregados em 5 pontos, nenhum deles depois de lançar, editar, remover ou cancelar. | sim | MesasApp.tsx:633, :645, :661, :672, :725. Não aparece em addOrderToSession (:767-808), editarQtdItem (:545-561), removerItemPedido (:563-582) nem cancelarPedidoMesa (:584-598). |
| O ✕ do chip remove a pessoa num toque, e 'Tirar da mesa' também não confirma. | sim | MesasApp.tsx:1957-1960 (onClick={() => removerPessoa(pes.id)}, cor #CBD5E1, padding 0 2px). :3069 ('Tirar da mesa' chama removerPessoa direto). removerPessoa (:648-663) não tem confirm. O servidor devolve os itens para a mesa em guests/route.ts DELETE (updateMany tableGuestId null). |
| O rótulo da taxa envolve caixinha, texto, campo % e valor, então tocar em qualquer parte liga e desliga a taxa. | sim | MesasApp.tsx:2176-2200 (<label> com checkbox em :2177-2182, campo % em :2184-2196 e valor em :2197-2199). |
| O selo 'Ver tudo/Recolher' nunca aparece, porque a regra base foi declarada depois do @media. | sim | MesasApp.tsx:171 (.mesa-comanda-acao { display: inline-flex } dentro de @media max-width 900px) contra :183-187 (display: none, fora do media, declarado depois e com a mesma especificidade). O cabeçalho inteiro alterna comandaAberta em :1532, e setComandaAberta não aparece em mais nenhum lugar. |
| O uid da linha do carrinho usa prev.length e pode repetir depois de uma remoção. | sim | MesasApp.tsx:1055 (o plano cita :1054): uid = `${item.id}-${prev.length}-${dono // "mesa"}`. Combos entram sempre como linha nova (:1056-1057), e o modal de combo repete addToCart qty vezes (:1291-1293). |
| O campo de quantidade vira 1 quando é apagado, e digitar 3 dá 13. | sim | MesasApp.tsx:1597: Math.max(1, Math.min(99, Math.floor(Number(e.target.value) // 1))). |
| A busca não ignora acento, olha só o nome e respeita a categoria marcada. | sim | MesasApp.tsx:1193-1202: m.name.toLowerCase().includes(menuSearch.toLowerCase()) && matchCat. |
| A busca tem foco automático, e o fontSize 14 escrito no próprio campo ganha da regra de 16px. | sim | MesasApp.tsx:1373 (autoFocus) e :1377 (fontSize: 14 inline) contra a regra de :204 (.mesa-lancar input { font-size: 16px }) dentro de pointer:coarse. |
| O botão de quantidade do item lançado tem altura 30 escrita no próprio botão, que anula a regra de 44px do toque. | sim | MesasApp.tsx:2061 (minHeight: 30 inline) contra :203 (.mesa-detalhe button { min-height: 44px }). O onMouseEnter que deixa a borda grudada fica em :1496. |
| No tablet deitado o painel tem 300px e a coluna do carrinho 290px (@media até 1180px). | sim | MesasApp.tsx:151 (@media max-width 1180px), :152 (.mesa-lancar 1fr 290px), :154 (.mesa-detalhe width 300px). Foto tablet-paisagem-2: painel de x=880 a 1180. |
| O Total do painel soma só consumo e taxa, sem desconto. | sim | MesasApp.tsx:2231: fmt(sessionTotal + (useServiceFee ? sessionTotal * serviceFee / 100 : 0)). O valor da taxa em :2198 também usa sessionTotal cheio. |
| Ao trocar de mesa a lista antiga não é limpa, e a busca não confere a mesa nem mostra erro (o plano cita :1756-1757 e :515-523). | sim | As linhas certas são MesasApp.tsx:1754-1755 (setSelectedTable + fetchSessionDetail, sem setSessionDetail(null)) e :512-519 (fetchSessionDetail com catch silencioso, sem conferir o id). Só o ✕ (:1851), freeTable (:755) e closeSession (:936) limpam sessionDetail. |
| A janela de Fechar Conta usa 92vh e vai ter o mesmo ajuste 'já feito na tela de lançar'. | **não** | O 92vh confere (MesasApp.tsx:2439). A referência está errada: o ajuste para dvh foi feito na tela do MAPA (.mesa-tela, MesasApp.tsx:138) e no ComboModal (ComboModal.tsx:786, 94dvh). A tela de lançar não usa dvh: ela é position fixed com inset 0 (:1339-1341). |
| Não existe teste automático no projeto. | **não** | De fato não há executor de testes nos scripts do package.json (dev/build/start/lint). Mas o projeto tem o costume de scripts de prova em scripts/teste-*.mjs (ex.: scripts/teste-desconto-manual.mjs, scripts/teste-rateio-nota.mjs), e a branch feat/mesa-celular-tablet (8f53c615) já traz scripts/teste-voltar-e-rascunho-da-mesa.mjs com 30 casos. Falta um script de prova para a conta da mesa (tela, conta, fechamento e impressão dando o mesmo total). |
| O servidor transforma em 'da mesa', sem avisar, um item cuja pessoa não existe mais. | sim | add-order/route.ts:119-127 (idsValidos só com pessoas desta mesa) e :160 (tableGuestId inválido vira null). A resposta não informa que isso aconteceu. |
| Quando outro garçom abre a mesma mesa, aparece uma mensagem em inglês. | sim | table-sessions/route.ts:94 e :134 ('Table already has an open session'). No cliente, MesasApp.tsx:730-731 mostra err.error e não recarrega o mapa. |
| O ComboModal já tem o modo de produto simples e cuida do próprio voltar do celular. | sim | ComboModal.tsx:94-96 (modo PRODUTO SIMPLES) e :753 ('Adicionar à sacola' / 'Confirmar item', texto de cliente). ComboModal.tsx:135-143: faz pushState ao abrir e, no fechamento pelo X ou pelo confirmar, chama history.back() dentro do cleanup (:142). O popstate dessa volta chega DEPOIS de o modal já ter saído da tela. Ele é usado também em store/venda-presencial/page.tsx e CustomerStorePage.tsx. |
| O link do garçom bloqueia o zoom com os dedos. | sim | src/app/garcom/layout.tsx:13-19 (maximumScale 1, userScalable false). O comentário diz que evita o 'puxar para atualizar', mas não há overscroll-behavior: o totem faz isso em totem/[slug]/layout.tsx:34-37 e o garçom não. |
| '+ Pessoa' pode 'já deixar a pessoa nova escolhida' (afirmação de viabilidade usada no conserto). | sim | Hoje não seleciona: MesasApp.tsx:626-635 não chama setPessoaAtiva. Para selecionar, a tela precisa do id da pessoa criada. POST {quantidade} devolve só {criados} (guests/route.ts:95). POST {name} devolve {guest:{id,name}} (:107) e cria 'Cliente N' quando o nome vem vazio. O conserto deve usar o segundo formato. |

### O que faltava no primeiro plano (já incluído acima)

- TRABALHO JÁ FEITO QUE O PLANO IGNORA: a branch feat/mesa-celular-tablet (8f53c615, não publicada) já tem src/lib/voltar-em-camadas.ts, src/components/mesas/useVoltarDoCelular.ts e src/lib/rascunho-da-mesa.ts, com 30 casos de teste e scripts/e2e-seed-mesa.cjs (nota do vault Claude/firehub-mesa-celular-tablet.md). O plano manda fazer 'voltar' e 'rascunho' do zero na Fase 3. Isso deve partir dessa branch e entrar junto com as telas cheias. O rascunho da branch é guardado por sessão (chaveDoRascunho(sessionId)), não por 'mesa e garçom' como diz o plano.
- ORDEM DAS FASES: publicar a Mesa em tela cheia (Fase 1) sem o voltar do celular (Fase 3) PIORA o Android. Hoje o voltar sai do módulo a partir do mapa. Com a tela cheia, o garçom 'dentro da mesa' faz o gesto de voltar e sai do sistema. O voltar em camadas precisa ir na mesma entrega de cada tela cheia.
- DUAS VERSÕES DE DESCONTO: no master (85ef5c3f) o desconto vive só na memória do aparelho, a taxa incide sobre o consumo JÁ descontado e o garçom pode dar desconto. A branch feat/desconto-balcao-mesa (b6407264, não publicada) grava o desconto na sessão, calcula a taxa sobre o consumo cheio, só a loja dá desconto (garçom recebe 403) e o desconto sai na conta impressa. O plano quer um 'TOTAL com desconto vindo do servidor', mas no master o servidor não conhece o desconto antes de fechar. Nada disso foi citado.
- Conta por pessoa não recalcula quando o desconto muda: o efeito de MesasApp.tsx:1257-1269 depende de taxa, gorjeta e mesa, mas não de desconto. carregarConta (:612-622) é useCallback com [] e usa paramsDoDesconto da primeira renderização. Resultado: 'Conta por pessoa' e '+ pagar' ficam sem o desconto, enquanto o total de baixo já desconta.
- A taxa desmarcada (useServiceFee) nunca volta a marcada: ela só muda pelas caixinhas (:2180 e :2521). A mesa seguinte, e até depois de fechar, abre 'sem taxa' no painel e no Fechar Conta. O plano só zera desconto e gorjeta.
- Retry sem proteção: a faixa vermelha 'Tentar de novo' da Fase 0 chega antes da proteção contra pedido duplicado (Fase 4). Num erro de rede depois de o servidor gravar, o retry manda o pedido de novo para a cozinha e para a conta. Faltou uma proteção barata na Fase 0 (conferir a mesa antes de reenviar) e antecipar a coluna de proteção.
- Cardápio que não carrega: fetchMenu engole o erro (MesasApp.tsx:527) e a grade fica vazia, sem mensagem. Faltou o estado 'Cardápio não carregou · Tentar de novo', além do 'Nada encontrado' da busca.
- Celular deitado (844x390): pela conta do diagnóstico o cardápio fica com 0px. O plano não diz o que acontece com o celular na horizontal.
- Estados vazios da tela da Mesa: mesa aberta sem pedido ('Nenhum pedido ainda · + Pedido'), mesa sem pessoas (hoje há o atalho 2p/3p/4p em :1907-1916, que o plano não carrega para a tela nova) e barra 'Ver pedido' escondida com carrinho vazio.
- Mesa com muitas pessoas (8 a 20; o servidor cria até 20 de uma vez em guests/route.ts:88): a faixa horizontal de chips mostra 3 ou 4. Faltou um 'Todas (12) ▾' que abre uma folha com grade de nomes, tanto na Mesa quanto no 'Lançando para'.
- Produto COM foto x SEM foto no modo lista do celular: o plano só diz 'sem desenho quando não há foto' no tablet. Faltou a regra da lista: miniatura de 48px à esquerda quando há imageUrl, nada quando não há.
- Combo no cardápio em lista: o '-' da linha é ambíguo quando o produto tem várias linhas (combos com escolhas diferentes, item com observação, donos diferentes). Faltou a regra: '-' só tira a linha simples do dono escolhido. Se não houver, abre o Conferir. Combos também precisam contar no número da linha. E o combo com quantidade 3 que vira 3 linhas iguais (:1291-1293) não foi tratado: faltou juntar linhas idênticas no Conferir.
- Dois garçons editando a quantidade: a quantidade gravada é ABSOLUTA (PATCH em :548-551), então quem confirma por último apaga a correção do colega. O plano protege a folha contra a atualização de 8s, mas não contra a sobrescrita. Faltou mandar 'de X para Y' e o servidor recusar quando o item já mudou.
- Tirar pessoa que já pagou: os pagamentos guardam guestId (pagamentos/route.ts:111-137). Remover a pessoa esconde quanto ela pagou na conta por pessoa. A confirmação precisa citar pagamentos já registrados, e não só os itens.
- Dois números para a mesma pessoa: o chip mostra o consumo próprio (guests route, sem parte da mesa e sem taxa), e 'Receber da Júlia' usa o aPagar da conta (com rateio, taxa e desconto). O plano mostra 'Júlia · R$ 48,00 · [Receber da Júlia]' sem dizer qual é qual.
- Confirmações nativas: removerItemPedido, cancelarPedidoMesa, transferência e erros usam confirm()/alert() (MesasApp.tsx:547-596, :2771). O plano fala em 'confirma com texto claro', mas não diz para trocar por janela própria. Em navegador embutido de app (link aberto pelo WhatsApp) essas caixas podem nem aparecer.
- Puxar para atualizar: o layout do garçom não tem overscroll-behavior (garcom/layout.tsx), ao contrário do totem. O plano conta com o rascunho para salvar, mas não impede a recarga.
- Voltar a partir do mapa no link do garçom: o login usa location.assign (LoginDoGarcom.tsx:60), então o voltar vai ao login, que redireciona de volta para /mesas e recarrega tudo. Com location.replace o voltar sai de verdade.
- Mensagens de código interno: freeTable mostra err.error (MesasApp.tsx:760), que no close é 'pagamento_incompleto'. O closeSession já usa err.mensagem (:948).
- Polling pesado: fetchTables roda a cada 8s também com a tela de lançar aberta e com a aba em segundo plano, e traz todos os itens de todas as mesas (tables/route.ts:12-26). O plano só pausa a atualização da tela da Mesa.
- Custo de render do cardápio (L22 do diagnóstico): cada card recalcula preço e grupos do combo a cada toque (:1486-1518). Numa loja de 186 produtos em celular barato isso vira atraso e toque duplo. O plano não trata.
- Categorias 'na ordem da loja': existe MenuCategory.sortOrder (prisma/schema.prisma:547-558), mas a tela ordena por nome (:524) e a rota do cardápio não manda a ordem. É preciso incluir isso na rota.
- ComboModal para o garçom: o plano proíbe mudar a janela, mas quer abrir o modo produto simples, que diz 'Adicionar à sacola' (ComboModal.tsx:753), e o 'Lançando para: MARCOS' fica escondido atrás dela (zIndex 9999). Faltou prever props OPCIONAIS (texto do botão, 'para Marcos · Mesa 5', esconder a foto grande) que por padrão deixam o cliente e a venda presencial exatamente como hoje.
- 'Salvar X% como padrão da loja' (MesasApp.tsx:2201-2223, só modo loja) mora no rodapé do painel. Com a taxa só-leitura na tela da Mesa, esse botão precisa de outro lugar (Fechar Conta ou configuração), senão some sem ninguém decidir.
- Chip de pessoa com renomear: hoje o input de renomear fica DENTRO do chip (:1932-1946). Transformar o chip inteiro em <button> com um input dentro é HTML inválido. O renomear precisa ir para a janela da pessoa.
- Letra grande do sistema (Android com fonte do sistema aumentada): com nome de 16px, quantidade e '- N +' na mesma linha, a linha quebra. Faltou testar com escala de fonte 1,3.

### Conflitos com as regras de dinheiro

- Comanda impressa x fechamento, com desconto: o conserto 'mesma taxa da tela' não basta. Com desconto dado no Fechar Conta, o papel sai SEM desconto, porque imprimir-conta/route.ts:110 chama calcularContaDaMesa sem o parâmetro de desconto e a tela não manda (MesasApp.tsx:1877 e :2805). O cliente recebe um papel maior que o valor do fechamento. O conserto precisa mandar o desconto e a rota precisa aceitá-lo com a mesma leitura de conta/route.ts, que recalcula do tipo e do valor e nunca aceita número pronto.
- Conta por pessoa x total do fechamento: mudar o desconto não refaz o rateio (deps em MesasApp.tsx:1269 sem desconto; carregarConta :612-622 com closure velha). '+ pagar' preenche o valor da pessoa sem desconto (:2568), a soma das pessoas passa do total e aparece troco falso. Precisa entrar na Fase 0.
- Taxa que 'vaza' entre mesas: useServiceFee é um estado único e nunca volta a marcado. Desmarcar a taxa na Mesa 5 faz a Mesa 3 fechar sem taxa se ninguém reparar. Isso quebra 'tela, conta e fechamento iguais' do ponto de vista da loja. Zerar só desconto e gorjeta, como diz o plano, deixa essa falha.
- TOTAL grande 'vindo do servidor com desconto' (cuidado 2 e Fase 1) contradiz o master: no master o desconto só existe na memória de UM aparelho até o fechamento. Outro garçom, o caixa e a comanda impressa não o veem. Ou se decide gravar o desconto na sessão (o que a branch b6407264 já faz, com outra regra de taxa e só a loja dando desconto), ou o TOTAL da Mesa mostra 'sem desconto' e o desconto aparece só no Fechar Conta. Não dá para prometer as duas coisas.
- Regra da taxa em conflito entre versões: master calcula a taxa sobre o consumo descontado (conta-da-mesa.ts:161-166 e close/route.ts:74-76). A branch b6407264 calcula sobre o consumo cheio ('a comissão do garçom não cai'). Adotar a branch sem decidir isso muda o valor cobrado de todas as mesas com desconto.
- Retry antes da proteção: a faixa 'Não foi enviado · Tentar de novo' (Fase 0) sem idempotência (Fase 4) duplica pedido na cozinha e na conta quando o erro foi de rede depois de gravar (add-order/route.ts:130-165 cria o pedido a cada POST). Na Fase 0, num erro de rede (catch), reler a mesa e só oferecer reenviar se não apareceu pedido novo com esses itens. Num erro com resposta do servidor (4xx/5xx), reenviar é seguro.
- Quantidade absoluta entre aparelhos: a folha do item grava 'fica com N' (orders/[orderId]/route.ts:83-87). Com dois garçons ou o caixa, a confirmação de um apaga a do outro, e a comanda cobra a quantidade errada. A regra 'só grava ao confirmar' continua valendo, mas precisa mandar a quantidade que o garçom viu e o servidor recusar se já mudou.
- Troca de dono no Conferir e remoção de pessoa: item com dono é da pessoa, sem dono entra no rateio. O servidor transforma dono inválido em 'da mesa' em silêncio (add-order/route.ts:160). Com rascunho guardado ou dois aparelhos, a pessoa pode ter sido removida e o item cai no rateio sem aviso. Antes de enviar, conferir as pessoas atuais e pedir um dono.
- Remover pessoa com pagamento registrado: os itens vão para o rateio e o pagamento dela continua gravado com um guestId que não existe mais. A confirmação precisa mostrar isso, e o ideal é bloquear ou avisar quando houver pagamento em nome dela.
- Rótulos de valor por pessoa: o chip 'Júlia R$ 48,00' (consumo próprio, que hoje ainda soma cancelados) e 'Receber da Júlia R$ 52,80' (aPagar, com rateio, taxa e desconto) são números diferentes com o mesmo nome. Rotular 'consumiu' e 'paga', senão o garçom cobra o valor errado.
- Rascunho restaurado: o preço guardado no aparelho não pode ir para a tela como verdade. Ao restaurar, recalcular unitPrice a partir do cardápio atual e avisar item que saiu do cardápio, porque o servidor recusa o pedido inteiro nesse caso (add-order/route.ts:106-112).
