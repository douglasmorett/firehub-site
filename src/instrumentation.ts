/**
 * Roda UMA vez quando uma instância nova do servidor sobe, e o Next só começa
 * a aceitar requisições depois que isto termina. É essa garantia de ordem que
 * este arquivo compra.
 */
export async function register() {
  // Só no runtime Node de um servidor de verdade — nunca no edge e nunca
  // durante o `next build` (os workers de prerender não precisam de DDL).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // ── CONEXÃO PARA FORA NÃO DESISTE EM 250 ms ────────────────────────────────
  //
  // O Node 20 tenta cada endereço do destino (IPv4/IPv6) por no máximo 250 ms.
  // Esse relógio corre no mesmo laço que atende os painéis: no pico de sábado
  // 17/10/2026 o laço andou 100–450 ms atrasado (68 requisições/s), cada
  // tentativa "venceu" antes de o Node ver a resposta e TODA chamada para fora
  // virou `fetch failed` / `connect ETIMEDOUT` — Gemini, iFood, Brendi,
  // Nominatim. O robô passou a dizer "instabilidade" em 14 lojas. Com 3 s por
  // endereço, o atraso do laço não derruba mais a conexão; a que funcionava
  // continua igual. Aplicado ao vivo naquela noite (setDefault… pelo inspector).
  const net = await import("node:net");
  net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

  // Computador da loja (modo contingência): nada sai para fora — antes do DDL
  // e do primeiro request (lib/modo-local.ts).
  if (process.env.FIREHUB_LOCAL === "1") {
    const { instalarBloqueioDeSaida } = await import("./lib/modo-local");
    instalarBloqueioDeSaida();
  }

  // As duas tabelas que coordenam os servidores entre si ("BootDDL" e "Vez",
  // lib/ddl-do-boot.ts) ANTES de toda DDL abaixo: é com elas que um grupo de
  // instruções já aplicado neste banco é pulado, e que dois boots ao mesmo
  // tempo não aplicam o mesmo grupo juntos. Nunca lança — sem elas, a DDL roda
  // como sempre rodou.
  const { garantirTabelasDeCoordenacao } = await import("./lib/ddl-do-boot");
  await garantirTabelasDeCoordenacao();

  // No `docker stop` do deploy, devolve a vez do cron (api/cron/lideranca)
  // para o container novo assumir na próxima pergunta dele (~30 s), em vez de
  // esperar os 90 s da vez vencerem. Tentativa só: se não der tempo antes de o
  // Next sair, a vez vence sozinha. Fora do computador da loja.
  if (process.env.FIREHUB_LOCAL !== "1") {
    const { soltarALiderancaAoDesligar } = await import("./lib/vez");
    soltarALiderancaAoDesligar();
  }

  const {
    garantirColunasDePreco,
    garantirColunasDoSchema,
    garantirColunasBrendi,
    garantirColunasWabiz,
    garantirEstruturaDeLotes,
    garantirEstruturaDeCaixa,
    garantirEstruturaDeMesa,
    garantirEstruturaDePrazos,
    garantirEstruturaDoCrm,
    garantirEstruturaDeDespesas,
    garantirEstruturaDeAcompanhamento,
  } = await import("./lib/garantir-colunas");
  await garantirColunasDePreco();
  // As colunas que o schema.prisma declara e que nunca ganharam DDL — 39 no
  // levantamento de 03/09/2026, entre elas as que o cardápio público lê e as
  // que todo pedido novo grava. Precisa vir ANTES do primeiro request, que é
  // a única ordem que impede o 500 de "campo no schema, coluna ausente".
  await garantirColunasDoSchema();
  // Colunas brendi* no banco ANTES de qualquer rota da integração rodar —
  // elas ainda não estão no schema.prisma, então o boot é quem garante a ordem.
  await garantirColunasBrendi();
  // Mesma regra para as colunas wabiz* (usuário/senha da loja na Wabiz).
  await garantirColunasWabiz();
  // Tabela StockLot e as colunas de rastreio ANTES de o schema.prisma que as
  // declara ser consultado — é a ordem que impede o 500 de "campo no schema,
  // coluna ausente". Se falhar, `temEstruturaDeLotes()` desliga só o recurso
  // de validade e o resto do estoque segue inteiro.
  await garantirEstruturaDeLotes();
  // Sangria e reforço de caixa. Sem a tabela, o esperado do fechamento ignora
  // todo dinheiro que entrou ou saiu no meio do turno.
  await garantirEstruturaDeCaixa();
  // Acesso do garçom (login na tabela Waiter), quem fechou a mesa e a tabela
  // PrintRequest da conta impressa. Vem antes do primeiro request porque o GET
  // da fila de impressão — que todo Assistente chama a cada 3 s — lê uma das
  // colunas novas: sem ela, a comanda de mesa e de balcão pararia em todas as
  // lojas de uma vez.
  await garantirEstruturaDeMesa();
  // Conta da extensão FireHub Prazos (produto vendido fora do FireHub). Tabela
  // própria, sem relação com User: se faltar, só o login da extensão falha.
  await garantirEstruturaDePrazos();
  // CRM do FireHub: contatos, conversa do número do FireHub e agenda da
  // equipe. Tabelas próprias; se faltarem, só o CRM para.
  await garantirEstruturaDoCrm();
  // Loja extra criada antes de 01/10/2026 fica com o vendedor e o embaixador
  // da principal. Uma vez só (a marca mora na CrmConfig, por isso depois dela).
  const { acertarLojasExtrasUmaVez } = await import("./lib/loja-extra-da-conta");
  await acertarLojasExtrasUmaVez();
  // Despesas lançadas à mão no DRE. Se faltar, só o lançamento manual some.
  await garantirEstruturaDeDespesas();
  // Bill (estoque e financeiro pelo WhatsApp do dono). Tabelas
  // próprias; se faltarem, só o assessor para.
  const { garantirEstruturaDoAssessor } = await import("./lib/assessor/estrutura-no-banco");
  await garantirEstruturaDoAssessor();
  // Clientes e relatórios do Acompanhamento iFood (aba do admin). Tabelas
  // próprias; se faltarem, só essa aba para.
  await garantirEstruturaDeAcompanhamento();
  // CMV real: contagem, preparos, custo por movimento, compra ligada à conta a
  // pagar e folha (lib/cmv/estrutura-no-banco.ts). Colunas novas em StockItem,
  // StockTransaction, StockInvoice e Payable: faltando, o estoque serve 500.
  const { garantirEstruturaDoCmv } = await import("./lib/cmv/estrutura-no-banco");
  await garantirEstruturaDoCmv();
  // Pausa pelo estoque (lib/pausa-pelo-estoque.ts): o interruptor da loja e
  // a marca do produto pausado pelo estoque. Tabelas próprias; se faltarem, só
  // a pausa automática para.
  const { garantirEstruturaDaPausaPeloEstoque } = await import("./lib/pausa-pelo-estoque-no-banco");
  await garantirEstruturaDaPausaPeloEstoque();
  // Disparo oficial (API da Meta, lib/disparo-oficial). Tabelas próprias; se
  // faltarem, só essa tela para.
  const { garantirEstruturaDoDisparoOficial } = await import("./lib/disparo-oficial/estrutura-no-banco");
  await garantirEstruturaDoDisparoOficial();
  // Lançamentos de cashback à mão (aba Clientes). Tabela própria por SQL cru;
  // se faltar, o saldo segue o dos pedidos e só o lançamento falha.
  const { garantirTabelaDeAjustes } = await import("./lib/cashback-no-banco");
  await garantirTabelaDeAjustes();
  // Acréscimo que o cliente pede pelo robô e a loja aceita no pop-up. Se
  // faltar, o robô volta a chamar atendente para pedido já na cozinha.
  // Indique e Ganhe entre lojistas: quem indicou cada loja e o crédito de
  // R$ 100 (lib/indique-e-ganhe-no-banco.ts). Tabela própria por SQL cru; se
  // faltar, a mensalidade sai sem o desconto, como antes do programa.
  const { garantirTabelaDeIndicacoes } = await import("./lib/indique-e-ganhe-no-banco");
  await garantirTabelaDeIndicacoes();
  const { garantirTabelaDeAcrescimos } = await import("./lib/acrescimo-no-banco");
  await garantirTabelaDeAcrescimos();
  // Diária mudada num dia e pendências do acerto do motoboy
  // (lib/ajustes-do-acerto.ts). Tabelas próprias por SQL cru, fora do schema;
  // se faltarem, o acerto sai sem os ajustes e só gravar um ajuste falha.
  const { garantirTabelasDoAcerto } = await import("./lib/ajustes-do-acerto");
  await garantirTabelasDoAcerto();
  // Senha do gerente (lib/senha-do-gerente.ts) e a conta de mesa lançada no
  // fiado (lib/fiado-da-mesa.ts). Tabelas próprias por SQL cru, fora do
  // schema; se faltarem, nenhuma ação pede senha e a mesa não vai para o
  // fiado — o resto segue como antes.
  const { garantirTabelaDaSenhaDoGerente } = await import("./lib/senha-do-gerente");
  await garantirTabelaDaSenhaDoGerente();
  const { garantirTabelaDoFiadoDaMesa } = await import("./lib/fiado-da-mesa");
  await garantirTabelaDoFiadoDaMesa();
  // Posição que a loja ensinou para um endereço na roteirização (o operador
  // arrastou o pino; lib/ponto-aprendido.ts). Tabela própria por SQL cru; se
  // faltar, a roteirização segue como antes e só deixa de aprender.
  const { garantirTabelaDePontosAprendidos } = await import("./lib/ponto-aprendido");
  await garantirTabelaDePontosAprendidos();
  // Memória da conversa do robô (ChatbotConversationState.history). O schema NÃO
  // conhece a coluna de propósito — o acesso é por SQL cru e falha em silêncio
  // (lib/memoria-da-conversa-no-banco.ts). Aqui é só para o ALTER acontecer no
  // boot, e não na primeira mensagem de um cliente.
  const { garantirColunaDaMemoria } = await import("./lib/memoria-da-conversa-no-banco");
  await garantirColunaDaMemoria();
  // O estado do robô que o painel lê e muda — pausa, fila de atendimento
  // humano, saúde da IA, eco do número do FireHub (lib/robo-no-banco.ts).
  // Tabelas próprias por SQL cru; se faltarem, cada módulo segue pela memória
  // do processo, como antes (certo com um servidor só). Nunca lança.
  const { garantirTabelasDoRobo } = await import("./lib/robo-no-banco");
  await garantirTabelasDoRobo();
  // Modo Contingência: as tabelas e o diário da cópia das lojas ativadas
  // (lib/contingencia/estrutura-no-banco.ts). Nunca lança e não roda no
  // computador da loja.
  const { garantirEstruturaDaContingencia } = await import("./lib/contingencia/estrutura-no-banco");
  await garantirEstruturaDaContingencia();
  // Loja sem conexão (User.semConexaoEstado): o estado da queda e o que o
  // FireHub pausou. O schema NÃO conhece a coluna de propósito — o acesso é por
  // SQL cru e falha em silêncio (lib/loja-sem-conexao-no-banco.ts): sem ela, a
  // proteção não age, como antes de existir.
  const { garantirColunaDaLojaSemConexao } = await import("./lib/loja-sem-conexao-no-banco");
  await garantirColunaDaLojaSemConexao();
}
