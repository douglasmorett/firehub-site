// Tutorial da tela de Motoboys (/store/motoboys).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que cada frase do acerto tem por trás (api/motoboy-report desta build):
//  · "Entregar Dinheiro" soma, por pedido em dinheiro, o valor do pedido ou —
//    quando o cliente pediu troco — a nota com que ele paga (pedido + troco).
//  · "Total Maquininha" = Débito + Crédito + Voucher.
//  · "Pago Online" é uma caixa à parte e não entra em nenhuma das duas.
//  · "Total a pagar ao motoboy" soma o que cada entrega rende (aqui, R$ 6,00
//    gravados em cada pedido) e a diária, quando o tipo de pagamento tem.
import { dormir } from "../motor/palco.mjs";

const menu = (p, rota) => p.locator(`nav.fh-menu-lista a[href="/store/${rota}"]`);
const aba = (p, nome) => p.getByRole("button", { name: nome });
/** A linha de um motoboy na lista do cadastro. */
const linha = (p, nome) => p.locator("div").filter({ has: p.getByRole("button", { name: "Pausar" }) }).filter({ hasText: nome }).last();
/** O bloco "Pedido de iFood, 99Food e outros apps", no alto do cadastro. */
const regraDoApp = (p) => p.getByText("Pedido de iFood, 99Food e outros apps").locator("xpath=../..");
/** O quadro de um motoboy no relatório: título da conferência → caixa da conferência → quadro. */
const quadro = (p) => p.getByText(/CONFERÊNCIA DO MOTOBOY/).first().locator("xpath=../../..");
/** Uma das caixas da conferência (Dinheiro, Débito, Crédito, Voucher, Pago Online), pelo título. */
const caixa = (p, titulo) => quadro(p).getByText(titulo).locator("xpath=..");
/** Um dos quatro totais do alto do relatório, pelo rótulo. */
const total = (p, rotulo) => p.getByText(rotulo, { exact: true }).locator("xpath=../..");

/**
 * As entregas do dia, para o acerto ter o que mostrar.
 *
 * A loja-base já traz o Carlos com um Pix (#1) e um cartão de crédito na rua
 * (#5), e o Rafael com um pedido de iFood pago no aplicativo (#4). Aqui entram
 * as que faltam para a conferência mostrar todas as caixas: dinheiro com troco,
 * dinheiro sem troco, débito e vale.
 *
 * Todas com `motoboyFee: 6`, igual ao "R$ 6,00 por entrega" do cadastro dos
 * dois: o valor gravado no pedido é o que o relatório paga, e a linha "Por
 * entrega: R$ 6,00 × N" tem de fechar com o total.
 */
async function preparar(prisma, { loja, produtos, motoboys, haMin }) {
  const L = loja.id;
  const entrega = (n, min, motoboy, cliente, endereco, paymentMethod, linhas, extra = {}) => prisma.customerOrder.create({
    data: {
      franchiseeId: L, source: "ONLINE", dailyOrderNumber: n, status: "ENTREGUE", deliveryType: "DELIVERY",
      deliveryFee: 6, motoboyFee: 6, motoboyId: motoboy.id, paymentMethod,
      customerName: cliente, customerPhone: `119777700${String(n).padStart(2, "0")}`, customerAddress: endereco,
      totalAmount: linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 6),
      createdAt: haMin(min), acceptedAt: haMin(min - 1), readyAt: haMin(min - 20), kdsStage: "FINISHED",
      dispatchedAt: haMin(min - 22), deliveredAt: haMin(min - 36),
      items: { create: linhas.map(([nome, q]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity: q, price: produtos[nome].price })) },
      ...extra,
    },
  });
  const { carlos, rafael } = motoboys;
  // Carlos: dinheiro com troco para 50, dinheiro certo e débito na maquininha.
  await entrega(8, 125, carlos, "Helena Prado", "Rua do Mercado, 58 - Centro", "DINHEIRO", [["X-Bacon", 1], ["Guaraná 2 L", 1]], { changeAmount: 50 });
  await entrega(9, 98, carlos, "Otávio Reis", "Rua da Estação, 310 - Vila Nova", "DINHEIRO", [["X-Burger", 1], ["Coca-Cola lata", 1]]);
  await entrega(10, 82, carlos, "Lívia Campos", "Av. das Nações, 742 - Jardim América", "DEBITO", [["Pizza Marguerita", 1]]);
  // Rafael: dinheiro com troco para 100, vale-refeição e Pix.
  await entrega(11, 115, rafael, "Marcos Vieira", "Rua do Sol, 86 - Centro", "DINHEIRO", [["Pizza Calabresa", 1]], { changeAmount: 100 });
  await entrega(12, 90, rafael, "Camila Rocha", "Rua das Acácias, 415 - Centro", "Vale Refeição", [["X-Bacon", 1], ["Batata Frita", 1]]);
  await entrega(13, 60, rafael, "Jorge Batista", "Rua Sete de Setembro, 130 - Vila Nova", "PIX", [["X-Tudo", 1]]);
}

export default {
  id: "motoboys",
  titulo: "Motoboys: cadastro, app do entregador e acerto do dia",
  rota: "store/motoboys",
  prontaQuando: 'button:has-text("Novo Motoboy")',
  preparar,
  // Só para a VOZ: a legenda fica com o valor em algarismos, como está na tela.
  pronuncia: { "R$ 40": "quarenta reais", "R$ 30": "trinta reais", "R$ 5": "cinco reais" },

  async antesDeGravar(palco) {
    const p = palco.pagina;
    // O botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo na
    // captura. Só o pulso para; o botão continua no mesmo lugar.
    //
    // A lista de motoboys termina rente ao fim da página: a última linha (a do
    // motoboy recém-cadastrado) fica colada na borda de baixo da tela e o
    // contorno do destaque saía cortado. Uma folga em branco no fim da página
    // deixa a linha subir; nada da tela muda de lugar nem de aparência.
    await p.addStyleTag({ content: "#contact-widget-fab{animation:none !important} .container{padding-bottom:72px !important}" });
    // O painel adianta as telas do menu ao passar o mouse; essas idas ao servidor
    // travam a tela por segundos no meio da cena. Só o adiantamento é barrado: o
    // clique no menu continua navegando.
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    // "Copiar Link para Motoboys" escreve na área de transferência.
    await p.context().grantPermissions(["clipboard-read", "clipboard-write", "notifications"]);
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Motoboys. Aqui você cadastra os entregadores da loja, diz como cada um é pago e faz o acerto do dia.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(800);
        await palco.mover({ x: 640, y: 150 }, { ms: 1000 });
        await ctx.ate(0.28);
        const abas = [aba(p, /Cadastro de Motoboys/), aba(p, /Relatório de Pagamentos/)];
        await palco.destacar(abas, { folga: 6 });
        await palco.mover(abas[0], { ms: 600 });
        await ctx.ate(0.75);
        await palco.mover(abas[1], { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Cadastrar um motoboy",
      fala: "Para cadastrar, clique em Novo Motoboy e preencha o nome e o telefone do entregador.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(aba(p, /Novo Motoboy/), { ms: 600 });
        const titulo = p.getByRole("heading", { name: /Novo Motoboy/ });
        await titulo.waitFor({ state: "visible", timeout: 8000 });
        await palco.rolarAte(titulo, { bloco: "start" });
        await palco.digitar(p.getByPlaceholder("Nome completo"), "Marcelo");
        await palco.digitar(p.getByPlaceholder("(22) 99999-9999"), "11988880003");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Como ele é pago",
      fala: "Em Tipo de Pagamento, escolha como ele recebe: um valor por entrega, uma diária fixa, a diária mais um valor por entrega, ou por quilômetro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tipo = p.locator("select.input-field");
        const bloco = tipo.locator("xpath=..");
        await palco.camera([bloco, p.getByPlaceholder("Nome completo")], { zoomMax: 1.35, margem: 60 });
        await palco.destacar(bloco, { folga: 8 });
        await palco.mover(tipo, { ms: 600 });
        await ctx.ate(0.62);
        await palco.apontar(tipo, { ms: 300 });
        await tipo.selectOption("BOTH");
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Aqui, o Marcelo ganha R$ 40 de diária, e mais R$ 5 em cada entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const diaria = p.getByPlaceholder("Ex: 60");
        const porEntrega = p.getByPlaceholder("Ex: 5", { exact: true });
        await diaria.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([p.locator("select.input-field"), diaria, p.getByPlaceholder("Ex: 1.50")], { zoomMax: 1.35, margem: 70, ms: 500 });
        await ctx.ate(0.2);
        await palco.digitar(diaria, "40");
        await ctx.ate(0.62);
        await palco.digitar(porEntrega, "5");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "A senha do aplicativo",
      fala: "Crie a senha que ele vai usar no aplicativo do entregador, e clique em Salvar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const senha = p.locator('input[type="password"]');
        const salvar = p.getByRole("button", { name: "Salvar", exact: true });
        await palco.camera([senha.locator("xpath=.."), salvar], { zoomMax: 1.35, margem: 50, ms: 600 });
        await palco.digitar(senha, "moto2026");
        await ctx.ate(0.72);
        await palco.clicar(salvar, { ms: 600 });
        await linha(p, "Marcelo").waitFor({ state: "visible", timeout: 15_000 });
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "O motoboy entra na lista. O lápis edita o cadastro, e o botão Pausar deixa o motoboy inativo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const l = linha(p, "Marcelo");
        await palco.rolarAte(l, { bloco: "center" });
        await palco.camera(l, { zoomMax: 1.5, margem: 60, ms: 600 });
        await palco.destacar(l, { folga: 6 });
        await palco.mover(l.getByText("Marcelo", { exact: true }), { ms: 500 });
        await ctx.ate(0.36);
        // o lápis é o botão logo depois do Pausar
        await palco.mover(l.getByRole("button").nth(1), { ms: 600 });
        await ctx.ate(0.68);
        await palco.mover(l.getByRole("button", { name: "Pausar" }), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Pedidos de aplicativo",
      fala: "No alto da tela, você escolhe quanto o motoboy recebe nos pedidos de iFood e de outros aplicativos: o valor combinado com ele, o valor que veio do aplicativo, ou um valor fixo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = regraDoApp(p);
        await palco.rolarAte(bloco, { bloco: "start" });
        const opcoes = [
          bloco.getByRole("button", { name: /O valor que eu combinei com ele/ }),
          bloco.getByRole("button", { name: /O valor que veio do app/ }),
          bloco.getByRole("button", { name: /Um valor fixo, só para pedido de app/ }),
        ];
        await palco.camera(bloco, { zoomMax: 1.2, margem: 24, ms: 600 });
        await palco.mover(bloco.getByText("Pedido de iFood, 99Food e outros apps"), { ms: 600 });
        await ctx.ate(0.5);
        await palco.destacar(opcoes, { folga: 6 });
        await palco.mover(opcoes[0], { ms: 500 });
        await ctx.ate(0.72);
        await palco.mover(opcoes[1], { ms: 500 });
        await ctx.ate(0.88);
        await palco.mover(opcoes[2], { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "O aplicativo do entregador",
      fala: "O link do aplicativo do entregador fica em outra tela, a de Pedidos, no botão App Motoboys.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.3);
        await palco.clicar(menu(p, "pedidos-clientes"), { ms: 700 });
        const botao = p.getByRole("button", { name: /App Motoboys/ });
        await botao.waitFor({ state: "visible", timeout: 60_000 });
        await dormir(500);
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique nele, e depois em Copiar Link para Motoboys. É esse link que você manda para o entregador.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: /App Motoboys/ }), { ms: 300 });
        const titulo = p.getByRole("heading", { name: "Portal de Acesso dos Motoboys" });
        await titulo.waitFor({ state: "visible", timeout: 8000 });
        const copiar = p.getByRole("button", { name: /Copiar Link para Motoboys/ });
        const janela = copiar.locator("xpath=../..");
        await palco.camera(janela, { zoomMax: 1.25, margem: 20, ms: 600 });
        await ctx.ate(0.3);
        await palco.clicar(copiar, { ms: 700 });
        await p.getByRole("button", { name: /Link Copiado/ }).waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.6);
        const link = p.getByText(/\/loja\/sabor-da-praca\/motoboy$/);
        await palco.destacar(link, { folga: 6 });
        await palco.mover(link, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No aplicativo, ele entra com o telefone, ou com o nome, e a senha do cadastro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(p.getByRole("heading", { name: "Portal de Acesso dos Motoboys" }), { ms: 800 });
        await ctx.ate(0.9);
        await palco.cameraAberta({ ms: 500 });
        // o X do alto da janela
        await palco.clicar(p.getByRole("heading", { name: "Portal de Acesso dos Motoboys" }).locator("xpath=../../..").getByRole("button", { name: "✕" }), { ms: 500 });
      },
    },
    {
      capitulo: "O acerto do dia",
      fala: "Para o acerto, volte à tela de Motoboys e abra o Relatório de Pagamentos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(menu(p, "motoboys"), { bloco: "center" });
        await palco.clicar(menu(p, "motoboys"), { ms: 600 });
        const relatorio = aba(p, /Relatório de Pagamentos/);
        await relatorio.waitFor({ state: "visible", timeout: 60_000 });
        await dormir(400);
        await ctx.ate(0.6);
        await palco.clicar(relatorio, { ms: 700 });
        await p.getByText("Filtros do Relatório").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Escolha o período, por exemplo Hoje, e clique em Gerar Relatório.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.2);
        await palco.clicar(p.getByRole("button", { name: "Hoje", exact: true }), { ms: 600 });
        await ctx.ate(0.62);
        await palco.clicar(p.getByRole("button", { name: /Gerar Relatório/ }), { ms: 600 });
        await p.getByText("Total Entregas", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
      },
    },
    {
      capitulo: "Os totais do período",
      fala: "No alto ficam os totais: as entregas feitas, o dinheiro a entregar, o que passou nas maquininhas e quanto a loja paga aos motoboys.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const totais = ["Total Entregas", "Dinheiro a Entregar", "Maquininhas Cartão", "Taxas/Diárias (Motoboy)"].map((r) => total(p, r));
        await palco.rolarAte(totais[0], { bloco: "start" });
        await palco.camera(totais, { zoomMax: 1.35, margem: 40, ms: 600 });
        await palco.destacar(totais, { folga: 6 });
        for (const [i, t] of totais.entries()) {
          await ctx.ate(0.22 + i * 0.2);
          await palco.mover(t, { ms: 450 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A conferência de cada motoboy",
      fala: "Cada motoboy tem o seu quadro. Aqui, o Carlos fez cinco entregas, e a loja deve R$ 30 a ele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = quadro(p);
        const conferencia = q.getByText(/CONFERÊNCIA DO MOTOBOY/).locator("xpath=../..");
        await palco.rolarAte(conferencia, { bloco: "end" });
        const aPagar = q.getByText(/Total a pagar ao motoboy/).locator("xpath=..");
        await palco.camera([q.getByText("Carlos", { exact: true }), aPagar, conferencia], { zoomMax: 1.3, margem: 30, ms: 600 });
        await palco.mover(q.getByText("Carlos", { exact: true }), { ms: 600 });
        await ctx.ate(0.42);
        await palco.mover(q.getByText("Entregas", { exact: true }), { ms: 500 });
        await ctx.ate(0.68);
        await palco.destacar(aPagar, { folga: 8 });
        await palco.mover(aPagar, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Entregar Dinheiro é quanto ele devolve à loja: o valor dos pedidos pagos em dinheiro, mais o troco que ele levou.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = quadro(p);
        const selo = q.getByText(/Entregar Dinheiro:/);
        const dinheiro = caixa(p, /Dinheiro \(em mãos\)/);
        await palco.camera(q.getByText(/CONFERÊNCIA DO MOTOBOY/).locator("xpath=../.."), { zoomMax: 1.45, margem: 30, ms: 600 });
        await palco.destacar(selo, { folga: 6 });
        await palco.mover(selo, { ms: 600 });
        await ctx.ate(0.45);
        await palco.destacar(dinheiro, { folga: 6 });
        await palco.mover(dinheiro.getByText(/troco/), { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Débito, crédito e voucher são as vendas da maquininha. O que foi pago online aparece separado, e não entra no dinheiro a entregar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const maquina = [caixa(p, /Débito \(Máquina\)/), caixa(p, /Crédito \(Máquina\)/), caixa(p, /Voucher \(Vale\)/)];
        const online = caixa(p, /Pago Online/);
        await palco.destacar(maquina, { folga: 6 });
        await palco.mover(maquina[0], { ms: 500 });
        await ctx.ate(0.14);
        await palco.mover(maquina[1], { ms: 400 });
        await ctx.ate(0.24);
        await palco.mover(maquina[2], { ms: 400 });
        await ctx.ate(0.5);
        await palco.destacar(online, { folga: 6 });
        await palco.mover(online, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Entrega por entrega",
      fala: "Embaixo, a composição mostra a conta do pagamento. E em Ver entregas detalhadas, você confere pedido por pedido, com a forma de pagamento e o valor do motoboy.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = quadro(p);
        const composicao = q.getByText("Composição do Pagamento").locator("xpath=..");
        const detalhes = q.locator("summary");
        await palco.rolarAte(detalhes, { bloco: "center" });
        await palco.camera([composicao, detalhes], { zoomMax: 1.4, margem: 50, ms: 600 });
        await palco.destacar(composicao, { folga: 6 });
        await palco.mover(composicao.getByText(/^Por entrega:/), { ms: 600 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(detalhes, { ms: 500 });
        const lista = q.locator("details > div");
        await lista.waitFor({ state: "visible", timeout: 5000 });
        await palco.rolarAte(lista, { bloco: "center" });
        await palco.camera([detalhes, lista], { zoomMax: 1.4, margem: 30, ms: 600 });
        await palco.destacar(lista, { folga: 6 });
        await palco.mover(lista.getByText(/Entregar: R\$ 50,00/), { ms: 700 });
        await ctx.ate(0.82);
        await palco.mover(lista.getByText("Motoboy: R$ 6,00").nth(1), { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você cadastra os motoboys e fecha o acerto do dia. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await palco.rolarPagina(0);
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
