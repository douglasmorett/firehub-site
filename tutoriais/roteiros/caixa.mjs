// Tutorial do caixa: abrir, sangria, encerrar com conferência e histórico.
//
// O caixa não tem tela própria ("/store/caixa" não existe): mora na barra do
// topo do painel, no botão "Caixa aberto"/"Caixa fechado". A única página dele
// é o Histórico de caixas (/store/caixa/historico), que é onde o botão
// Tutorial deste vídeo aparece. O vídeo começa no Balcão, onde se vê o que o
// caixa fechado trava, e termina no Histórico.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import { dormir } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

const haMin = (m) => new Date(Date.now() - m * 60_000);

/** O botão do caixa na barra do topo ("Caixa aberto" ou "Caixa fechado"). */
const botaoDoCaixa = (p, estado = "(aberto|fechado)") => p.getByRole("button", { name: new RegExp(`^Caixa ${estado}$`) });
/** A janela branca que tem este título (Abrir Caixa, Movimentar caixa, Encerrar Caixa...). */
const janelaDe = (p, titulo) => p.getByRole("heading", { name: titulo }).locator("xpath=ancestor::div[contains(@style,'border-radius: 20px')][1]");
/** Os campos "Você contou" do fechamento, na ordem: dinheiro, débito, crédito, Pix, voucher. */
const contado = (p, i) => p.locator("table input[type=number]").nth(i);

/** Clica no campo e digita como gente. */
async function escrever(palco, alvo, texto, atraso = 80, ms) {
  await palco.clicar(alvo, ms ? { ms } : {});
  await palco.pagina.keyboard.type(texto, { delay: atraso });
  await dormir(200);
}

/**
 * O turno "passa" entre a sangria e o fechamento: as vendas do turno entram no
 * banco e a abertura do caixa recua quase cinco horas, para o histórico não
 * mostrar um turno de dois minutos. O fechamento só conta pedido feito DEPOIS
 * da abertura (lib/esperado-do-turno.ts).
 * Dinheiro R$ 86, Débito R$ 66, Crédito R$ 72 e Pix R$ 98.
 */
async function passarOTurno(prisma) {
  const loja = await prisma.user.findUnique({ where: { email: LOJA.email } });
  await prisma.cashSession.updateMany({ where: { franchiseeId: loja.id, status: "OPEN" }, data: { openedAt: haMin(290) } });
  const lista = await prisma.menuProduct.findMany({ where: { franchiseeId: loja.id } });
  const prod = Object.fromEntries(lista.map((x) => [x.name, x]));
  const vendas = [
    ["Dinheiro", "Renata Souza", [["X-Tudo", 1], ["Batata Frita", 1], ["Coca-Cola lata", 1]]],
    ["Dinheiro", "Marcos Vieira", [["X-Burger", 1], ["Coca-Cola lata", 1]]],
    ["Débito", "Aline Rocha", [["Pizza Calabresa", 1], ["Guaraná 2 L", 1]]],
    ["Crédito", "Tiago Nunes", [["X-Bacon", 2], ["Batata Frita", 1]]],
    ["Pix", "Camila Duarte", [["X-Tudo", 1], ["Guaraná 2 L", 1]]],
    ["Pix", "Pedro Antunes", [["Pizza Calabresa", 1]]],
  ];
  for (const [i, [paymentMethod, customerName, linhas]] of vendas.entries()) {
    await prisma.customerOrder.create({
      data: {
        franchiseeId: loja.id, source: "PRESENCIAL", deliveryType: "RETIRADA", dailyOrderNumber: i + 1, status: "ENTREGUE",
        customerName, customerPhone: `1197777010${i}`, paymentMethod, kdsStage: "FINISHED",
        totalAmount: linhas.reduce((t, [nome, q]) => t + prod[nome].price * q, 0),
        createdAt: haMin(200 - i * 30), acceptedAt: haMin(200 - i * 30), deliveredAt: haMin(190 - i * 30),
        items: { create: linhas.map(([nome, quantity]) => ({ menuProductId: prod[nome].id, productName: nome, quantity, price: prod[nome].price })) },
      },
    });
  }
}

export default {
  id: "caixa",
  titulo: "Como abrir e fechar o caixa",
  rota: "store/venda-presencial",
  prontaQuando: "text=Seu caixa está fechado",

  /**
   * A loja no começo do vídeo: caixa FECHADO, com um turno anterior já
   * encerrado e conferido (é ele que dá a sugestão de troco e aparece no
   * histórico). Os pedidos da semente ficam naquele turno, todos entregues.
   */
  async preparar(prisma, { loja }) {
    const L = loja.id;
    await prisma.cashSession.updateMany({
      where: { franchiseeId: L, status: "OPEN" },
      data: {
        status: "CLOSED", openedAt: haMin(600), closedAt: haMin(300), openingAmount: 100,
        expectedCash: 100, closingCash: 100, expectedDebit: 85, closingDebit: 85,
        expectedCredit: 63, closingCredit: 63, expectedPix: 101, closingPix: 101,
        expectedVoucher: 0, closingVoucher: 0, expectedTotal: 349, difference: 0, closedBy: "Sabor da Praça",
      },
    });
    await prisma.user.update({ where: { id: L }, data: { cashOpen: false, cashClosedAt: haMin(300) } });
    await prisma.customerOrder.updateMany({
      where: { franchiseeId: L, status: { in: ["SAIU_ENTREGA", "PREPARANDO", "ACEITO"] } },
      data: { status: "ENTREGUE", kdsStage: "FINISHED", deliveredAt: haMin(320) },
    });
    await prisma.customerOrder.updateMany({ where: { franchiseeId: L }, data: { createdAt: haMin(400) } });
  },

  /**
   * Abrir e fechar o caixa recarrega a barra do topo, e o painel aproveita para
   * adiantar (prefetch) as doze telas do menu lateral. No banco de brinquedo da
   * gravação, que atende uma consulta por vez, essa leva ocupa o servidor por
   * vários segundos e a sangria da cena seguinte ficava até dez segundos
   * esperando. A gravação dispensa só esse adiantamento: nenhuma tela do vídeo
   * depende dele, e o que aparece na imagem é igual.
   */
  async antesDeGravar(palco) {
    await palco.pagina.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
  },

  cenas: [
    {
      capitulo: "Onde fica o caixa",
      fala: "O caixa do FireHub não tem uma tela só dele: abre e fecha por este botão, na barra do topo do painel.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = botaoDoCaixa(p);
        await dormir(700);
        await ctx.ate(0.3);
        await palco.camera([botao, p.getByRole("button", { name: /^Site/ })], { zoomMax: 1.7, margem: 130 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Com o caixa fechado",
      fala: "Com o caixa fechado, o Balcão e as Mesas não lançam venda. Os pedidos do site, do WhatsApp e dos aplicativos continuam entrando.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.locator(".pdv-aviso-caixa");
        const finalizar = p.locator('[data-btn="finalizar"]');
        await palco.camera([p.getByRole("button", { name: "Dinheiro", exact: true }), aviso, finalizar], { zoomMax: 1.6, margem: 40 });
        await palco.destacar([aviso, finalizar], { folga: 6 });
        await palco.mover(finalizar, { ms: 800 });
        await ctx.ate(0.5);
        await palco.mover(aviso.getByText("Seu caixa está fechado"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Abrir o caixa",
      fala: "Para abrir, clique em Caixa fechado e informe o troco que está na gaveta. O sistema já sugere o dinheiro contado no último fechamento.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(botaoDoCaixa(p, "fechado"));
        const janela = janelaDe(p, "Abrir Caixa");
        await janela.waitFor({ state: "visible", timeout: 8000 });
        const campo = janela.locator("input[type=number]");
        await palco.camera(janela, { zoomMax: 1.5, margem: 36 });
        await ctx.ate(0.38);
        await palco.destacar([janela.getByText(/Valor de abertura/), campo], { folga: 8 });
        await palco.mover(campo, { ms: 600 });
        await ctx.ate(0.62);
        const sugestao = janela.getByText(/No último fechamento foram contados/);
        await palco.destacar(sugestao, { folga: 4 });
        await palco.mover(sugestao, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Confirmar Abertura. O botão muda para Caixa aberto, e o aviso de caixa fechado some do Balcão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.05);
        await palco.clicar(p.getByRole("button", { name: /Confirmar Abertura/ }));
        const aberto = botaoDoCaixa(p, "aberto");
        await aberto.waitFor({ state: "visible", timeout: 15_000 });
        await dormir(400);
        await palco.camera([aberto, p.getByRole("button", { name: /^Site/ })], { zoomMax: 1.7, margem: 130, ms: 600 });
        await palco.destacar(aberto, { folga: 6 });
        await palco.mover(aberto, { ms: 700 });
        await ctx.ate(0.62);
        const finalizar = p.locator('[data-btn="finalizar"]');
        await Promise.all([
          palco.camera([p.getByRole("button", { name: "Dinheiro", exact: true }), finalizar], { zoomMax: 1.6, margem: 40, ms: 700 }),
          palco.destacar(finalizar, { folga: 6 }),
        ]);
        await palco.mover(finalizar, { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await Promise.all([palco.apagarDestaque(), palco.cameraAberta({ ms: 450 })]);
      },
    },
    {
      capitulo: "Sangria e reforço",
      fala: "Com o caixa aberto, o mesmo botão abre este menu. Tirou dinheiro da gaveta, para pagar o motoboy ou guardar no cofre? Clique em Informar saída.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(botaoDoCaixa(p, "aberto"));
        const saida = p.getByRole("button", { name: /Informar saída/ });
        await saida.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([p.getByRole("heading", { name: "Movimentar caixa" }), p.getByRole("button", { name: /Informar entrada/ }), p.getByRole("link", { name: /Histórico de caixas/ })], { zoomMax: 1.4, margem: 44 });
        await ctx.ate(0.42);
        await palco.destacar(saida, { folga: 5 });
        await palco.mover(saida, { ms: 600 });
        await ctx.ate(0.86);
        await palco.apagarDestaque();
        await palco.clicar(saida);
      },
    },
    {
      fala: "Digite o valor e o motivo, e clique em Registrar saída. Se entrou dinheiro, como um reforço de troco, use Informar entrada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const valor = p.getByPlaceholder("0,00");
        await valor.waitFor({ state: "visible", timeout: 8000 });
        await escrever(palco, valor, "50,00", 70, 350);
        await escrever(palco, p.getByPlaceholder(/paguei o motoboy/), "Pagamento do motoboy", 45, 350);
        await palco.clicar(p.getByRole("button", { name: "Registrar saída" }));
        const lancado = p.getByText("Pagamento do motoboy", { exact: true });
        await lancado.waitFor({ state: "visible", timeout: 10_000 });
        const saiu = p.getByText("Saiu", { exact: true }).locator("xpath=..");
        const linha = lancado.locator("xpath=../..");
        await palco.camera([p.getByRole("link", { name: /Histórico de caixas/ }), p.getByText("Entrou", { exact: true }).locator("xpath=.."), saiu, linha], { zoomMax: 1.5, margem: 40, ms: 600 });
        await palco.destacar([saiu, linha], { folga: 6 });
        await palco.mover(lancado, { ms: 600 });
        await ctx.ate(0.68);
        const entrada = p.getByRole("button", { name: /Informar entrada/ });
        await Promise.all([
          palco.camera([p.getByRole("heading", { name: "Movimentar caixa" }), entrada, p.getByRole("link", { name: /Histórico de caixas/ })], { zoomMax: 1.4, margem: 44, ms: 600 }),
          palco.destacar(entrada, { folga: 5 }),
        ]);
        await palco.mover(entrada, { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Encerrar o caixa",
      fala: "No fim do turno, clique em Encerrar caixa. A coluna Sistema espera mostra quanto deve haver em cada forma de pagamento. No dinheiro, já contam o troco inicial e a sangria.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // O turno passa: as vendas entram e a abertura recua (ver passarOTurno).
        const turno = passarOTurno(ctx.prisma);
        await ctx.ate(0.08);
        await turno;
        await palco.clicar(p.getByRole("button", { name: /Encerrar caixa/ }));
        await p.getByText("R$ 136,00").waitFor({ state: "visible", timeout: 15_000 });
        const tabela = p.locator("table");
        await palco.camera([p.getByText("Movimentações deste turno").locator("xpath=.."), tabela.locator("tfoot tr").first()], { zoomMax: 1.6, margem: 30 });
        await ctx.ate(0.36);
        await palco.destacar([tabela.locator("thead th").nth(1), tabela.locator("tfoot tr").first().locator("td").nth(1)], { folga: 4 });
        await palco.mover(tabela.locator("thead th").nth(1), { ms: 600 });
        await ctx.ate(0.72);
        await palco.destacar([p.getByText("Movimentações deste turno").locator("xpath=.."), tabela.locator("tbody tr").first()], { folga: 4 });
        await palco.mover(p.getByText("R$ 136,00"), { ms: 700 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Contar e conferir",
      fala: "Em Você contou, digite o que há de verdade: o dinheiro da gaveta e o que passou no débito, no crédito e no Pix.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(p.locator("table thead th").nth(2), { folga: 5 });
        await ctx.ate(0.16);
        await palco.apagarDestaque();
        await ctx.ate(0.3);
        await escrever(palco, contado(p, 0), "126", 80, 400);
        await ctx.ate(0.56);
        await escrever(palco, contado(p, 1), "66", 80, 300);
        await escrever(palco, contado(p, 2), "72", 80, 300);
        await escrever(palco, contado(p, 3), "98", 80, 300);
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Sobra ou falta",
      fala: "Se a conta não fecha, a tela mostra quanto falta ou quanto sobra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const falta = p.getByText(/Faltam R\$ 10,00 em caixa/);
        await palco.rolarAte(falta, { bloco: "center" });
        const rodape = p.locator("table tfoot");
        await palco.camera([p.locator("table tbody tr").nth(2), rodape, p.getByRole("button", { name: /Encerrar Caixa/ })], { zoomMax: 1.6, margem: 30, ms: 600 });
        await palco.destacar(rodape, { folga: 4 });
        await palco.mover(falta, { ms: 600 });
        await ctx.ate(0.8);
        await palco.apagarDestaque();
        // O aviso da diferença já fica na tela para a fala seguinte.
        await palco.clicar(p.getByRole("button", { name: /Encerrar Caixa/ }));
        const aviso = janelaDe(p, "Atenção! Caixa com diferença");
        await aviso.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(aviso, { zoomMax: 1.5, margem: 40, ms: 600 });
      },
      pausa: 200,
    },
    {
      fala: "Ao encerrar, dá para voltar e corrigir, ou encerrar assim mesmo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const corrigir = p.getByRole("button", { name: /Corrigir/ });
        const assimMesmo = p.getByRole("button", { name: "Encerrar assim mesmo" });
        await palco.destacar(p.getByText("Faltando R$ 10,00"), { folga: 4 });
        await ctx.ate(0.3);
        await palco.destacar(corrigir, { folga: 5 });
        await palco.mover(corrigir, { ms: 500 });
        await ctx.ate(0.68);
        await palco.destacar(assimMesmo, { folga: 5 });
        await palco.mover(assimMesmo, { ms: 500 });
        await ctx.ate(0.95);
        await palco.apagarDestaque();
        await palco.clicar(assimMesmo, { ms: 100 });
        await p.getByRole("button", { name: "Encerrar sem imprimir" }).waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(janelaDe(p, "Deseja imprimir o fechamento desse caixa?"), { zoomMax: 1.4, margem: 30, ms: 600 });
      },
      pausa: 200,
    },
    {
      fala: "Por último, escolha se o fechamento sai na impressora. O caixa fecha, e o botão do topo volta para Caixa fechado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const semImprimir = p.getByRole("button", { name: "Encerrar sem imprimir" });
        const imprimir = p.getByRole("button", { name: /Imprimir e encerrar/ });
        await semImprimir.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar([semImprimir, imprimir], { folga: 6 });
        await palco.mover(imprimir, { ms: 600 });
        await ctx.ate(0.42);
        await palco.apagarDestaque();
        await palco.clicar(semImprimir);
        const fechado = botaoDoCaixa(p, "fechado");
        await fechado.waitFor({ state: "visible", timeout: 20_000 });
        await dormir(400);
        await palco.camera([fechado, p.getByRole("button", { name: /^Site/ })], { zoomMax: 1.7, margem: 130, ms: 600 });
        await palco.destacar(fechado, { folga: 6 });
        await palco.mover(fechado, { ms: 800 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Histórico de caixas",
      fala: "Todo caixa encerrado fica no Histórico de caixas, que abre pelo mesmo botão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(botaoDoCaixa(p, "fechado"), { ms: 200 });
        const atalho = p.getByRole("link", { name: /Ver histórico de caixas/ });
        await atalho.waitFor({ state: "visible", timeout: 8000 });
        await palco.cameraAberta({ ms: 500 });
        await palco.destacar(atalho, { folga: 5 });
        await palco.mover(atalho, { ms: 500 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(atalho, { ms: 100 });
        await p.getByRole("button", { name: /Imprimir fechamento/ }).first().waitFor({ state: "visible", timeout: 90_000 });
        await p.getByText(/^Caixa #2/).first().waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
      },
      pausa: 200,
    },
    {
      fala: "Lá estão o esperado, o contado e a diferença de cada forma de pagamento, e dá para imprimir o fechamento de novo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByText(/^Caixa #2/);
        const cartao = p.locator("div").filter({ has: titulo }).filter({ has: p.getByRole("button", { name: /Imprimir fechamento/ }) }).last();
        await palco.camera(cartao, { zoomMax: 1.4, margem: 36 });
        await ctx.ate(0.12);
        await palco.destacar(cartao.locator("table"), { folga: 2 });
        await palco.mover(cartao.getByText("R$ -10,00").first(), { ms: 700 });
        await ctx.ate(0.68);
        const reimprimir = cartao.getByRole("button", { name: /Imprimir fechamento/ });
        await palco.destacar(reimprimir, { folga: 5 });
        await palco.mover(reimprimir, { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você abre, movimenta e fecha o caixa do dia. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 600 });
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.5);
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 900 });
        }
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
