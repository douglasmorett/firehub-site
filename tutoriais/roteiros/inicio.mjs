// Tutorial de boas-vindas: um passeio pelo painel (/store, a tela Início).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever:
// - o login do lojista cai em /store, que é a tela Início (app/login);
// - a Início (StoreDashboard) mostra, de cima para baixo: a "Sua jornada
//   FireHub" (OnboardingChecklist — some sozinha quando a loja cumpre os passos;
//   cada tarefa tem o botão "Ir", um link para a tela dela), os botões de período
//   (Hoje, Ontem, 7 dias, Mês, Período), os cinco cartões (faturamento, pedidos,
//   ticket médio, clientes, lucro líquido), formas de pagamento, status dos
//   pedidos, o mapa de calor das entregas, pedidos por hora, top produtos e os
//   últimos pedidos;
// - o menu (lib/menu-do-painel.ts) tem cinco grupos, nesta ordem: Operação,
//   Cardápio & vendas, Gestão, Equipe e Configurações. "Minha loja" tem uma
//   setinha que abre as telas de dentro; a seta redonda do alto recolhe o menu
//   para só os ícones (StoreSidebar), e o mesmo botão o traz de volta;
// - na barra do topo (StoreTopNav): "Caixa aberto" abre o menu do caixa
//   (entrada, saída/sangria, encerrar) e, com o caixa fechado, a abertura;
//   "Site aberto" abre a pausa do site, e com ele fechado o painel avisa "Clientes
//   não conseguem fazer pedidos"; "Ver cardápio" abre uma lista com Copiar link,
//   Baixar QR Code e Abrir o cardápio; o ícone da impressora leva a Impressoras e
//   o botão Integrações à Central de Integrações (iFood, 99Food e outros).
//
// As chaves do caixa e do site são só apontadas: clicar nelas abriria o
// fechamento do caixa e a pausa da loja, que são assunto dos vídeos de Caixa e
// de Horários. Totem e Tráfego pago (EM TESTES) e Checklist e ponto (FireCheck)
// aparecem no menu, mas a fala não os cita e o destaque não os inclui.
//
// Duas coisas que a gravação arruma, e por quê:
// - a lista de "Ver cardápio" mostra o endereço do cardápio com o domínio de onde
//   o painel está aberto; na gravação seria "localhost:porta", e a cena troca só
//   esse texto pelo domínio do site (ver a cena "Ver cardápio e Integrações");
// - o histórico de vendas é ajustado no `preparar` para as duas comparações que
//   aparecem ("Hoje" e "7 dias") saírem positivas (ver os comentários lá).
import { dormir } from "../motor/palco.mjs";
import { criarHistorico, cadastrarCustos, relogioDaLoja } from "./_historico-comum.mjs";

const MIN = 60_000, DIA = 86_400_000;

/** Onde fica a loja e cada bairro no mapa de calor (ruas do centro de Ribeirão Preto, como na Roteirização). */
const LOJA_NO_MAPA = { lat: -21.17, lng: -47.81 };
const BAIRRO_NO_MAPA = {
  "Centro": [-21.1742, -47.8092],
  "Vila Nova": [-21.1805, -47.8178],
  "Jardim América": [-21.1848, -47.8012],
  "Santa Luzia": [-21.1622, -47.8015],
  "Parque das Flores": [-21.1604, -47.8212],
};

/** Vendas a mais na noite de hoje (minutos atrás), usadas só até o dia de hoje passar um pouco o de ontem. */
const NOITE_DE_HOJE = [
  [142, "Renata Dias", "Rua Bela Vista, 214 - Centro", 5, "PIX", [["X-Tudo", 2], ["Coca-Cola lata", 2]]],
  [127, "Hugo Antunes", "Rua dos Ipês, 61 - Vila Nova", 6, "CREDITO", [["Pizza Calabresa", 1], ["Guaraná 2 L", 1]]],
  [118, "Cíntia Moraes", null, 0, "Dinheiro", [["X-Bacon", 1], ["Batata Frita", 1], ["Coca-Cola lata", 1]]],
  [96, "Jorge Batista", "Av. Central, 730 - Jardim América", 7, "PIX", [["Pizza Marguerita", 1], ["Coca-Cola lata", 2]]],
  [84, "Luana Prado", "Rua São José, 48 - Centro", 5, "DEBITO", [["X-Burger", 2], ["Batata Frita", 1]]],
  [61, "Mateus Farias", "Rua da Paz, 305 - Santa Luzia", 8, "PIX", [["X-Tudo", 1], ["X-Bacon", 1], ["Guaraná 2 L", 1]]],
  [52, "Érica Sales", null, 0, "PIX", [["Pizza Calabresa", 1]]],
  [47, "Davi Queiroz", "Rua das Acácias, 412 - Centro", 5, "DINHEIRO", [["X-Bacon", 2], ["Coca-Cola lata", 2]]],
];

/**
 * A loja com movimento: as vendas das últimas semanas (o histórico comum aos
 * vídeos de Financeiro e Relatórios), o custo de cada produto (para o lucro do
 * resumo não ser o faturamento inteiro) e o ponto de cada entrega no mapa.
 *
 * O ponto vem gravado no pedido de propósito: o mapa de calor do Início só
 * procura pelo endereço o pedido que NÃO traz o ponto, e essa procura sai do
 * servidor para um serviço de fora. Com a loja e todos os pedidos de entrega já
 * marcados, nenhuma busca de endereço acontece. De fora vêm só as imagens do
 * mapa (OpenStreetMap), como na Roteirização.
 */
async function preparar(prisma, base) {
  const { loja, produtos, motoboys } = base;
  const L = loja.id;
  await cadastrarCustos(prisma, base);
  await criarHistorico(prisma, base);
  await prisma.user.update({ where: { id: L }, data: { storeLatLng: LOJA_NO_MAPA } });

  const { meiaNoite } = relogioDaLoja();
  const dia = (n) => new Date(meiaNoite.getTime() - n * DIA);
  const vendido = async (de, ate) => (await prisma.customerOrder.aggregate({
    where: { franchiseeId: L, status: { not: "CANCELADO" }, createdAt: { gte: de, lt: ate } }, _sum: { totalAmount: true },
  }))._sum.totalAmount || 0;

  // O primeiro cartão compara o período com o anterior. Hoje às 20h contra o dia
  // INTEIRO de ontem perderia quase sempre, e o vídeo de boas-vindas abriria com
  // uma seta vermelha. Entram vendas da noite de hoje até o dia passar um pouco
  // o de ontem (em dia que já passa, não entra nenhuma).
  const ontem = await vendido(dia(1), meiaNoite);
  let hoje = await vendido(meiaNoite, dia(-1));
  for (const [i, [min, cliente, endereco, taxa, forma, linhas]] of NOITE_DE_HOJE.entries()) {
    if (hoje >= ontem * 1.06) break;
    const quando = new Date(Date.now() - min * MIN);
    const total = linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, taxa);
    await prisma.customerOrder.create({
      data: {
        franchiseeId: L, source: endereco ? "ONLINE" : "PRESENCIAL", status: "ENTREGUE", kdsStage: "FINISHED",
        customerName: cliente, customerPhone: `119666600${String(i + 1).padStart(2, "0")}`, customerAddress: endereco,
        deliveryType: endereco ? "DELIVERY" : "RETIRADA", deliveryFee: taxa, motoboyFee: endereco ? 6 : null,
        motoboyId: endereco ? (i % 2 ? motoboys.rafael.id : motoboys.carlos.id) : null, paymentMethod: forma, totalAmount: total,
        createdAt: quando, acceptedAt: new Date(quando.getTime() + MIN), readyAt: new Date(quando.getTime() + 16 * MIN),
        dispatchedAt: endereco ? new Date(quando.getTime() + 20 * MIN) : null, deliveredAt: new Date(quando.getTime() + (endereco ? 38 : 18) * MIN),
        items: { create: linhas.map(([nome, q]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity: q, price: produtos[nome].price })) },
      },
    });
    hoje += total;
  }

  // O mesmo para o botão "7 dias", que o vídeo clica: a tela compara os últimos
  // 7 dias (mais hoje) com os 7 de antes. Se a semana de antes vendeu mais, saem
  // dela alguns pedidos, um por dia em rodízio, até a semana atual passar à frente.
  const semana = await vendido(dia(7), dia(-1));
  let antes = await vendido(dia(14), dia(6));
  if (antes > semana / 1.06) {
    const candidatos = await prisma.customerOrder.findMany({
      where: { franchiseeId: L, status: "ENTREGUE", createdAt: { gte: dia(14), lt: dia(7) } },
      orderBy: { createdAt: "desc" }, select: { id: true, totalAmount: true, createdAt: true },
    });
    const porDia = Array.from({ length: 7 }, () => []);
    for (const c of candidatos) porDia[Math.min(6, Math.floor((c.createdAt.getTime() - dia(14).getTime()) / DIA))].push(c);
    const fora = [];
    for (let volta = 0; antes > semana / 1.06 && porDia.some((d) => d[volta]); volta++) {
      for (const d of porDia) {
        if (antes <= semana / 1.06) break;
        if (!d[volta]) continue;
        fora.push(d[volta].id);
        antes -= d[volta].totalAmount;
      }
    }
    await prisma.customerOrder.deleteMany({ where: { id: { in: fora } } });
  }

  // A numeração do dia segue a hora em que cada pedido chegou.
  const deHoje = await prisma.customerOrder.findMany({ where: { franchiseeId: L, createdAt: { gte: meiaNoite } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const [i, p] of deHoje.entries()) await prisma.customerOrder.update({ where: { id: p.id }, data: { dailyOrderNumber: i + 1 } });

  // O ponto de cada entrega: o do bairro, com um desvio que sai do próprio id.
  for (const [bairro, [lat, lng]] of Object.entries(BAIRRO_NO_MAPA)) {
    await prisma.$executeRawUnsafe(
      `UPDATE "CustomerOrder" SET "customerLatLng" = jsonb_build_object(
         'lat', ${lat} + ((abs(hashtext(id)) % 1000) - 500) * 0.0000085,
         'lng', ${lng} + ((abs(hashtext(id || 'x')) % 1000) - 500) * 0.0000095)
       WHERE "franchiseeId" = $1 AND "deliveryType" = 'DELIVERY' AND "customerAddress" LIKE $2`,
      L, `% - ${bairro}%`,
    );
  }
}

// ── onde as coisas estão ────────────────────────────────────────────────────
const lista = (p) => p.locator("nav.fh-menu-lista");
/** Um item do menu, pela rota ("" é o Início). */
const item = (p, rota) => p.locator(`nav.fh-menu-lista a.fh-menu-item[href="/store${rota}"]`);
const tituloDoGrupo = (p, nome) => p.locator(".fh-menu-grupo-titulo").filter({ hasText: new RegExp(`^${nome}$`) });
/** O nome do grupo e os itens que a fala cita: é o que a câmera enquadra e o destaque contorna. */
const grupo = (p, nome, rotas) => [tituloDoGrupo(p, nome), ...rotas.map((r) => item(p, r))];
const filho = (p, ancora) => p.locator(`a.fh-menu-filho[href="/store/minha-loja#${ancora}"]`);
const recolher = (p) => p.locator(".fh-menu-recolher");

const periodo = (p, nome) => p.getByRole("button", { name: nome, exact: true });
const tituloDoCartao = (p, nome) => p.getByText(nome, { exact: true }).first();
/** O cartão inteiro de um número do resumo (o título mora três níveis abaixo dele). */
const cartao = (p, nome) => tituloDoCartao(p, nome).locator("xpath=../../..");
const bloco = (p, titulo) => p.getByRole("heading", { name: titulo }).first();

const caixa = (p) => p.getByRole("button", { name: /^Caixa aberto/ });
const site = (p) => p.getByRole("button", { name: /^Site aberto/ });
const verCardapio = (p) => p.getByRole("button", { name: /Ver cardápio/ });
const impressora = (p) => p.locator('a[title="Impressora"]');
const integracoes = (p) => p.locator('a[title="Central de Integrações"]');

const OPERACAO = ["/pedidos-clientes", "/kds", "/mesas", "/venda-presencial", "/roteirizacao"];
const VENDAS = ["/cardapio", "/marketing", "/chatbot"];
const GESTAO = ["/financeiro", "/relatorios", "/fiscal", "/estoque", "/etiquetas"];
const EQUIPE = ["/motoboys", "/garcons", "/funcionarios"];
const CONFIGURACOES = ["/minha-loja", "/impressoras", "/integracoes"];

/** Rola o menu até o grupo, aproxima a câmera dele e o destaca. */
async function mostrarGrupo(palco, nome, rotas) {
  const p = palco.pagina;
  await palco.rolarAte(tituloDoGrupo(p, nome), { bloco: "start" });
  const alvo = grupo(p, nome, rotas);
  await palco.destacar(alvo, { folga: 5 });
  await palco.camera(alvo, { zoomMax: 1.75, margem: 70, ms: 600 });
}

/** A seta passa pelos itens, cada um na sua hora da fala. */
async function passear(palco, ctx, rotas, horas) {
  for (const [i, rota] of rotas.entries()) {
    await ctx.ate(horas[i]);
    await palco.mover(item(palco.pagina, rota), { ms: 420 });
  }
}

export default {
  id: "inicio",
  titulo: "Um passeio pelo painel",
  rota: "store",
  prontaQuando: "text=FATURAMENTO",
  pronuncia: { KDS: "cá dê esse" },
  preparar,

  /**
   * O botão flutuante de ajuda pulsa sem parar; o pulso repinta a tela o tempo
   * todo e atrasa os gestos. Aqui só o pulso para: o botão continua no lugar.
   * E a gravação espera o mapa de calor terminar de carregar as imagens, para
   * elas não chegarem no meio de uma cena.
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    await p.waitForFunction(() => document.querySelectorAll(".leaflet-tile-loaded").length >= 6, null, { timeout: 30_000 }).catch(() => {});
    await dormir(500);
  },

  cenas: [
    {
      capitulo: "Bem-vindo ao FireHub",
      fala: "Bem-vindo ao FireHub. Este vídeo é um passeio rápido pelo painel, para você saber onde fica cada coisa.",
      acao: async (palco, ctx) => {
        await dormir(900);
        await palco.mover({ x: 760, y: 430 }, { ms: 1300 });
        // "pelo painel": a seta dá a volta pelo menu e pela barra do topo, que são o assunto do vídeo.
        await ctx.ate(0.5);
        await palco.mover({ x: 124, y: 330 }, { ms: 900 });
        await ctx.ate(0.78);
        await palco.mover({ x: 720, y: 26 }, { ms: 900 });
      },
    },
    {
      capitulo: "A tela Início",
      fala: "Você entra no painel pelo Início. Loja nova encontra aqui a Sua jornada FireHub, com os passos para deixar a loja pronta para vender.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(item(p, ""), { folga: 4 });
        await palco.mover(item(p, ""), { ms: 700 });
        await ctx.ate(0.3);
        const jornada = p.getByText("Sua jornada FireHub").locator("xpath=../..");
        await palco.destacar(jornada, { folga: 10 });
        await palco.mover(p.getByText("Sua jornada FireHub"), { ms: 800 });
        await ctx.ate(0.68);
        // "os passos": as três primeiras tarefas da etapa atual (a caixa inteira de cada uma fica quatro níveis acima do título).
        const tarefa = (titulo) => p.getByText(titulo).locator("xpath=../../../..");
        await palco.destacar([tarefa("Adicione logo e banner da loja"), tarefa("Configure formas de pagamento")], { folga: 6 });
        await palco.mover(p.getByText("Adicione logo e banner da loja"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O resumo do dia",
      fala: "Logo abaixo vem o resumo do dia, com o faturamento, os pedidos, o ticket médio, os clientes e o lucro líquido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(periodo(p, "Hoje"), { bloco: "start" });
        const nomes = ["FATURAMENTO", "PEDIDOS", "TICKET MÉDIO", "CLIENTES", "LUCRO LÍQUIDO"];
        await palco.destacar(nomes.map((n) => cartao(p, n)), { folga: 8 });
        for (const [i, hora] of [0.36, 0.5, 0.6, 0.73, 0.85].entries()) {
          await ctx.ate(hora);
          await palco.mover(tituloDoCartao(p, nomes[i]), { ms: 420 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Nestes botões você troca o período: clicando em 7 dias, o resumo passa a mostrar a semana.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botoes = ["Hoje", "Ontem", "7 dias", "Mês", "Período"].map((n) => periodo(p, n));
        await palco.destacar(botoes, { folga: 7 });
        await palco.mover(periodo(p, "Hoje"), { ms: 600 });
        await ctx.ate(0.42);
        await palco.apagarDestaque();
        await palco.clicar(periodo(p, "7 dias"), { ms: 450 });
        await ctx.ate(0.8);
        await palco.mover(tituloDoCartao(p, "FATURAMENTO"), { ms: 600 });
      },
    },
    {
      fala: "Descendo a tela aparecem as formas de pagamento, o mapa das entregas, os pedidos por hora e os produtos mais vendidos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(bloco(p, /Formas de Pagamento/), { ms: 600 });
        await ctx.ate(0.3);
        await palco.rolarAte(bloco(p, /Mapa de Calor/), { bloco: "start" });
        // No título, e não em cima do mapa: a seta parada num pino abre o balão daquele pedido.
        await palco.mover(bloco(p, /Mapa de Calor/), { ms: 600 });
        await ctx.ate(0.62);
        await palco.rolarAte(bloco(p, /Pedidos por Hora/), { bloco: "start" });
        await palco.mover(bloco(p, /Pedidos por Hora/), { ms: 500 });
        await ctx.ate(0.84);
        await palco.mover(bloco(p, /Top Produtos/), { ms: 600 });
      },
    },
    {
      capitulo: "O menu lateral",
      fala: "À esquerda fica o menu, dividido em grupos. O primeiro é Operação, com o trabalho do dia: os Pedidos, o KDS da cozinha, as Mesas, o Balcão e a Roteirização.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.destacar(lista(p), { folga: 2 });
        await palco.mover(tituloDoGrupo(p, "Operação"), { ms: 600 });
        await ctx.ate(0.3);
        await mostrarGrupo(palco, "Operação", OPERACAO);
        await passear(palco, ctx, OPERACAO, [0.56, 0.64, 0.77, 0.84, 0.91]);
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Abrir uma tela",
      fala: "Para abrir uma tela, é só clicar no nome dela aqui no menu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.4);
        await palco.clicar(item(p, "/pedidos-clientes"), { ms: 600 });
        await palco.cameraAberta({ ms: 600 });
        // A resposta vem do servidor: a cena seguinte só começa com a tela de Pedidos pronta.
        await p.locator('[data-droppable="col-finalizado"] [draggable]').first().waitFor({ state: "visible", timeout: 60_000 });
      },
    },
    {
      fala: "Esta é a tela de Pedidos, onde chega todo pedido da loja. Para voltar, clique em Início.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(p.locator('[data-droppable="col-preparo"] h3').first(), { ms: 900 });
        await ctx.ate(0.68);
        await palco.clicar(item(p, ""), { ms: 700 });
        await p.getByText("FATURAMENTO").first().waitFor({ state: "visible", timeout: 60_000 });
      },
    },
    {
      capitulo: "Os grupos do menu",
      fala: "Em Cardápio e vendas ficam o Cardápio, Marketing e cupons e o Chatbot, que é o robô do WhatsApp.",
      acao: async (palco, ctx) => {
        await mostrarGrupo(palco, "Cardápio & vendas", VENDAS);
        await passear(palco, ctx, VENDAS, [0.36, 0.5, 0.7]);
        await ctx.ate(1);
      },
    },
    {
      fala: "Em Gestão você confere o resultado da loja, com o Financeiro, os Relatórios, o Fiscal, o Estoque e a Validade e etiquetas.",
      acao: async (palco, ctx) => {
        await mostrarGrupo(palco, "Gestão", GESTAO);
        await passear(palco, ctx, GESTAO, [0.42, 0.54, 0.64, 0.73, 0.83]);
        await ctx.ate(1);
      },
    },
    {
      fala: "Em Equipe ficam os Motoboys, os Garçons e o Fiado, de quem compra para pagar depois.",
      acao: async (palco, ctx) => {
        await mostrarGrupo(palco, "Equipe", EQUIPE);
        await passear(palco, ctx, EQUIPE, [0.3, 0.44, 0.58]);
        await ctx.ate(1);
      },
    },
    {
      fala: "E em Configurações estão Minha loja, as Impressoras e as Integrações. A setinha de Minha loja abre as telas de dentro, como Horários e Entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await mostrarGrupo(palco, "Configurações", CONFIGURACOES);
        await passear(palco, ctx, CONFIGURACOES, [0.2, 0.3, 0.38]);
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(p.locator(".fh-menu-abrir"), { ms: 500 });
        await filho(p, "horarios").waitFor({ state: "visible", timeout: 8000 });
        await palco.rolarAte(filho(p, "entrega"), { bloco: "center" });
        // A lista andou por baixo da seta: ela volta para Minha loja, em vez de ficar acesa numa tela qualquer.
        await palco.mover(item(p, "/minha-loja"), { ms: 400 });
        const dentro = [item(p, "/minha-loja"), filho(p, "info"), filho(p, "horarios"), filho(p, "entrega"), filho(p, "pagamento"), filho(p, "cupons")];
        await palco.camera(dentro, { zoomMax: 1.75, margem: 70, ms: 500 });
        for (const [i, ancora] of ["horarios", "entrega"].entries()) {
          await ctx.ate([0.86, 0.94][i]);
          await palco.mover(filho(p, ancora), { ms: 380 });
        }
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Recolher o menu",
      fala: "Para ganhar espaço, esta seta recolhe o menu e deixa só os ícones. Mais um clique, e ele volta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // A câmera abre enquanto o menu volta ao topo: a seta de recolher mora lá em cima.
        await Promise.all([palco.cameraAberta({ ms: 600 }), palco.rolarAte(tituloDoGrupo(p, "Operação"), { bloco: "start" })]);
        await Promise.all([palco.destacar(recolher(p), { folga: 6 }), palco.mover(recolher(p), { ms: 500 })]);
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(recolher(p), { ms: 200 });
        await ctx.ate(0.76);
        await palco.clicar(recolher(p), { ms: 450 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "A barra do topo",
      fala: "No topo, a chave Caixa aberto é por onde você abre e fecha o caixa e registra a sangria.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([caixa(p), site(p)], { zoomMax: 2, margem: 90 });
        await palco.destacar(caixa(p), { folga: 6 });
        await palco.mover(caixa(p), { ms: 700 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Já a chave Site aberto pausa o site de pedidos. Com ele fechado, o cliente não consegue fazer pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(site(p), { folga: 6 });
        await palco.mover(site(p), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Ver cardápio e Integrações",
      fala: "Em Ver cardápio você abre o cardápio que o cliente vê, baixa o QR Code ou copia o link.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = verCardapio(p);
        const c = await botao.boundingBox();
        // O botão e a lista que abre embaixo dele (250 px de largura, alinhada pela direita do botão).
        await palco.camera({ x: c.x + c.width - 262, y: 0, width: 274, height: 210 }, { zoomMax: 2.2, margem: 30 });
        await palco.clicar(botao, { ms: 500 });
        const abrir = p.getByRole("link", { name: /Abrir o cardápio/ });
        await abrir.waitFor({ state: "visible", timeout: 8000 });
        // A primeira linha da lista mostra o endereço do cardápio. Na gravação ele seria
        // "localhost:porta", que nenhum lojista vê: entra no lugar o endereço do site de verdade.
        await p.evaluate(() => {
          for (const el of document.querySelectorAll(".nav-view-store div")) {
            if (el.children.length === 0 && /^(localhost|127\.0\.0\.1)(:\d+)?\/loja\//.test(el.textContent || "")) {
              el.textContent = (el.textContent || "").replace(/^[^/]+/, "firehubfood.com.br");
            }
          }
        });
        await ctx.ate(0.34);
        await palco.mover(abrir, { ms: 500 });
        await ctx.ate(0.62);
        await palco.mover(p.getByRole("button", { name: /Baixar QR Code/ }), { ms: 450 });
        await ctx.ate(0.84);
        await palco.clicar(p.getByRole("button", { name: /Copiar link do cardápio/ }), { ms: 450 });
        await ctx.ate(1);
        // "Link copiado!" fica um instante na tela e a lista fecha sozinha.
        await abrir.waitFor({ state: "hidden", timeout: 8000 });
      },
    },
    {
      fala: "Ao lado ficam o atalho da impressora e as Integrações, onde se liga o iFood e outros aplicativos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([impressora(p), integracoes(p)], { zoomMax: 2, margem: 110, ms: 600 });
        await ctx.ate(0.16);
        await palco.destacar(impressora(p), { folga: 5 });
        await palco.mover(impressora(p), { ms: 500 });
        await ctx.ate(0.46);
        await palco.destacar(integracoes(p), { folga: 5 });
        await palco.mover(integracoes(p), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 600 });
      },
    },
    {
      capitulo: "Cada tela tem o seu vídeo",
      fala: "Agora é com você. Cada tela tem o seu vídeo. É só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.3);
        await palco.destacar(botao, { folga: 6 });
        await Promise.all([palco.camera(botao, { zoomMax: 1.45, margem: 60, ms: 900 }), palco.mover(botao, { ms: 900 })]);
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
