// Tutorial da tela de Estoque (/store/estoque).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que esta tela controla: os INSUMOS (ingredientes) da loja — saldo, mínimo,
// custo — e a ficha técnica que liga cada produto do cardápio aos insumos. A
// baixa por venda sai de lib/stock.ts (pedido aceito, venda do balcão, mesa) e
// o cancelamento devolve. O "estoque por produto" que pausa o item quando zera
// é OUTRA coisa e mora no Cardápio: aqui não se fala dele.
import { dormir } from "../motor/palco.mjs";

const linha = (p, nome) => p.locator(".items-table tbody tr").filter({ hasText: nome }).first();
const aba = (p, nome) => p.locator(".tab-link").filter({ hasText: nome });
const janela = (p) => p.locator(".modal-card");
const ficha = (p, produto) => p.locator(".product-recipe-card").filter({ hasText: produto }).first();

/** Rola a página até o alvo ficar a `topo` pontos do alto da tela. */
async function rolarPara(palco, alvo, topo = 60) {
  const y = await alvo.evaluate((el, t) => Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY - t)), topo);
  await palco.rolarPagina(y);
}

/** Um pedaço da tela para a câmera: do canto de um elemento até o canto de outro. */
async function recorte(de, ate) {
  const a = await de.boundingBox(), b = await ate.boundingBox();
  return { x: a.x, y: a.y, width: b.x + b.width - a.x, height: b.y + b.height - a.y };
}

export default {
  id: "estoque",
  titulo: "Estoque: controlar o que tem e repor",
  rota: "store/estoque",
  prontaQuando: "text=Bacon em fatias",

  /**
   * Sete insumos de uma lanchonete: dois abaixo do mínimo (o Bacon, primeiro da
   * lista, é o que o vídeo repõe), um negativo, e o resto em dia. Três produtos
   * já têm ficha técnica; a Batata Frita fica sem, para o vídeo montar a dela.
   * O histórico traz o saldo inicial, uma compra, uma perda e a baixa das
   * vendas de hoje (no mesmo texto que a baixa automática grava).
   */
  async preparar(prisma, { loja, produtos, haMin }) {
    const L = loja.id;
    const dias = (d) => haMin(d * 24 * 60);
    const insumo = async (name, unit, quantity, minQuantity, unitCost) =>
      prisma.stockItem.create({ data: { franchiseeId: L, name, unit, quantity, minQuantity, unitCost } });

    const bacon = await insumo("Bacon em fatias", "kg", 0.8, 2, 42);
    const batata = await insumo("Batata congelada", "kg", 12, 5, 14);
    const carne = await insumo("Hambúrguer 150 g", "un", 46, 30, 3.5);
    const molho = await insumo("Molho de tomate", "kg", 6, 2, 9);
    const queijo = await insumo("Muçarela fatiada", "kg", 1.5, 3, 38);
    const pao = await insumo("Pão de hambúrguer", "un", 80, 40, 0.9);
    const lata = await insumo("Refrigerante em lata", "un", -4, 24, 3.2);

    const fichaDe = (produto, linhas) => prisma.productRecipe.createMany({
      data: linhas.map(([item, quantityConsumed]) => ({ menuProductId: produtos[produto].id, stockItemId: item.id, quantityConsumed })),
    });
    await fichaDe("X-Burger", [[pao, 1], [carne, 1], [queijo, 0.03]]);
    await fichaDe("X-Bacon", [[pao, 1], [carne, 1], [queijo, 0.03], [bacon, 0.04]]);
    await fichaDe("Coca-Cola lata", [[lata, 1]]);

    const mov = (item, type, quantity, notes, createdAt, extra = {}) =>
      prisma.stockTransaction.create({ data: { stockItemId: item.id, franchiseeId: L, type, quantity, notes, createdAt, ...extra } });

    for (const [item, q] of [[bacon, 3], [batata, 12], [carne, 60], [molho, 6], [queijo, 4], [pao, 100], [lata, 12]]) {
      await mov(item, "INPUT", q, "Saldo inicial de estoque", dias(6));
    }
    await mov(pao, "INPUT", 40, "Compra da semana", dias(2));
    await mov(queijo, "WASTE", -0.5, "Perda por validade", dias(1));

    // A baixa das vendas do dia, uma linha por insumo de cada pedido — como lib/stock.ts grava.
    const pedidos = await prisma.customerOrder.findMany({
      where: { franchiseeId: L, status: { not: "CANCELADO" } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });
    const fichas = await prisma.productRecipe.findMany({ where: { menuProduct: { franchiseeId: L } } });
    const itens = { [bacon.id]: bacon, [carne.id]: carne, [queijo.id]: queijo, [pao.id]: pao, [lata.id]: lata };
    for (const pedido of pedidos) {
      const gasto = new Map();
      for (const item of pedido.items) {
        for (const f of fichas.filter((x) => x.menuProductId === item.menuProductId)) {
          gasto.set(f.stockItemId, (gasto.get(f.stockItemId) || 0) + f.quantityConsumed * item.quantity);
        }
      }
      for (const [stockItemId, q] of gasto) {
        await mov(itens[stockItemId], "SALE", -q, `Baixa automática - Pedido #${pedido.id.slice(-6)} (id: ${pedido.id})`,
          pedido.acceptedAt || pedido.createdAt, { sourceRef: `sale:${pedido.id}:${stockItemId}` });
      }
    }
  },

  /**
   * Dois enfeites da tela pulsam sem parar (o botão flutuante de ajuda e o
   * ícone do quadro "Estoque Negativo") e fariam a captura pintar quadros à
   * toa a gravação inteira. Só o pulso para; os dois continuam no lugar.
   */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: ".fcw-fab-pulse,.kpi-icon-wrapper.pulse{animation:none !important}" });
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Estoque. Aqui você controla os ingredientes da loja, que a tela chama de insumos: quanto tem de cada um, quando repor e o que as vendas gastaram.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(700);
        await palco.mover(p.getByRole("heading", { name: "Controle de estoque" }), { ms: 900 });
        await ctx.ate(0.45);
        await palco.destacar(p.locator("header.fh-cabecalho"), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Este primeiro quadro é o passo a passo da etiqueta com QR, assunto da tela Validade e etiquetas. Clique nele para recolher.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: /Etiqueta com QR/ });
        const quadro = p.locator(".fh-card").filter({ has: titulo });
        await palco.destacar(quadro, { folga: 4 });
        await palco.mover(titulo, { ms: 800 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(titulo, { ms: 300 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Os números do alto",
      fala: "Estes quadros resumem tudo: o total de insumos, quantos estão com estoque baixo, quantos ficaram negativos e quantos produtos já têm ficha técnica.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quadros = p.locator(".kpi-grid").first();
        const quadro = (n) => quadros.locator(".kpi-card").nth(n);
        await palco.camera(quadros, { zoomMax: 1.3, margem: 70 });
        await palco.destacar(quadros, { folga: 8 });
        for (const [i, f] of [0.2, 0.42, 0.62, 0.8].entries()) {
          await ctx.ate(f);
          await palco.mover(quadro(i).locator(".kpi-value"), { ms: 500 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Estoque Baixo para ver de uma vez o que precisa de reposição.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const baixo = p.locator(".kpi-card.warning").first();
        await ctx.ate(0.12);
        await palco.clicar(baixo.locator(".kpi-label"), { ms: 400 });
        const lista = p.locator(".kpi-expanded-panel");
        await lista.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([p.locator(".kpi-grid").first(), lista], { zoomMax: 1.3, margem: 50, ms: 500 });
        await palco.destacar(lista, { folga: 4 });
        await palco.mover(lista.getByText("Bacon em fatias"), { ms: 600 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
        // fecha a lista, para a tabela de insumos voltar ao lugar
        await palco.clicar(baixo.locator(".kpi-label"), { ms: 400 });
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "A lista de insumos",
      fala: "Na lista, cada insumo mostra o saldo atual, o estoque mínimo, o custo e o valor em estoque. Quem chegou no mínimo fica marcado como Estoque Baixo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPara(palco, p.locator(".kpi-grid").first(), 50);
        const cabeca = (texto) => p.locator(".items-table th").filter({ hasText: texto });
        const bacon = linha(p, "Bacon em fatias");
        const selo = bacon.locator(".status-label");
        await palco.camera([cabeca("Nome do Insumo"), selo, linha(p, "Hambúrguer 150 g").locator("td").first()], { zoomMax: 1.5, margem: 40 });
        await ctx.ate(0.2);
        await palco.mover(cabeca("Saldo Atual"), { ms: 500 });
        await ctx.ate(0.33);
        await palco.mover(cabeca("Estoque Mínimo"), { ms: 450 });
        await ctx.ate(0.43);
        await palco.mover(cabeca("Custo Unit."), { ms: 400 });
        await ctx.ate(0.52);
        await palco.mover(cabeca("Valor em Estoque"), { ms: 400 });
        await ctx.ate(0.66);
        await palco.destacar(selo, { folga: 6 });
        await palco.mover(selo, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Cadastrar um insumo",
      fala: "Para cadastrar um ingrediente novo, clique no botão Novo insumo, aqui em cima.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const novo = p.getByRole("button", { name: "Novo insumo" });
        await palco.destacar(novo, { folga: 6 });
        await palco.mover(novo, { ms: 700 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.clicar(novo, { ms: 200 });
        await janela(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Escreva o nome, o estoque inicial e a unidade. No estoque mínimo, coloque a quantidade em que a tela deve avisar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = janela(p);
        await palco.camera(j, { zoomMax: 1.5, margem: 50, ms: 500 });
        await palco.digitar(j.getByPlaceholder(/Queijo Muçarela/), "Cheddar fatiado");
        await palco.digitar(j.getByPlaceholder("Ex: 1000"), "3");
        const unidade = j.locator("select");
        await palco.apontar(unidade);
        await unidade.selectOption("kg");
        await ctx.ate(0.55);
        const minimo = j.getByPlaceholder("Ex: 200");
        await palco.destacar(minimo.locator("xpath=.."), { folga: 4 });
        await palco.digitar(minimo, "1");
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Cadastrar Insumo, e ele já aparece na lista.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(janela(p).getByRole("button", { name: "Cadastrar Insumo" }), { ms: 500 });
        await palco.cameraAberta({ ms: 400 });
        const novo = linha(p, "Cheddar fatiado");
        await novo.waitFor({ state: "visible", timeout: 15_000 });
        await rolarPara(palco, p.locator(".kpi-grid").first(), 50);
        await palco.destacar(novo, { folga: 2 });
        await palco.mover(novo.locator("td").first(), { ms: 500 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Repor o estoque",
      fala: "Quando chegar mercadoria, vá na linha do insumo e clique em Movimentar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = linha(p, "Bacon em fatias").getByRole("button", { name: "Movimentar" });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 800 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(botao, { ms: 200 });
        await janela(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Deixe marcado Entrada, digite a quantidade que chegou e, se quiser, uma observação.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = janela(p);
        await palco.camera(j, { zoomMax: 1.5, margem: 50, ms: 500 });
        await palco.mover(j.locator(".radio-label").first(), { ms: 500 });
        await ctx.ate(0.25);
        await palco.digitar(j.getByPlaceholder("Ex: 500"), "5");
        await ctx.ate(0.6);
        await palco.digitar(j.getByPlaceholder(/Compra quinzenal/), "Compra da semana");
        await ctx.ate(1);
      },
    },
    {
      fala: "Depois clique em Confirmar Lançamento, o botão escuro no fim da janela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = janela(p);
        await ctx.ate(0.3);
        await palco.clicar(j.getByRole("button", { name: "Confirmar Lançamento" }), { ms: 500 });
        await palco.cameraAberta({ ms: 400 });
        await j.waitFor({ state: "hidden", timeout: 15_000 });
        await linha(p, "Bacon em fatias").waitFor({ state: "visible", timeout: 15_000 });
        // a tela recarrega a lista e volta ao alto: desce de novo até os insumos
        await rolarPara(palco, p.locator(".kpi-grid").first(), 50);
        await ctx.ate(1);
      },
    },
    {
      fala: "O saldo do bacon subiu, e o aviso de estoque baixo saiu da linha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bacon = linha(p, "Bacon em fatias");
        await palco.camera(await recorte(bacon.locator("td").first(), bacon.locator(".status-label")), { zoomMax: 1.5, margem: 60, ms: 500 });
        await palco.destacar(bacon.locator(".qty-col"), { folga: 6 });
        await palco.mover(bacon.locator(".qty-col"), { ms: 500 });
        await ctx.ate(0.55);
        await palco.destacar(bacon.locator(".status-label"), { folga: 6 });
        await palco.mover(bacon.locator(".status-label"), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Saída e perda",
      fala: "No mesmo botão você também lança uma Saída, ou uma Perda quando o produto estraga ou vence.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(linha(p, "Bacon em fatias").getByRole("button", { name: "Movimentar" }), { ms: 500 });
        const j = janela(p);
        await j.waitFor({ state: "visible", timeout: 8000 });
        const tipos = j.locator(".radio-group-types");
        await palco.camera(j, { zoomMax: 1.5, margem: 50, ms: 500 });
        await ctx.ate(0.4);
        await palco.clicar(tipos.locator(".radio-label").nth(1), { ms: 350 });
        await ctx.ate(0.62);
        await palco.clicar(tipos.locator(".radio-label").nth(2), { ms: 350 });
        await ctx.ate(1);
        await dormir(400);
        await palco.clicar(j.locator(".btn-close"), { ms: 400 });
        await j.waitFor({ state: "hidden", timeout: 8000 });
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Ficha técnica",
      fala: "Na aba Fichas Técnicas, você diz quanto de cada insumo vai em cada produto do cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(aba(p, "Fichas Técnicas"), { ms: 600 });
        const coca = ficha(p, "Coca-Cola lata");
        await coca.waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.45);
        await palco.camera(await recorte(ficha(p, "Batata Frita"), ficha(p, "Guaraná 2 L")), { zoomMax: 1.3, margem: 40, ms: 500 });
        await palco.destacar(coca, { folga: 4 });
        await palco.mover(coca.locator(".ingredients-list li").first(), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      fala: "Clique em Ficha Técnica no produto, escolha o insumo e digite a quantidade usada em cada unidade vendida.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(ficha(p, "Batata Frita").getByRole("button", { name: /Ficha Técnica/ }), { ms: 500 });
        const j = janela(p);
        await j.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(j, { zoomMax: 1.4, margem: 50, ms: 500 });
        const insumo = j.locator("select").first();
        await ctx.ate(0.4);
        await palco.apontar(insumo);
        await insumo.selectOption({ label: "Batata congelada (kg)" });
        await ctx.ate(0.62);
        await palco.digitar(j.getByPlaceholder("Ex: 50"), "0.4");
        await ctx.ate(1);
      },
    },
    {
      fala: "Agora clique em Salvar Ficha Técnica para gravar a ficha do produto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = janela(p);
        await ctx.ate(0.2);
        await palco.clicar(j.getByRole("button", { name: "Salvar Ficha Técnica" }), { ms: 500 });
        await palco.cameraAberta({ ms: 400 });
        await j.waitFor({ state: "hidden", timeout: 15_000 });
        const batata = ficha(p, "Batata Frita");
        await batata.locator(".ingredients-list li").first().waitFor({ state: "visible", timeout: 15_000 });
        await rolarPara(palco, p.locator(".kpi-grid").first(), 50);
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Baixa automática na venda",
      fala: "Com a ficha salva, cada pedido aceito e cada venda do balcão dão baixa nos insumos sozinhos. Se o pedido for cancelado, o insumo volta para o saldo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const batata = ficha(p, "Batata Frita");
        await palco.camera(batata, { zoomMax: 1.7, margem: 70 });
        await palco.destacar(batata, { folga: 4 });
        await palco.mover(batata.locator(".ingredients-list li").first(), { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Histórico",
      fala: "A aba Histórico mostra as últimas movimentações com data e hora: as entradas, as perdas e a baixa de cada venda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(aba(p, "Histórico"), { ms: 600 });
        const linhas = p.locator(".items-table tbody tr");
        await linhas.first().waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(await recorte(p.locator(".items-table th").first(), linhas.nth(3).locator(".notes-col")), { zoomMax: 1.3, margem: 30, ms: 500 });
        await ctx.ate(0.5);
        await palco.mover(linhas.nth(0).locator(".badge"), { ms: 500 });
        await ctx.ate(0.8);
        await palco.mover(linhas.nth(2).locator(".badge"), { ms: 500 });
        await ctx.ate(1);
        await dormir(500);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você sabe o que tem e quando repor. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
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
