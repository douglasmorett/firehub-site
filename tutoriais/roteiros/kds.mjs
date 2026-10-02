// Tutorial do KDS, a tela da cozinha (/store/kds e /store/kds/tela).
//
// A tela tem duas partes: o painel (/store/kds), onde a loja cria as telas, e
// a tela cheia (/store/kds/tela), que fica na TV da cozinha e não tem a barra
// do topo. O painel abre a tela cheia em OUTRA aba; no vídeo ela abre na
// mesma, para a gravação acompanhar (tirarNovaAba). O vídeo começa e termina
// no painel, que é onde o botão Tutorial aparece.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import { dormir } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

const haMin = (m) => new Date(Date.now() - m * 60_000);

/** O cartão do pedido na tela cheia: o quadro que tem o número "#n" e recebe o toque. */
const cartao = (p, n) => p.locator("div[style*='cursor: pointer']").filter({ has: p.getByText(`#${n}`, { exact: true }) }).first();
/** O relógio do cartão (o tempo e a etapa escrita embaixo). */
const relogio = (p, n) => cartao(p, n).getByText(/^\d{2}:\d{2}$/).locator("xpath=..");
/** O cartão de uma tela no painel do KDS. */
const cartaoDaTela = (p, nome) => p.locator("div").filter({ has: p.getByText(nome, { exact: true }) }).filter({ has: p.getByText("ABRIR TELA") }).last();
/** A janela "Nova Tela". */
const janela = (p) => p.locator("div").filter({ has: p.getByText("Nome da tela", { exact: true }) }).last();
const adicionar = (p) => p.getByRole("button", { name: "+ Adicionar Tela" }).first();

/** O painel abre a tela em outra aba; a gravação segue uma aba só. */
async function tirarNovaAba(p) {
  await p.evaluate(() => document.querySelectorAll('a[target="_blank"]').forEach((a) => a.removeAttribute("target")));
}

/** O campo do nome já vem preenchido ("Tela 1"): seleciona tudo e escreve por cima. */
async function escreverNome(palco, texto) {
  const p = palco.pagina;
  await palco.clicar(p.getByPlaceholder("Ex: Produção 1"));
  await p.keyboard.press("Control+A");
  await p.keyboard.type(texto, { delay: 85 });
  await dormir(250);
}

/** O pedido que "chega" na cozinha durante a gravação. */
async function chegarPedidoNaCozinha(prisma) {
  const loja = await prisma.user.findUnique({ where: { email: LOJA.email } });
  const lista = await prisma.menuProduct.findMany({ where: { franchiseeId: loja.id } });
  const prod = Object.fromEntries(lista.map((x) => [x.name, x]));
  return prisma.customerOrder.create({
    data: {
      franchiseeId: loja.id, source: "ONLINE", dailyOrderNumber: 9, status: "ACEITO",
      customerName: "Mariana Costa", customerPhone: "11977770009", deliveryType: "DELIVERY", deliveryFee: 6, motoboyFee: 6,
      customerAddress: "Rua das Flores, 210 - Centro", paymentMethod: "PIX",
      totalAmount: 6 + prod["X-Tudo"].price + prod["Batata Frita"].price,
      acceptedAt: new Date(), kdsStage: "PRODUCTION", kdsProductionAt: new Date(),
      items: { create: [
        { menuProductId: prod["X-Tudo"].id, productName: "X-Tudo", quantity: 1, price: prod["X-Tudo"].price },
        { menuProductId: prod["Batata Frita"].id, productName: "Batata Frita", quantity: 1, price: prod["Batata Frita"].price },
      ] },
    },
  });
}

export default {
  id: "kds",
  titulo: "Como usar a tela da cozinha",
  rota: "store/kds",
  prontaQuando: "text=Nenhuma tela configurada",
  pronuncia: { KDS: "cá dê esse" },

  /**
   * A cozinha no começo do vídeo: três pedidos em produção, um de cada cor do
   * relógio (vermelho, laranja e verde), e nenhuma tela criada ainda.
   * Os tempos contam com o vídeo andando: o verde não chega a cinco minutos e
   * o laranja não chega a dez antes de a cena do relógio passar.
   */
  async preparar(prisma, { loja, produtos }) {
    const L = loja.id;
    // O pedido que já saiu para entrega passou pela cozinha: não fica na tela.
    await prisma.customerOrder.updateMany({ where: { franchiseeId: L, dailyOrderNumber: 5 }, data: { kdsStage: "FINISHED" } });
    // #6: o mais antigo, já passou de dez minutos (vermelho). Leva as duas observações: a do item e a do pedido.
    await prisma.customerOrder.updateMany({
      where: { franchiseeId: L, dailyOrderNumber: 6 },
      data: { kdsStage: "PRODUCTION", kdsProductionAt: haMin(11.5), notes: "Caprichar no molho, por favor." },
    });
    const seis = await prisma.customerOrder.findFirst({ where: { franchiseeId: L, dailyOrderNumber: 6 }, include: { items: true } });
    const bacon = seis.items.find((i) => i.productName === "X-Bacon");
    if (bacon) await prisma.customerOrderItem.update({ where: { id: bacon.id }, data: { notes: "Um sem cebola" } });
    // #7: passou de cinco minutos (laranja).
    await prisma.customerOrder.updateMany({
      where: { franchiseeId: L, dailyOrderNumber: 7 },
      data: { kdsStage: "PRODUCTION", kdsProductionAt: haMin(5.4), source: "ONLINE", createdAt: haMin(6), acceptedAt: haMin(5.4) },
    });
    // #8: acabou de entrar (verde).
    await prisma.customerOrder.create({
      data: {
        franchiseeId: L, source: "ONLINE", dailyOrderNumber: 8, status: "PREPARANDO",
        customerName: "Juliana Prado", customerPhone: "11977770010", deliveryType: "DELIVERY", deliveryFee: 6, motoboyFee: 6,
        customerAddress: "Rua do Mercado, 58 - Centro", paymentMethod: "PIX",
        totalAmount: 6 + produtos["Pizza Calabresa"].price + produtos["Coca-Cola lata"].price * 2,
        createdAt: haMin(1.2), acceptedAt: haMin(1.1), kdsStage: "PRODUCTION", kdsProductionAt: haMin(1.1),
        items: { create: [
          { menuProductId: produtos["Pizza Calabresa"].id, productName: "Pizza Calabresa", quantity: 1, price: produtos["Pizza Calabresa"].price },
          { menuProductId: produtos["Coca-Cola lata"].id, productName: "Coca-Cola lata", quantity: 2, price: produtos["Coca-Cola lata"].price },
        ] },
      },
    });
  },

  cenas: [
    {
      capitulo: "O que é o KDS",
      fala: "Este é o KDS, a tela da cozinha. Os pedidos aparecem numa TV ou num monitor, e a cozinha dá o pronto em cada um deles por ali mesmo, com um toque.",
      acao: async (palco) => {
        const p = palco.pagina;
        await dormir(900);
        await palco.mover(p.getByText("KDS — Kitchen Display System"), { ms: 1200 });
      },
    },
    {
      capitulo: "Criar as telas",
      fala: "Para começar, clique em Adicionar Tela. Dê um nome e escolha o tipo: Produção, para quem prepara, ou Finalização, para quem embala e confere.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.04);
        await palco.clicar(adicionar(p));
        const nome = p.getByPlaceholder("Ex: Produção 1");
        await nome.waitFor({ state: "visible", timeout: 8000 });
        const producao = p.getByRole("button", { name: /Produção/ });
        const finalizacao = p.getByRole("button", { name: /Finalização/ });
        await palco.camera([p.getByText("Nova Tela"), producao, finalizacao], { zoomMax: 1.7, margem: 50, ms: 600 });
        await escreverNome(palco, "Cozinha");
        await ctx.ate(0.58);
        await palco.destacar(producao, { folga: 5 });
        await palco.mover(producao, { ms: 500 });
        await ctx.ate(0.8);
        await palco.destacar(finalizacao, { folga: 5 });
        await palco.mover(finalizacao, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Se a cozinha tem mais de uma estação, marque as categorias de cada tela. Sem marcar nenhuma, a tela mostra tudo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = janela(p);
        const fichas = ["Lanches", "Pizzas", "Porções", "Bebidas"].map((c) => j.getByRole("button", { name: new RegExp(c) }));
        await palco.camera([j.getByText(/Filtrar por categoria/), ...fichas, j.getByText(/Você pode mudar o filtro depois/)], { zoomMax: 1.7, margem: 60 });
        await palco.destacar(fichas, { folga: 8 });
        await ctx.ate(0.3);
        await palco.mover(fichas[1], { ms: 600 });
        await ctx.ate(0.5);
        await palco.mover(fichas[0], { ms: 500 });
        await ctx.ate(0.65);
        await palco.apagarDestaque();
        await palco.destacar(j.getByText(/Filtrar por categoria/), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Criar Tela. Depois, crie do mesmo jeito uma tela de Finalização: o pedido passa pelas duas antes de sair da cozinha.",
      acao: async (palco) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await palco.clicar(p.getByRole("button", { name: "Criar Tela" }));
        await cartaoDaTela(p, "Cozinha").waitFor({ state: "visible", timeout: 8000 });
        await dormir(500);
        await palco.clicar(adicionar(p));
        await p.getByPlaceholder("Ex: Produção 1").waitFor({ state: "visible", timeout: 8000 });
        await escreverNome(palco, "Expedição");
        await palco.clicar(p.getByRole("button", { name: /Finalização/ }));
        await dormir(300);
        await palco.clicar(p.getByRole("button", { name: "Criar Tela" }));
        await cartaoDaTela(p, "Expedição").waitFor({ state: "visible", timeout: 8000 });
      },
    },
    {
      capitulo: "Abrir a tela na cozinha",
      fala: "Cada tela vira um cartão. Clique em Abrir Tela e deixe aberta na TV da cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const telas = [cartaoDaTela(p, "Cozinha"), cartaoDaTela(p, "Expedição")];
        await palco.camera(telas, { zoomMax: 1.5, margem: 50 });
        await palco.destacar(telas, { folga: 8 });
        await ctx.ate(0.34);
        await palco.apagarDestaque();
        await tirarNovaAba(p);
        await palco.clicar(telas[0].getByText("ABRIR TELA"));
        await palco.cameraAberta({ ms: 400 });
        await cartao(p, 6).waitFor({ state: "visible", timeout: 30_000 });
        await palco.mover({ x: 700, y: 520 }, { ms: 700 });
      },
    },
    {
      capitulo: "Os pedidos na tela",
      fala: "Cada cartão é um pedido. Ele mostra o número, se é delivery ou retirada, os itens e, em destaque, a observação do cliente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 6);
        await palco.camera(c, { zoomMax: 1.8, margem: 40 });
        await ctx.ate(0.3);
        await palco.mover(c.getByText("#6", { exact: true }), { ms: 500 });
        await ctx.ate(0.45);
        await palco.mover(c.getByText(/Delivery/), { ms: 500 });
        await ctx.ate(0.66);
        await palco.mover(c.getByText("X-Bacon"), { ms: 500 });
        await ctx.ate(0.78);
        await palco.destacar(c.getByText(/Um sem cebola/), { folga: 8 });
        await palco.mover(c.getByText(/Um sem cebola/), { ms: 450 });
        await ctx.ate(0.93);
        await palco.destacar(c.getByText(/Caprichar no molho/).locator("xpath=.."), { folga: 4 });
        await palco.mover(c.getByText(/Caprichar no molho/), { ms: 450 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Pedido novo entra sozinho na tela, sem ninguém precisar atualizar. O contador, aqui em cima, mostra quantos pedidos estão na fila.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta();
        await chegarPedidoNaCozinha(ctx.prisma);
        await palco.mover({ x: 560, y: 600 }, { ms: 700 });
        await cartao(p, 9).waitFor({ state: "visible", timeout: 20_000 });
        await dormir(450);
        await palco.destacar(cartao(p, 9), { folga: 6 });
        await ctx.ate(0.55);
        const contador = p.getByText(/^\d+ pedidos?$/);
        await palco.destacar(contador, { folga: 8 });
        await palco.mover(contador, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O relógio e as cores",
      fala: "O relógio mostra há quanto tempo o pedido está na cozinha. Até cinco minutos, fica verde. Passou de cinco, laranja. Passou de dez, vermelho, e a borda do cartão muda junto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ver = (n) => palco.camera(cartao(p, n), { zoomMax: 1.5, margem: 40, ms: 600 });
        await Promise.all([ver(8), palco.destacar(relogio(p, 8), { folga: 8 })]);
        await palco.mover(relogio(p, 8), { ms: 600 });
        await ctx.ate(0.5);
        await Promise.all([ver(7), palco.destacar(relogio(p, 7), { folga: 8 })]);
        await palco.mover(relogio(p, 7), { ms: 500 });
        await ctx.ate(0.64);
        await Promise.all([ver(6), palco.destacar(relogio(p, 6), { folga: 8 })]);
        await palco.mover(relogio(p, 6), { ms: 500 });
        await ctx.ate(0.8);
        await palco.destacar(cartao(p, 6), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Dar o pronto",
      fala: "Quando o pedido ficar pronto, toque no cartão. Ou aperte, no teclado, o número que aparece na bolinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 600 });
        await ctx.ate(0.22);
        await palco.clicar(cartao(p, 6).getByText("Batata Frita"));
        await ctx.ate(0.6);
        const bolinha = cartao(p, 7).getByText("1", { exact: true });
        await palco.destacar(bolinha, { folga: 8 });
        await palco.mover(bolinha, { ms: 600 });
        await ctx.ate(0.9);
        const dica = p.getByText(/em destaque para dar/).locator("xpath=..");
        await palco.destacar(dica, { folga: 4 });
        await palco.mover(dica, { ms: 700 });
        await ctx.ate(1);
        await dormir(900);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Desfazer",
      fala: "Deu baixa no pedido errado? Clique em Desfazer, aqui em cima, e ele volta para a tela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(cartao(p, 7).getByText("X-Burger"));
        const desfazer = p.getByRole("button", { name: /Desfazer #7/ });
        await desfazer.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(desfazer, { folga: 6 });
        await ctx.ate(0.48);
        await palco.apagarDestaque();
        await palco.clicar(desfazer);
        await cartao(p, 7).waitFor({ state: "visible", timeout: 12_000 });
        await dormir(350);
        await palco.destacar(cartao(p, 7), { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os filtros da tela",
      fala: "No alto, Ímpares e Pares mostram só os pedidos de número ímpar ou par, e Filtrar por Categoria escolhe as categorias desta tela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const impares = p.getByRole("button", { name: "Ímpares", exact: true });
        const todos = p.getByRole("button", { name: "Todos", exact: true });
        const categoria = p.getByRole("button", { name: /Filtrar por Categoria/ });
        await ctx.ate(0.08);
        await palco.clicar(impares);
        await ctx.ate(0.5);
        await palco.clicar(todos);
        await ctx.ate(0.62);
        await palco.clicar(categoria);
        await p.getByText("CATEGORIAS").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
        await dormir(500);
        await palco.clicar(categoria);
      },
    },
    {
      capitulo: "A tela de Finalização",
      fala: "O pedido que saiu da produção aparece na tela de Finalização. O visto verde marca cada item que a cozinha já terminou.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/kds`, { waitUntil: "load" });
        const tela = cartaoDaTela(p, "Expedição");
        await tela.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(400);
        await tirarNovaAba(p);
        await palco.clicar(tela.getByText("ABRIR TELA"));
        const c = cartao(p, 6);
        await c.waitFor({ state: "visible", timeout: 30_000 });
        await palco.camera(c, { zoomMax: 1.8, margem: 40 });
        await ctx.ate(0.55);
        const vistos = await c.getByText("✓", { exact: true }).all();
        await palco.destacar(vistos, { folga: 6 });
        await palco.mover(vistos[0], { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Embalou e conferiu? Toque no cartão: o pedido sai da cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.4);
        await palco.clicar(cartao(p, 6).getByText("Batata Frita"));
        await palco.cameraAberta({ ms: 600 });
        await ctx.ate(1);
        await dormir(500);
      },
    },
    {
      capitulo: "O selo Pronto Cozinha",
      fala: "Nessa hora, na tela de Pedidos, o cartão ganha o selo Pronto Cozinha: quem está no balcão vê que o pedido já pode sair.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/pedidos-clientes`, { waitUntil: "load" });
        const c = p.locator('[data-droppable="col-preparo"] [draggable]').filter({ hasText: "#6 — " }).first();
        const selo = c.getByText(/✓ Pronto Cozinha/);
        await selo.waitFor({ state: "visible", timeout: 60_000 });
        await palco.camera([c.getByText("#6 — Carlos Mendes"), selo, c.getByText(/Rua das Palmeiras/)], { zoomMax: 1.7, margem: 60 });
        await palco.destacar(selo, { folga: 6 });
        await palco.mover(selo, { ms: 700 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso, a cozinha já pode trabalhar pela tela. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await palco.clicar(p.getByRole("link", { name: /KDS da cozinha/ }));
        await p.getByText("KDS — Kitchen Display System").waitFor({ state: "visible", timeout: 30_000 });
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
