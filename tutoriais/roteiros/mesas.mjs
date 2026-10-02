// Tutorial da tela de Mesas (/store/mesas).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import { dormir } from "../motor/palco.mjs";

// Sobre o "ms" dos gestos: o mover do palco anda em passos de 16 ms nominais,
// mas com a captura ligada cada passo custa de 35 a 65 ms. Um movimento de
// 700 ms nominais leva de 1,5 a 2,6 s de verdade e a cena estoura a fala. Por
// isso todo gesto daqui leva um ms curto (200 a 350).

/**
 * Clica no campo e escreve o texto aos pedaços. Tecla por tecla, com a captura
 * ligada, cada letra custa quase meio segundo e a cena estoura a fala.
 */
async function digitar(palco, alvo, texto) {
  await palco.clicar(alvo, { ms: 260 });
  for (let i = 0; i < texto.length; i += 2) {
    await palco.pagina.keyboard.insertText(texto.slice(i, i + 2));
    await dormir(120);
  }
  await dormir(200);
}

/** Os dados do salão: mesas, dois ambientes, garçons e três mesas já ocupadas. */
export async function prepararSalao(prisma, { loja, produtos, haMin }) {
  const L = loja.id;

  // Dois ambientes (a tela chama de "andares"): cada um vira um botão no alto do mapa.
  await prisma.user.update({
    where: { id: L },
    data: {
      taxaServicoPadrao: 10,
      printerConfig: {
        andares: [
          { id: "andar_salao", nome: "Salão", mesas: "1-6", impressoras: [] },
          { id: "andar_varanda", nome: "Varanda", mesas: "7-10", impressoras: [] },
        ],
      },
    },
  });

  const mesas = {};
  for (let n = 1; n <= 10; n++) {
    mesas[n] = await prisma.table.create({ data: { franchiseeId: L, number: n, capacity: 4, sortOrder: n } });
  }

  const juliana = await prisma.waiter.create({ data: { franchiseeId: L, name: "Juliana", phone: "11966660001", commissionRate: 10 } });
  const marcos = await prisma.waiter.create({ data: { franchiseeId: L, name: "Marcos", phone: "11966660002", commissionRate: 10 } });

  let numero = 8; // a loja-base já usou do 1 ao 7
  /** Um pedido lançado na mesa, igual ao que a tela cria (lib/lancar-na-mesa.ts). */
  const lancar = async (sessao, mesa, cliente, linhas, quando) => {
    await prisma.customerOrder.create({
      data: {
        franchiseeId: L, dailyOrderNumber: numero++, customerName: cliente, customerPhone: "00000000000",
        customerAddress: `Mesa ${mesa}`, deliveryType: "MESA", paymentMethod: "N/A", deliveryFee: 0,
        status: "ACEITO", source: "PRESENCIAL", tableSessionId: sessao.id, createdAt: quando, acceptedAt: quando,
        totalAmount: linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 0),
        items: { create: linhas.map(([nome, quantity, tableGuestId]) => ({
          menuProductId: produtos[nome].id, productName: nome, quantity, price: produtos[nome].price, tableGuestId: tableGuestId || null,
        })) },
      },
    });
  };
  const abrir = (mesa, dados) => prisma.tableSession.create({ data: { tableId: mesas[mesa].id, franchiseeId: L, status: "OPEN", ...dados } });

  // Mesa 2: duas pessoas cadastradas, cada item no nome de quem pediu — é a mesa que o vídeo fecha.
  // (Sem item "da mesa toda" de propósito: ver o relatório — a taxa do item dividido cai inteira na primeira pessoa.)
  const s2 = await abrir(2, { customerName: "Ana e Pedro", waiterId: juliana.id, waiterName: "Juliana", notes: "Aniversário", openedAt: haMin(52) });
  const ana = await prisma.tableGuest.create({ data: { tableSessionId: s2.id, name: "Ana", sortOrder: 0 } });
  const pedro = await prisma.tableGuest.create({ data: { tableSessionId: s2.id, name: "Pedro", sortOrder: 1 } });
  await lancar(s2, 2, "Ana e Pedro", [["X-Burger", 1, ana.id], ["X-Bacon", 1, pedro.id]], haMin(47));
  await lancar(s2, 2, "Ana e Pedro", [["Coca-Cola lata", 1, ana.id], ["Coca-Cola lata", 1, pedro.id]], haMin(30));

  // Mesa 5: ocupada, sem garçom.
  const s5 = await abrir(5, { customerName: "Roberto", openedAt: haMin(24) });
  await lancar(s5, 5, "Roberto", [["Pizza Calabresa", 1], ["Guaraná 2 L", 1]], haMin(22));

  // Mesa 8: na Varanda.
  const s8 = await abrir(8, { customerName: "Carla", waiterId: marcos.id, waiterName: "Marcos", openedAt: haMin(71) });
  await lancar(s8, 8, "Carla", [["X-Tudo", 2], ["Coca-Cola lata", 2]], haMin(65));

  return { mesas, juliana, marcos };
}

const doisDigitos = (n) => String(n).padStart(2, "0");
/** O quadrado de uma mesa no mapa. */
const cartao = (p, n) => p.locator(".mesa-cartao").filter({ has: p.locator(".mesa-cartao-numero", { hasText: new RegExp(`^${doisDigitos(n)}$`) }) });
/** O painel lateral da mesa selecionada. */
const painel = (p) => p.locator(".mesa-detalhe");
/** A janela de fechar a conta. */
const janelaDaConta = (p) => p.locator(".mesa-modal-conta");
/**
 * A tela de Mesas é mais alta que a janela (o painel fica com 100% da altura
 * ABAIXO da barra do topo): o Total do painel nasce fora da tela. Rolar a
 * página até o fim traz o rodapé do painel para a imagem.
 */
const ATE_O_FIM = 400;

export default {
  id: "mesas",
  titulo: "Como usar as Mesas",
  rota: "store/mesas",
  prontaQuando: ".mesa-cartao",
  preparar: prepararSalao,

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Mesas. É por aqui que você cuida do salão: abre a mesa, lança os pedidos e fecha a conta.",
      acao: async (palco) => {
        await dormir(900);
        await palco.mover({ x: 760, y: 420 }, { ms: 650 });
      },
    },
    {
      capitulo: "O mapa de mesas",
      fala: "Cada quadrado é uma mesa. Bolinha verde, mesa livre. Bolinha vermelha, mesa ocupada: aparecem o nome do cliente, o garçom e quanto a mesa já consumiu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const livre = cartao(p, 1), ocupada = cartao(p, 2);
        await palco.camera([livre, cartao(p, 3)], { zoomMax: 1.8, margem: 46 });
        await ctx.ate(0.2);
        await palco.destacar(livre, { folga: 5 });
        await palco.mover(livre.getByText("Livre"), { ms: 250 });
        await ctx.ate(0.4);
        await palco.destacar(ocupada, { folga: 5 });
        await palco.mover(ocupada.locator(".mesa-cartao-numero"), { ms: 250 });
        await ctx.ate(0.62);
        await palco.mover(ocupada.locator(".mesa-cartao-nome"), { ms: 230 });
        await ctx.ate(0.76);
        await palco.mover(ocupada.locator(".mesa-cartao-garcom"), { ms: 200 });
        await ctx.ate(0.86);
        await palco.mover(ocupada.locator(".mesa-cartao-valor"), { ms: 200 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No alto você vê quantas mesas estão livres, quantas ocupadas e o total em consumo. E, se o salão tem mais de um ambiente, cada um ganha um botão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const numeros = p.locator(".mesa-topo-numeros");
        const varanda = p.getByRole("button", { name: /^Varanda/ });
        const todos = p.getByRole("button", { name: /Todos/ });
        await palco.camera([numeros, varanda], { zoomMax: 1.7, margem: 60 });
        await palco.destacar(numeros.locator("xpath=.."), { folga: 8 });
        await palco.mover(numeros, { ms: 300 });
        await ctx.ate(0.45);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 600 });
        await palco.destacar([todos, varanda], { folga: 8 });
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.clicar(varanda, { ms: 260 });
        await ctx.ate(1);
        await dormir(600);
        await palco.clicar(todos, { ms: 260 });
      },
    },
    {
      capitulo: "Abrir uma mesa",
      fala: "Para abrir uma mesa, clique numa mesa livre.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.45);
        await palco.clicar(cartao(p, 3), { ms: 260 });
        await p.getByText("Ocupar Mesa 3?").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Se quiser, escreva o nome do cliente e escolha o garçom. Depois, clique em Ocupar Mesa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const janela = p.getByText("Ocupar Mesa 3?").locator("xpath=../..");
        await palco.camera(janela, { zoomMax: 1.45, margem: 30 });
        await digitar(palco, p.getByPlaceholder("Ex: João, Família Silva..."), "Marina");
        await ctx.ate(0.5);
        const lista = janela.locator("select");
        await palco.apontar(lista, { ms: 280 });
        await lista.selectOption({ label: "Juliana" });
        await ctx.ate(0.78);
        await palco.clicar(janela.getByRole("button", { name: /Ocupar Mesa/ }), { ms: 260 });
        await painel(p).getByText("Mesa 3", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
        await palco.cameraAberta({ ms: 600 });
        await palco.destacar(cartao(p, 3), { folga: 5 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Lançar o pedido",
      fala: "Com a mesa aberta, clique em Novo Pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const novo = painel(p).getByRole("button", { name: "+ Novo Pedido" });
        await palco.destacar(novo, { folga: 6 });
        await palco.mover(novo, { ms: 350 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(novo, { ms: 260 });
        await p.locator(".mesa-produtos > div").first().waitFor({ state: "visible", timeout: 10_000 });
        await palco.mover({ x: 330, y: 300 }, { ms: 300 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Clique nos produtos que o cliente pediu: eles vão para o carrinho, aqui ao lado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const produto = (nome) => p.locator(".mesa-produtos > div").filter({ hasText: nome }).first();
        await palco.clicar(produto("X-Burger"), { ms: 260 });
        await ctx.ate(0.36);
        await palco.clicar(produto("Coca-Cola lata"), { ms: 260 });
        await ctx.ate(0.68);
        const carrinho = p.locator(".mesa-comanda");
        await palco.destacar(carrinho, { folga: 0 });
        await palco.mover(carrinho.getByText("Coca-Cola lata"), { ms: 350 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Confira e clique em Enviar Pedido para Mesa. O pedido entra na conta e vai para a cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const enviar = p.getByRole("button", { name: /Enviar Pedido para Mesa/ });
        await palco.mover(p.locator(".mesa-comanda").getByText("Total", { exact: true }), { ms: 300 });
        await ctx.ate(0.25);
        await palco.clicar(enviar, { ms: 260 });
        await painel(p).getByText(/X-Burger/).waitFor({ state: "visible", timeout: 10_000 });
        await palco.rolarPagina(ATE_O_FIM);
        await ctx.ate(1);
      },
    },
    {
      capitulo: "A conta e a taxa de serviço",
      fala: "O painel da mesa mostra os pedidos, o consumo, a taxa de serviço e o total.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const pn = painel(p);
        const pedidos = pn.getByText("Pedidos da mesa").locator("xpath=..");
        const rodape = pn.locator("> div").last();
        await palco.camera([pedidos, rodape], { zoomMax: 1.6, margem: 30 });
        await ctx.ate(0.3);
        await palco.mover(pn.getByText(/X-Burger/), { ms: 250 });
        await ctx.ate(0.5);
        await palco.destacar(rodape, { folga: 0 });
        await palco.mover(rodape.getByText("Consumo"), { ms: 250 });
        await ctx.ate(0.68);
        await palco.mover(rodape.getByText("Taxa de serviço"), { ms: 200 });
        await ctx.ate(0.88);
        await palco.mover(rodape.getByText("Total", { exact: true }), { ms: 200 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A taxa de serviço já vem preenchida. Se o cliente não quiser pagar, é só desmarcar. Marcou de novo, ela volta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const caixa = painel(p).locator("input[type=checkbox]");
        await palco.mover(caixa, { ms: 300 });
        await ctx.ate(0.52);
        await palco.clicar(caixa, { ms: 200 });
        await ctx.ate(0.84);
        await palco.clicar(caixa, { ms: 200 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Para o cliente conferir, o botão Imprimir comanda manda a conta para a impressora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const imprimir = painel(p).getByRole("button", { name: /Imprimir comanda/ });
        const pn = painel(p);
        // o cabeçalho do painel e os quatro botões de ação
        await palco.camera([pn.locator("> div").nth(0), pn.locator("> div").nth(1)], { zoomMax: 1.7, margem: 44 });
        await palco.destacar(imprimir, { folga: 6 });
        await palco.mover(imprimir, { ms: 350 });
        await ctx.ate(1);
        await dormir(150);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 450 });
        await palco.mover(cartao(p, 2).locator(".mesa-cartao-numero"), { ms: 200 });
      },
    },
    {
      capitulo: "Dividir a conta",
      fala: "Para dividir a conta, cadastre as pessoas da mesa e lance cada item no nome de quem pediu. Nesta outra mesa isso já foi feito.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const pn = painel(p);
        await palco.clicar(cartao(p, 2), { ms: 200 });
        await pn.getByText("Pessoas (2)").waitFor({ state: "visible", timeout: 10_000 });
        const pessoas = pn.getByText("Pessoas (2)").locator("xpath=../..");
        const pedidos = pn.getByText("Pedidos da mesa").locator("xpath=..");
        await palco.camera([pessoas, pedidos], { zoomMax: 1.6, margem: 26 });
        await palco.destacar(pessoas, { folga: 0 });
        await palco.mover(pessoas.getByText("Ana", { exact: false }).first(), { ms: 300 });
        await ctx.ate(0.5);
        await palco.destacar(pedidos, { folga: 0 });
        await palco.mover(pedidos.getByText(/X-Burger/), { ms: 300 });
        await ctx.ate(0.75);
        await palco.mover(pedidos.getByText(/X-Bacon/), { ms: 250 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
        await palco.mover(pn.getByRole("button", { name: /Fechar Conta/ }), { ms: 300 });
      },
    },
    {
      fala: "Clique em Fechar Conta: a tela mostra quanto cada pessoa paga, já com a taxa de serviço.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(painel(p).getByRole("button", { name: /Fechar Conta/ }), { ms: 260 });
        const janela = janelaDaConta(p);
        const pagar = janela.getByRole("button", { name: "+ pagar" });
        await pagar.nth(1).waitFor({ state: "visible", timeout: 10_000 });
        const linhaDoPedro = pagar.nth(1).locator("xpath=../../..");
        await palco.rolarAte(linhaDoPedro, { bloco: "end" });
        const lista = linhaDoPedro.locator("xpath=..");
        await palco.camera(lista, { zoomMax: 1.6, margem: 40 });
        await palco.destacar(lista, { folga: 4 });
        await palco.mover(janela.getByText("R$ 31,90").first(), { ms: 300 });
        await ctx.ate(0.8);
        await palco.mover(janela.getByText("R$ 37,40").first(), { ms: 250 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Receber o pagamento",
      fala: "Ao lado do nome, clique em pagar. Escolha a forma de pagamento e clique em Registrar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const janela = janelaDaConta(p);
        await ctx.ate(0.08);
        await palco.clicar(janela.getByRole("button", { name: "+ pagar" }).first(), { ms: 260 });
        const bloco = janela.getByText("Registrar pagamento — de quem?").locator("xpath=..");
        await palco.rolarAte(bloco, { bloco: "end" });
        await palco.camera(bloco, { zoomMax: 1.6, margem: 40, ms: 500 });
        const forma = bloco.locator("select");
        await ctx.ate(0.42);
        await palco.apontar(forma, { ms: 280 });
        await forma.selectOption("Pix");
        await ctx.ate(0.76);
        await palco.clicar(bloco.getByRole("button", { name: "Registrar", exact: true }), { ms: 260 });
        await janela.getByText("Recebido (1 pagamento)").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Se a mesa paga tudo junto, escolha A mesa toda. Aqui, falta registrar a outra pessoa, do mesmo jeito.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const janela = janelaDaConta(p);
        const bloco = janela.getByText("Registrar pagamento — de quem?").locator("xpath=..");
        await palco.rolarAte(bloco, { bloco: "end" });
        await palco.camera(bloco, { zoomMax: 1.6, margem: 40, ms: 500 });
        const mesaToda = bloco.getByRole("button", { name: /A mesa toda/ });
        await palco.destacar(mesaToda, { folga: 5 });
        await palco.mover(mesaToda, { ms: 300 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(bloco.getByRole("button", { name: /Pedro/ }), { ms: 260 });
        const forma = bloco.locator("select");
        await ctx.ate(0.62);
        await palco.apontar(forma, { ms: 280 });
        await forma.selectOption("Débito");
        await ctx.ate(0.84);
        await palco.clicar(bloco.getByRole("button", { name: "Registrar", exact: true }), { ms: 260 });
        await janela.getByText(/Conta fechada/).waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Fechar a mesa",
      fala: "Quando não falta mais nada, aparece Conta fechada. Clique em Fechar Conta e Liberar Mesa, e a mesa volta a ficar livre.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const janela = janelaDaConta(p);
        const fechada = janela.getByText(/Conta fechada/).locator("xpath=..");
        const recebidos = janela.getByText(/Pagamentos recebidos/);
        const fechar = janela.getByRole("button", { name: "Fechar Conta e Liberar Mesa" });
        await palco.rolarAte(recebidos, { bloco: "start" });
        await palco.camera([recebidos, fechar], { zoomMax: 1.5, margem: 36, ms: 600 });
        await palco.destacar(fechada, { folga: 6 });
        await palco.mover(fechada, { ms: 300 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(fechar, { ms: 260 });
        await cartao(p, 2).getByText("Livre").waitFor({ state: "visible", timeout: 10_000 });
        await palco.cameraAberta({ ms: 600 });
        await palco.destacar(cartao(p, 2), { folga: 5 });
        await palco.mover(cartao(p, 2).getByText("Livre"), { ms: 350 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Cadastro de mesas",
      fala: "Para criar mesas, use Nova Mesa. Na engrenagem você edita as mesas, separa os andares e baixa o QR Code de cada mesa, para o cliente pedir pelo celular.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nova = p.getByRole("button", { name: "+ Nova Mesa" });
        const engrenagem = p.getByRole("button", { name: "⚙️" });
        await palco.destacar(nova, { folga: 6 });
        await palco.mover(nova, { ms: 350 });
        await ctx.ate(0.22);
        await palco.apagarDestaque();
        await palco.clicar(engrenagem, { ms: 260 });
        const titulo = p.getByText("Gerenciar Mesas");
        await titulo.waitFor({ state: "visible", timeout: 8000 });
        const janela = titulo.locator("xpath=../..");
        await palco.camera(janela, { zoomMax: 1.3, margem: 24 });
        await ctx.ate(0.36);
        await palco.mover(janela.getByRole("button", { name: /Editar/ }).first(), { ms: 250 });
        await ctx.ate(0.5);
        await palco.clicar(janela.getByRole("button", { name: /Andares/ }), { ms: 260 });
        await ctx.ate(0.68);
        await palco.clicar(janela.getByRole("button", { name: /QR Code/ }), { ms: 260 });
        await janela.getByText("Um QR para cada mesa").waitFor({ state: "visible", timeout: 8000 });
        await palco.mover(janela.getByRole("button", { name: /Baixar$/ }).first(), { ms: 300 });
        await ctx.ate(1);
        await dormir(300);
        await palco.cameraAberta({ ms: 450 });
      },
    },
    {
      fala: "E o botão Celular abre a versão desta tela feita para o telefone.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // fecha a janela da engrenagem, que ficou aberta na cena anterior
        await palco.clicar(p.getByText("Gerenciar Mesas").locator("xpath=..").getByRole("button"), { ms: 220 });
        const celular = p.getByRole("link", { name: /Celular/ });
        await palco.camera([celular, p.getByRole("button", { name: "⚙️" })], { zoomMax: 1.8, margem: 80, ms: 500 });
        await palco.destacar(celular, { folga: 6 });
        await palco.mover(celular, { ms: 250 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você já atende o salão por aqui. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        // volta a mostrar a tela inteira, com a barra do topo
        await palco.cameraAberta({ ms: 500 });
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
