// Tutorial da tela de Garçons (/store/garcons).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import bcrypt from "bcryptjs";
import { dormir } from "../motor/palco.mjs";

// Sobre o "ms" dos gestos: o mover do palco anda em passos de 16 ms nominais,
// mas com a captura ligada cada passo custa de 35 a 65 ms. Um movimento de
// 700 ms nominais leva de 1,5 a 2,6 s de verdade e a cena estoura a fala. Por
// isso todo gesto daqui leva um ms curto (200 a 350).

/**
 * Clica no campo e escreve o texto aos pedaços. Tecla por tecla, cada letra
 * custa quase meio segundo nesta tela (ela repinta o tempo todo e a captura
 * pesa): treze letras de telefone deixavam oito segundos de silêncio.
 */
async function digitar(palco, alvo, texto) {
  await palco.clicar(alvo, { ms: 260 });
  for (let i = 0; i < texto.length; i += 3) {
    await palco.pagina.keyboard.insertText(texto.slice(i, i + 3));
    await dormir(110);
  }
  await dormir(200);
}

/** Dois garçons já cadastrados e as mesas que cada um fechou hoje (é de onde sai a comissão). */
export async function prepararGarcons(prisma, { loja, produtos, haMin }) {
  const L = loja.id;
  await prisma.user.update({ where: { id: L }, data: { taxaServicoPadrao: 10 } });

  const mesas = {};
  for (let n = 1; n <= 8; n++) {
    mesas[n] = await prisma.table.create({ data: { franchiseeId: L, number: n, capacity: 4, sortOrder: n } });
  }

  // Juliana tem login (entra pelo link); Marcos ainda não — a lista mostra os dois casos.
  const juliana = await prisma.waiter.create({
    data: {
      franchiseeId: L, name: "Juliana", phone: "11 96666-0001", commissionRate: 10,
      login: "juliana", passwordHash: await bcrypt.hash("tutorial-juliana", 10), credentialsUpdatedAt: haMin(60 * 24 * 20), lastLoginAt: haMin(190),
    },
  });
  const marcos = await prisma.waiter.create({ data: { franchiseeId: L, name: "Marcos", phone: "11 96666-0002", commissionRate: 10 } });

  // O Relatório de Mesas ancora o dia no fuso de Brasília (meio-dia -03:00). O fuso que a gravação
  // escolhe para serem 20h fica do outro lado do mundo de manhã e esvaziava o "Hoje": a loja usa o
  // fuso de Brasília, como toda loja de verdade.
  await prisma.user.update({ where: { id: L }, data: { storeTimezone: "America/Sao_Paulo" } });

  let numero = 8; // a loja-base já usou do 1 ao 7
  /**
   * Uma mesa já fechada hoje, do jeito que o fechamento grava
   * (api/store/table-sessions/[id]/close): taxa sobre o consumo e
   * comissão do garçom = taxa de serviço + gorjeta.
   */
  const mesaFechada = async ({ mesa, garcom, cliente, linhas, taxaPct, gorjeta = 0, abriu, fechou, forma }) => {
    const consumo = linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 0);
    const taxa = Math.round(consumo * taxaPct) / 100;
    const total = consumo + taxa + gorjeta;
    const sessao = await prisma.tableSession.create({
      data: {
        tableId: mesas[mesa].id, franchiseeId: L, status: "CLOSED", customerName: cliente,
        waiterId: garcom.id, waiterName: garcom.name, openedAt: haMin(abriu), closedAt: haMin(fechou),
        serviceFee: taxa, waiterTip: gorjeta > 0 ? gorjeta : null, waiterCommission: taxa + gorjeta > 0 ? taxa + gorjeta : null,
        totalPaid: total, closedByKind: "loja", closedByName: "Sabor da Praça",
        paymentMethods: [{ uid: `tutorial-${mesa}`, method: forma, amount: total, guestId: null, guestName: null, at: haMin(fechou).toISOString(), por: "Sabor da Praça" }],
      },
    });
    await prisma.customerOrder.create({
      data: {
        franchiseeId: L, dailyOrderNumber: numero++, customerName: cliente, customerPhone: "00000000000",
        customerAddress: `Mesa ${mesa}`, deliveryType: "MESA", paymentMethod: "N/A", deliveryFee: 0,
        status: "ENTREGUE", source: "PRESENCIAL", tableSessionId: sessao.id,
        createdAt: haMin(abriu - 4), acceptedAt: haMin(abriu - 4), deliveredAt: haMin(fechou), totalAmount: consumo,
        items: { create: linhas.map(([nome, quantity]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity, price: produtos[nome].price })) },
      },
    });
  };

  // Juliana: três mesas — uma com gorjeta e uma em que o cliente não pagou a taxa.
  await mesaFechada({ mesa: 4, garcom: juliana, cliente: "Família Souza", linhas: [["Pizza Marguerita", 1], ["Pizza Calabresa", 1], ["Coca-Cola lata", 2]], taxaPct: 10, gorjeta: 5, abriu: 95, fechou: 32, forma: "Crédito" });
  await mesaFechada({ mesa: 1, garcom: juliana, cliente: "Renata", linhas: [["Pizza Calabresa", 1], ["X-Tudo", 1]], taxaPct: 10, abriu: 150, fechou: 88, forma: "Pix" });
  await mesaFechada({ mesa: 2, garcom: juliana, cliente: "Gustavo", linhas: [["Pizza Calabresa", 1]], taxaPct: 0, abriu: 170, fechou: 121, forma: "Dinheiro" });
  // Marcos: duas mesas.
  await mesaFechada({ mesa: 3, garcom: marcos, cliente: "Carla", linhas: [["X-Tudo", 2], ["Coca-Cola lata", 2]], taxaPct: 10, abriu: 110, fechou: 54, forma: "Débito" });
  await mesaFechada({ mesa: 6, garcom: marcos, cliente: "Roberto", linhas: [["Pizza Calabresa", 1], ["Guaraná 2 L", 1]], taxaPct: 10, abriu: 140, fechou: 97, forma: "Pix" });

  return { juliana, marcos };
}

/** A linha de um garçom na lista. */
const linha = (p, nome) => p.locator("tbody tr").filter({ hasText: nome }).first();
/** O formulário de cadastro (a janela "Novo Garçom"). */
const formulario = (p) => p.locator("form");
/** Uma permissão do formulário: a caixinha, o título e a explicação. */
const permissao = (p, comeco) => formulario(p).locator("label").filter({ hasText: comeco }).locator("xpath=..");
/** A seta de voltar dos relatórios (o primeiro botão ao lado do título). */
const voltar = (p) => p.locator("h1").locator("xpath=..").getByRole("button").first();

export default {
  id: "garcons",
  titulo: "Garçons: cadastro, link e comissão",
  rota: "store/garcons",
  prontaQuando: "tbody tr >> text=Juliana",
  preparar: prepararGarcons,

  /**
   * O botão redondo do chat de suporte, no canto da tela, pulsa sem parar
   * (animação fcwPulse). Cada pulsação repinta a tela e a captura grava 30
   * quadros por segundo mesmo com tudo parado: a gravação fica pesada e os
   * gestos atrasam em relação à fala. Aqui só a pulsação é parada, durante a
   * gravação; o botão continua no lugar e nada da tela muda.
   */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: ".fcw-fab-pulse{animation:none !important}" });
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Garçons. Aqui você cadastra quem atende o salão, dá o acesso de cada um e acompanha a comissão.",
      acao: async (palco) => {
        await dormir(900);
        await palco.mover({ x: 760, y: 400 }, { ms: 650 });
      },
    },
    {
      capitulo: "Cadastrar um garçom",
      fala: "Para cadastrar, clique no botão Novo Garçom, aqui em cima, à direita.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.3);
        await palco.clicar(p.getByRole("button", { name: "Novo Garçom" }), { ms: 260 });
        const form = formulario(p);
        await form.waitFor({ state: "visible", timeout: 8000 });
        // A janela é mais alta que a tela (ver o relatório): o campo Nome fica rente ao alto da imagem.
        const janela = await form.locator("xpath=..").boundingBox();
        await palco.camera({ x: janela.x, y: 0, width: janela.width, height: 150 }, { zoomMax: 1.7, margem: 30, ms: 500 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Depois, escreva o nome dele e, se quiser, o telefone também.",
      acao: async (palco, ctx) => {
        const campos = formulario(palco.pagina).locator("input");
        await digitar(palco, campos.nth(0), "Tiago");
        await ctx.ate(0.5);
        await digitar(palco, campos.nth(1), "11 96666-0003");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Login e senha do garçom",
      fala: "Em Acesso pelo link do garçom, crie um login e uma senha. É com eles que o garçom entra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const form = formulario(p);
        const acesso = form.getByText("Acesso pelo link do garçom").locator("xpath=..");
        await palco.camera(acesso, { zoomMax: 1.7, margem: 30 });
        await palco.mover(form.getByText("Acesso pelo link do garçom"), { ms: 250 });
        await ctx.ate(0.3);
        await digitar(palco, form.getByPlaceholder("ex: joao"), "tiago");
        await ctx.ate(0.6);
        await digitar(palco, form.getByPlaceholder("mínimo 6 caracteres"), "salao2026");
        await ctx.ate(1);
      },
    },
    {
      fala: "Sem login, ele não entra pelo link, mas continua aparecendo para escolher na hora de abrir uma mesa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = formulario(p).getByText(/Sem login o garçom não entra pelo link/);
        await palco.destacar(aviso, { folga: 6 });
        await palco.mover(aviso, { ms: 350 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "As permissões",
      fala: "Abaixo ficam as permissões do garçom pelo link: fechar a conta, dar desconto, liberar mesa, tirar a taxa de serviço e remover item já lançado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const form = formulario(p);
        // A janela agora rola por dentro (cabe na tela): primeiro ela desce até as permissões.
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(permissao(p, "Pode remover item"), { bloco: "end" });
        const caixas = [permissao(p, "Pode fechar a conta"), permissao(p, "Pode remover item")];
        await palco.camera(caixas, { zoomMax: 1.7, margem: 16 });
        const titulos = ["Pode fechar a conta", "Pode dar desconto", "Pode liberar mesa", "Pode tirar a taxa", "Pode remover item"];
        for (const [i, t] of titulos.entries()) {
          await ctx.ate(0.33 + i * 0.13);
          await palco.mover(form.locator("label").filter({ hasText: t }).locator("span"), { ms: 200 });
        }
        await ctx.ate(1);
      },
    },
    {
      fala: "Todas vêm marcadas. Desmarque o que ele não deve fazer. Aqui, este garçom não vai dar desconto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const desconto = permissao(p, "Pode dar desconto");
        await ctx.ate(0.45);
        await palco.destacar(desconto, { folga: 6 });
        await palco.clicar(desconto.locator("input"), { ms: 260 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para terminar, clique em Salvar, no fim da janela. O garçom novo aparece na lista.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        const salvar = formulario(p).getByRole("button", { name: "Salvar", exact: true });
        await palco.rolarAte(salvar, { bloco: "end" });
        await ctx.ate(0.3);
        await palco.clicar(salvar, { ms: 400 });
        await linha(p, "Tiago").waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(linha(p, "Tiago"), { folga: 0 });
        await palco.mover(linha(p, "Tiago").locator("td").first(), { ms: 300 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O link do garçom",
      fala: "Aqui em cima fica o link de acesso. Clique em Copiar link e mande para o garçom.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const caixa = p.getByText("Link de acesso do garçom").locator("xpath=../..");
        await palco.camera(caixa, { zoomMax: 1.35, margem: 24 });
        await palco.destacar(caixa, { folga: 0 });
        await palco.mover(p.locator("#link-do-garcom"), { ms: 350 });
        await ctx.ate(0.45);
        await palco.apagarDestaque();
        await palco.clicar(p.getByRole("button", { name: "Copiar link" }).first(), { ms: 260 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      fala: "Ele entra com o login e a senha, e vê só as mesas, nada mais do painel. O segundo link abre a tela feita para celular.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const explicacao = p.getByText(/Mande um destes links para a equipe/);
        await palco.destacar(explicacao, { folga: 6 });
        await palco.mover(explicacao, { ms: 350 });
        await ctx.ate(0.6);
        const celular = p.locator("#link-do-garcom-celular");
        await palco.destacar([p.getByText("Módulo garçom para celular"), celular], { folga: 8 });
        await palco.mover(celular, { ms: 300 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 600 });
      },
    },
    {
      capitulo: "A lista de garçons",
      fala: "Na lista você vê o login de cada um e se ele está ativo. O lápis edita o cadastro e troca a senha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tabela = p.locator("table");
        await palco.camera(tabela, { zoomMax: 1.3, margem: 20 });
        const juliana = linha(p, "Juliana");
        await ctx.ate(0.14);
        // a coluna inteira: da primeira à última linha da lista
        const coluna = (n) => [p.locator("tbody tr").first().locator("td").nth(n), p.locator("tbody tr").last().locator("td").nth(n)];
        await palco.destacar(coluna(2), { folga: 0 });
        await palco.mover(juliana.locator("td").nth(2), { ms: 300 });
        await ctx.ate(0.4);
        await palco.destacar(coluna(3), { folga: 0 });
        await palco.mover(juliana.locator("td").nth(3), { ms: 250 });
        await ctx.ate(0.62);
        const lapis = juliana.locator("td").last().locator("button").nth(1);
        await palco.destacar(lapis, { folga: 6 });
        await palco.mover(lapis, { ms: 300 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 600 });
      },
    },
    {
      capitulo: "A comissão do garçom",
      fala: "Para ver quanto o garçom tem a receber, clique em Relatório.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const relatorio = linha(p, "Juliana").getByRole("button", { name: "Relatório" });
        await palco.destacar(relatorio, { folga: 6 });
        await palco.mover(relatorio, { ms: 350 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(relatorio, { ms: 200 });
        await p.getByText("Comissão Final (A Receber)").waitFor({ state: "visible", timeout: 10_000 });
        await p.getByText("Mesa 4", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Aparecem as mesas atendidas, a taxa de serviço e as gorjetas. A comissão é a soma da taxa de serviço com as gorjetas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartoes = p.getByText("Mesas Atendidas", { exact: true }).locator("xpath=../..");
        const cartao = (titulo) => p.getByText(titulo, { exact: true }).locator("xpath=..");
        await palco.camera(cartoes, { zoomMax: 1.3, margem: 30 });
        await palco.mover(cartao("Mesas Atendidas"), { ms: 300 });
        await ctx.ate(0.22);
        await palco.mover(cartao("Taxa de Serviço (10%)"), { ms: 250 });
        await ctx.ate(0.38);
        await palco.mover(cartao("Gorjetas Extras"), { ms: 230 });
        await ctx.ate(0.55);
        await palco.destacar(cartao("Comissão Final (A Receber)"), { folga: 4 });
        await palco.mover(cartao("Comissão Final (A Receber)"), { ms: 250 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Logo abaixo fica o histórico, mesa por mesa. Quando o cliente não paga a taxa de serviço, aparece o aviso Não pagou.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const historico = p.locator("table");
        await palco.camera(historico, { zoomMax: 1.3, margem: 30 });
        await palco.mover(p.getByText("Mesa 4", { exact: true }), { ms: 350 });
        await ctx.ate(0.5);
        const naoPagou = p.getByText("Não pagou");
        await palco.destacar(naoPagou.locator("xpath=.."), { folga: 8 });
        await palco.mover(naoPagou, { ms: 300 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "E você escolhe o dia: hoje, ontem ou um período.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const hoje = p.getByRole("button", { name: "Hoje", exact: true });
        const periodo = p.getByRole("button", { name: "Período", exact: true });
        // Cena curta: um destaque e um movimento só (a fala dura menos de cinco segundos).
        await palco.destacar([hoje, periodo], { folga: 8 });
        await palco.mover(hoje, { ms: 200 });
        await ctx.ate(0.6);
        await palco.mover(periodo, { ms: 220 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Relatório de Mesas",
      fala: "O Relatório de Mesas junta a loja inteira: a taxa de serviço de cada garçom e, mais abaixo, as vendas por origem: balcão, mesa, delivery e retirada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(voltar(p), { ms: 260 });
        const botao = p.getByRole("button", { name: "Relatório de Mesas" });
        await botao.waitFor({ state: "visible", timeout: 8000 });
        await palco.clicar(botao, { ms: 260 });
        const porGarcom = p.getByText("Taxa de serviço por garçom");
        await porGarcom.waitFor({ state: "visible", timeout: 10_000 });
        await p.locator("table").first().getByText("Juliana").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.3);
        await palco.destacar(p.locator("table").first(), { folga: 4 });
        await palco.mover(p.locator("table").first().getByText("Juliana"), { ms: 300 });
        await ctx.ate(0.52);
        await palco.apagarDestaque();
        await palco.rolarPagina(400);
        const origem = p.locator("table").nth(1);
        await palco.mover(origem.getByText("Balcão"), { ms: 250 });
        await ctx.ate(0.78);
        await palco.mover(origem.getByText("Mesa", { exact: true }), { ms: 200 });
        await ctx.ate(0.86);
        await palco.mover(origem.getByText("Delivery", { exact: true }), { ms: 200 });
        await ctx.ate(0.94);
        await palco.mover(origem.getByText(/^Retirada/), { ms: 200 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso a equipe do salão já pode trabalhar. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        // volta ao alto da página, onde fica a barra com o botão
        await palco.rolarPagina(0);
        await ctx.ate(0.5);
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 450 });
        }
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
