// Tutorial da tela de Fiado (/store/funcionarios — no menu, "Fiado").
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// A quem o fiado se refere: a QUALQUER pessoa cadastrada nesta tela. A tela
// chama de "cliente", o cadastro tem "Cargo / Função" e o botão de salvar diz
// "Salvar Funcionário"; no Balcão a forma de pagamento chama "Conta
// Funcionário" e lista todos os cadastrados. Por isso a fala diz "cliente ou
// funcionário" e usa o nome de cada botão como está escrito.
import { dormir } from "../motor/palco.mjs";

/** O cartão de uma pessoa na lista. */
const cartao = (p, nome) => p.getByRole("heading", { name: nome, exact: true }).locator("xpath=ancestor::div[.//button][1]");
/** "Débito Pendente R$ 44,00" (ou "Quitado") no canto do cartão. */
const saldo = (p, nome) => cartao(p, nome).getByText(/Débito Pendente|Quitado/).locator("xpath=..");
/** Um dos três quadros de totais do alto da tela, pelo título. */
const total = (p, titulo) => p.getByText(titulo, { exact: true }).locator("xpath=../..");
const menu = (p, rota) => p.locator(`nav.fh-menu-lista a[href="/store/${rota}"]`);
const chave = (p) => p.getByText(/Módulo (Desativado|Ativo)/).locator("xpath=..");

/** A janela aberta por cima da tela (a caixa branca, sem o fundo escuro), para a câmera. */
async function janela(p, titulo) {
  const cabeca = p.getByRole("heading", { name: titulo });
  await cabeca.waitFor({ state: "visible", timeout: 8000 });
  await dormir(250);
  return cabeca.evaluate((el) => {
    let no = el;
    while (no.parentElement && getComputedStyle(no.parentElement).position !== "fixed") no = no.parentElement;
    const r = no.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** Troca o que está escrito num campo: clica, seleciona tudo e digita por cima. */
async function digitarPorCima(palco, alvo, texto) {
  await palco.clicar(alvo);
  await palco.pagina.keyboard.press("Control+A");
  await palco.pagina.keyboard.type(texto, { delay: 110 });
  await dormir(300);
}

/**
 * No Balcão: rola o rodapé do pedido até o alvo ficar à vista ACIMA do total,
 * que é grudado embaixo e tamparia o fim do bloco.
 */
async function rolarRodape(alvo, folga = 10) {
  await alvo.evaluate((el, f) => {
    const rolo = el.closest(".pdv-rodape");
    const grudado = rolo.querySelector(".pdv-acao").getBoundingClientRect();
    const r = el.getBoundingClientRect(), c = rolo.getBoundingClientRect();
    let passo = 0;
    if (r.bottom > grudado.top - f) passo = r.bottom - (grudado.top - f);
    else if (r.top < c.top + f) passo = r.top - (c.top + f);
    rolo.scrollTo({ top: rolo.scrollTop + passo, behavior: "smooth" });
  }, folga);
  await dormir(700);
}

export default {
  id: "fiado",
  titulo: "Fiado: lançar e cobrar",
  rota: "store/funcionarios",
  prontaQuando: 'h3:has-text("Bruno Tavares")',

  /**
   * Três pessoas já com história: o Bruno (atendente) deve, a Marta (cliente)
   * deve e o Sérgio (cliente) já quitou. Parte dos lançamentos é de ONTEM, para
   * o botão de período ter o que mostrar.
   */
  async preparar(prisma, { loja, produtos, haMin }) {
    const L = loja.id;
    const horas = (h) => haMin(h * 60);
    const pessoa = (name, role, extra = {}) => prisma.storeEmployee.create({ data: { franchiseeId: L, name, role, ...extra } });
    const bruno = await pessoa("Bruno Tavares", "Atendente", { phone: "11966660001", creditLimit: 300 });
    const marta = await pessoa("Marta Lopes", "Cliente", { phone: "11966660002" });
    const sergio = await pessoa("Sérgio Nunes", "Cliente", { phone: "11966660003" });

    // Venda do Balcão paga com "Conta Funcionário": é assim que a rota do balcão grava.
    const venda = (emp, n, quando, linhas) => prisma.customerOrder.create({
      data: {
        franchiseeId: L, source: "PRESENCIAL", status: "ENTREGUE", deliveryType: "RETIRADA", dailyOrderNumber: n,
        customerName: `Func. ${emp.name}`, customerPhone: "00000000000", customerAddress: "Balcão",
        paymentMethod: "Conta Funcionário", employeeId: emp.id, employeeName: emp.name,
        totalAmount: linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 0),
        createdAt: quando, acceptedAt: quando, deliveredAt: quando,
        items: { create: linhas.map(([nome, q]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity: q, price: produtos[nome].price })) },
      },
    });
    // "Incluir Dívida" da própria tela: pedido sem itens, como a rota /debt grava.
    const divida = (emp, quando, valor, motivo) => prisma.customerOrder.create({
      data: {
        franchiseeId: L, employeeId: emp.id, customerName: emp.name, customerPhone: emp.phone || "", status: "ENTREGUE", source: "PDV",
        paymentMethod: "FIADO", totalAmount: valor, notes: motivo, createdAt: quando,
      },
    });
    const baixa = (emp, quando, valor, obs) => prisma.employeePayment.create({
      data: { franchiseeId: L, employeeId: emp.id, amount: valor, notes: obs, createdAt: quando },
    });

    await venda(bruno, 20, horas(26), [["X-Burger", 1], ["Coca-Cola lata", 1]]);
    await divida(bruno, horas(5), 18, "Marmita do almoço");
    await baixa(bruno, horas(3), 30, "Pago em PIX");
    await venda(bruno, 21, haMin(95), [["X-Bacon", 1]]);
    await divida(marta, horas(28), 60, "Encomenda de salgados");
    await divida(sergio, horas(30), 40, "Pizza de sexta");
    await baixa(sergio, horas(4), 40, "Pago em dinheiro");
  },

  /**
   * O botão flutuante de ajuda, no canto de baixo, pulsa sem parar, e cada pulso
   * é um quadro novo na captura: 27 por segundo a gravação inteira, o que pesa
   * na máquina e atrasa os gestos em relação à fala. Aqui só o pulso para; o
   * botão continua na tela, no mesmo lugar e com a mesma cara.
   */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Fiado. Aqui você anota quem consome na loja para pagar depois, seja cliente ou funcionário, e acompanha quanto cada um deve.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(900);
        await palco.mover(p.getByRole("heading", { name: "Controle de Fiado" }), { ms: 1100 });
        await ctx.ate(0.72);
        await palco.destacar(["Bruno Tavares", "Marta Lopes", "Sérgio Nunes"].map((n) => saldo(p, n)), { folga: 8 });
        await palco.mover(saldo(p, "Bruno Tavares"), { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os totais",
      fala: "No alto ficam os totais: a dívida de todo mundo somada, quanto já foi pago no período e quantas pessoas estão cadastradas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quadros = [total(p, "Dívida Acumulada Total"), total(p, "Abatidos / Pagos (Período)"), total(p, "Cadastrados")];
        await palco.camera(quadros, { zoomMax: 1.5, margem: 40 });
        for (const [i, q] of quadros.entries()) {
          await ctx.ate(0.2 + i * 0.27);
          await palco.destacar(q, { folga: 4 });
          await palco.mover(q, { ms: 450 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Cadastrar a pessoa",
      fala: "Para incluir alguém, clique em Cadastrar Cliente. Só o nome é obrigatório. Cargo, telefone, CPF e limite de crédito são opcionais.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Cadastrar Cliente" }));
        await palco.camera(await janela(p, "Novo Cliente Fiado"), { zoomMax: 1.6, margem: 36, ms: 600 });
        await palco.digitar(p.getByPlaceholder("Ex: João Silva"), "Ana Paula Reis");
        await ctx.ate(0.6);
        await palco.digitar(p.getByPlaceholder("Ex: Cozinheiro, Atendente, Motoboy"), "Cliente");
        await ctx.ate(1);
      },
    },
    {
      fala: "Se quiser, anote um limite de crédito. Clique em Salvar Funcionário, e a pessoa aparece na lista, com o limite no cartão, para consulta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.digitar(p.getByPlaceholder("Ex: 300.00"), "150");
        await ctx.ate(0.3);
        await palco.clicar(p.getByRole("button", { name: "Salvar Funcionário" }));
        const ana = cartao(p, "Ana Paula Reis");
        await ana.waitFor({ state: "visible", timeout: 15_000 });
        await palco.camera(ana, { zoomMax: 1.6, margem: 60 });
        await palco.destacar(ana, { folga: 6 });
        await ctx.ate(0.74);
        await palco.destacar(ana.getByText(/Limite Crédito/), { folga: 5 });
        await palco.mover(ana.getByText(/Limite Crédito/), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Lançar no fiado",
      fala: "Para anotar um consumo, clique em Incluir Dívida. Digite o valor, escreva o motivo e clique em Confirmar Dívida.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ana = cartao(p, "Ana Paula Reis");
        await ctx.ate(0.2);
        await palco.clicar(ana.getByRole("button", { name: "Incluir Dívida" }));
        await palco.camera(await janela(p, "Incluir Dívida Manual"), { zoomMax: 1.6, margem: 36, ms: 600 });
        await palco.digitar(p.getByPlaceholder("Ex: 50,00"), "35");
        await palco.digitar(p.getByPlaceholder("Ex: Lanche da tarde, Refrigerante..."), "Duas marmitas");
        await ctx.ate(0.85);
        await palco.clicar(p.getByRole("button", { name: "Confirmar Dívida" }));
        await p.getByRole("heading", { name: "Incluir Dívida Manual" }).waitFor({ state: "hidden", timeout: 15_000 });
        await saldo(p, "Ana Paula Reis").getByText("R$ 35,00").waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      fala: "O cartão passa a mostrar o débito pendente da pessoa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(cartao(p, "Ana Paula Reis"), { zoomMax: 1.6, margem: 60, ms: 600 });
        await palco.destacar(saldo(p, "Ana Paula Reis"), { folga: 8 });
        await palco.mover(saldo(p, "Ana Paula Reis"), { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Fiado na venda do Balcão",
      fala: "Ligando este botão, o Balcão ganha a forma de pagamento Conta Funcionário.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(chave(p), { zoomMax: 1.7, margem: 110 });
        await palco.destacar(chave(p), { folga: 6 });
        await ctx.ate(0.25);
        await palco.clicar(chave(p).locator("button"));
        await p.getByText("Módulo Ativo no Balcão").waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(chave(p), { folga: 6 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      fala: "Para ver, abra o Balcão e monte a venda como sempre.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(menu(p, "venda-presencial"));
        const xTudo = p.locator(".pdv-produtos > div").filter({ hasText: "X-Tudo" }).first();
        await xTudo.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(400);
        await ctx.ate(0.6);
        await palco.clicar(xTudo);
        await p.locator(".pdv-itens > div").filter({ hasText: "X-Tudo" }).first().waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "No pagamento, escolha Conta Funcionário e selecione a pessoa: aparecem todos os cadastrados do Fiado. Finalizou, o valor entra na dívida dela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const rodape = p.locator(".pdv-rodape");
        await palco.camera(rodape, { zoomMax: 1.8, margem: 40, ms: 600 });
        await palco.clicar(rodape.getByRole("button", { name: /Conta Funcionário/ }));
        const lista = rodape.locator("select");
        await lista.waitFor({ state: "visible", timeout: 8000 });
        await rolarRodape(lista.locator("xpath=.."));
        await palco.destacar(lista, { folga: 5 });
        await palco.apontar(lista);
        const bruno = await ctx.prisma.storeEmployee.findFirst({ where: { name: "Bruno Tavares" } });
        await lista.selectOption(bruno.id);
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.clicar(p.locator('button[data-btn="finalizar"]'));
        const aviso = p.getByText("Pedido registrado!");
        await aviso.waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(aviso, { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      fala: "Voltando ao Fiado, que fica no menu, em Equipe, a dívida dele já subiu com essa venda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(menu(p, "funcionarios"), { bloco: "center" });
        await palco.clicar(menu(p, "funcionarios"));
        await cartao(p, "Bruno Tavares").waitFor({ state: "visible", timeout: 30_000 });
        await saldo(p, "Bruno Tavares").getByText("R$ 76,00").waitFor({ state: "visible", timeout: 15_000 });
        await palco.camera(cartao(p, "Bruno Tavares"), { zoomMax: 1.6, margem: 60, ms: 600 });
        await ctx.ate(0.6);
        await palco.destacar(saldo(p, "Bruno Tavares"), { folga: 8 });
        await palco.mover(saldo(p, "Bruno Tavares"), { ms: 600 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O extrato",
      fala: "O botão Extrato mostra o histórico da pessoa: cada consumo, com os itens da venda, e cada pagamento.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.08);
        await palco.clicar(cartao(p, "Bruno Tavares").getByRole("button", { name: "Extrato" }));
        await palco.camera(await janela(p, /^Extrato/), { zoomMax: 1.5, margem: 30, ms: 600 });
        await p.getByText("1x X-Tudo").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.5);
        await palco.mover(p.getByText("1x X-Tudo"), { ms: 600 });
        await ctx.ate(0.85);
        await palco.mover(p.getByText("Abatimento de Dívida").first(), { ms: 600 });
        await ctx.ate(1);
        await dormir(500);
        await palco.clicar(p.getByRole("button", { name: "Fechar" }));
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Receber o pagamento",
      fala: "Quando a pessoa pagar, clique em Abater Dívida. O valor já vem com a dívida inteira, para quitar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.2);
        await palco.clicar(cartao(p, "Bruno Tavares").getByRole("button", { name: "Abater Dívida" }));
        await palco.camera(await janela(p, /Abatimento/), { zoomMax: 1.6, margem: 36, ms: 600 });
        await ctx.ate(0.55);
        const valor = p.getByPlaceholder("Ex: 300.00");
        await palco.destacar([valor, p.getByText(/Novo Saldo Restante/)], { folga: 6 });
        await palco.mover(valor, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Se ela pagou só uma parte, troque o valor: a tela mostra o saldo que fica. Anote a forma de pagamento e clique em Confirmar Baixa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await digitarPorCima(palco, p.getByPlaceholder("Ex: 300.00"), "50");
        const fica = p.getByText(/Novo Saldo Restante: R\$ 26,00/);
        await fica.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(fica, { folga: 5 });
        await ctx.ate(0.52);
        await palco.apagarDestaque();
        await palco.digitar(p.getByPlaceholder("Ex: Abatido no holerite, Pago em PIX, Dinheiro"), "Pago em PIX");
        await ctx.ate(0.88);
        await palco.clicar(p.getByRole("button", { name: "Confirmar Baixa" }));
        await p.getByRole("heading", { name: /Abatimento/ }).waitFor({ state: "hidden", timeout: 15_000 });
        await saldo(p, "Bruno Tavares").getByText("R$ 26,00").waitFor({ state: "visible", timeout: 15_000 });
        await palco.cameraAberta();
      },
    },
    {
      fala: "A dívida cai na hora, e o pagamento entra no total de abatidos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(saldo(p, "Bruno Tavares"), { folga: 8 });
        await palco.mover(saldo(p, "Bruno Tavares"), { ms: 700 });
        await ctx.ate(0.5);
        await palco.destacar(total(p, "Abatidos / Pagos (Período)"), { folga: 4 });
        await palco.mover(total(p, "Abatidos / Pagos (Período)"), { ms: 700 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Busca e período",
      fala: "A busca acha a pessoa pelo nome, pelo cargo ou pelo CPF.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const busca = p.getByPlaceholder("Buscar por nome, cargo ou CPF...");
        await palco.digitar(busca, "atendente");
        await ctx.ate(1);
        await dormir(900);
        await busca.fill("");
        await dormir(400);
      },
    },
    {
      fala: "E estes botões escolhem o período do consumo e do abatido de cada cartão. A dívida é sempre a total.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const periodo = (nome) => p.getByRole("button", { name: nome, exact: true });
        await palco.destacar(["Hoje", "Ontem", "7 Dias", "Este Mês", "Tudo"].map(periodo), { folga: 6 });
        await palco.mover(periodo("Ontem"), { ms: 700 });
        await ctx.ate(0.22);
        await palco.apagarDestaque();
        await palco.clicar(periodo("Ontem"));
        const bruno = cartao(p, "Bruno Tavares");
        const consumo = bruno.getByText(/Consumo Período/).locator("xpath=..");
        await bruno.getByText("(1x)").waitFor({ state: "visible", timeout: 15_000 });
        await palco.camera([periodo("Hoje"), bruno], { zoomMax: 1.5, margem: 40, ms: 600 });
        await palco.destacar(consumo, { folga: 5 });
        await palco.mover(consumo, { ms: 600 });
        await ctx.ate(0.72);
        await palco.destacar(saldo(p, "Bruno Tavares"), { folga: 8 });
        await palco.mover(saldo(p, "Bruno Tavares"), { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta();
        // a tela volta ao período em que abriu
        await palco.clicar(periodo("Este Mês"));
        await cartao(p, "Bruno Tavares").waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso o fiado da loja fica todo anotado aqui. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
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
