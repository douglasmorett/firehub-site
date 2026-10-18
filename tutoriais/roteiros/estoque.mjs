// Tutorial da tela de Estoque (/store/estoque), refeito em 18/10/2026.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// A história do vídeo é uma só: o bacon vence, a loja lança o desperdício, o
// bacon zera e a PAUSA PELO ESTOQUE (lib/pausa-pelo-estoque*.ts) tira do
// cardápio o X-Bacon e o X-Tudo, que levam bacon na ficha técnica. Chega a
// compra (Compras › Compra sem nota), o saldo volta e os dois voltam sozinhos.
// Depois, a contagem rápida do fim do dia (/store/estoque/contagem).
//
// A nota com foto (aba "Entrada com IA") chama o Gemini, que o ambiente não
// tem: o vídeo só mostra onde fica, sem mostrar a leitura.
import { dormir } from "../motor/palco.mjs";

const linha = (p, nome) => p.locator(".items-table tbody tr").filter({ hasText: nome }).first();
const aba = (p, nome) => p.locator(".tab-link").filter({ hasText: nome });
const pausa = (p) => p.locator('section[aria-label="Pausa automática pelo estoque"]');
const interruptor = (p) => p.getByRole("switch", { name: /Pausar sozinho/ });
const editar = (p) => p.getByRole("dialog").filter({ hasText: "Editar insumo" });
const desperdicio = (p) => p.locator(".modal-card").filter({ hasText: "Lançar desperdício" });
const ficha = (p, produto) => p.locator(".product-recipe-card").filter({ has: p.getByRole("heading", { name: produto, exact: true }) });
const compraSemNota = (p) => p.locator("section").filter({ has: p.getByRole("heading", { name: "Compra sem nota" }) });
const campo = (raiz, rotulo) => raiz.locator("label").filter({ hasText: rotulo }).locator("input, select").first();

/**
 * Esconde o que não é desta tela: os balões flutuantes do canto de baixo
 * (WhatsApp da loja, suporte), que tampam os botões da direita, e o pulso dos
 * enfeites (a captura pintaria quadros à toa). Roda a cada meio segundo porque
 * os balões renascem a cada render; vai também como script de abertura, para
 * valer nas telas de Compras e Contagem.
 */
function esconderFlutuantes() {
  const montar = () => {
    if (window.__semFlutuantes) return;
    window.__semFlutuantes = true;
    const css = document.createElement("style");
    css.textContent = ".fcw-fab-pulse,.kpi-icon-wrapper.pulse,#contact-widget-fab,.fh-menu-app::after{animation:none!important}.fab-escanear,.fcw-fab,#contact-widget-fab{display:none!important}";
    document.head.appendChild(css);
    const varrer = () => {
      for (const el of document.body.querySelectorAll("body *")) {
        if (el.id?.startsWith("tutorial-")) continue;
        const s = getComputedStyle(el);
        if (s.position !== "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left > innerWidth - 420 && r.top > innerHeight - 320) el.style.setProperty("display", "none", "important");
      }
    };
    varrer();
    setInterval(varrer, 500);
  };
  if (document.body) montar();
  else document.addEventListener("DOMContentLoaded", montar);
}

export default {
  id: "estoque",
  titulo: "Estoque: controlar o que tem e repor",
  rota: "store/estoque",
  prontaQuando: "text=Bacon em fatias",
  pronuncia: { CMV: "cê eme vê", "X-Bacon": "xis bacon", "X-Tudo": "xis tudo" },

  /**
   * Sete insumos de uma lanchonete, com local e "contar todo dia" nos quatro
   * que mais pesam. O Bacon (0,8 kg, mínimo 2) é o primeiro da lista e o que o
   * vídeo zera e repõe. Cinco produtos com ficha técnica; X-Bacon e X-Tudo
   * levam bacon. Nenhum insumo zerado no começo: ligar a pausa não pausa nada.
   */
  async preparar(prisma, { loja, produtos, haMin }) {
    const L = loja.id;
    const dias = (d) => haMin(d * 24 * 60);
    const insumo = async (name, unit, quantity, minQuantity, unitCost, local, contagemDiaria = false) =>
      prisma.stockItem.create({ data: { franchiseeId: L, name, unit, quantity, minQuantity, unitCost, local, contagemDiaria } });

    const bacon = await insumo("Bacon em fatias", "kg", 0.8, 2, 42, "Geladeira", true);
    const batata = await insumo("Batata congelada", "kg", 12, 5, 14, "Freezer", true);
    const carne = await insumo("Hambúrguer 150 g", "un", 46, 30, 3.5, "Freezer", true);
    const molho = await insumo("Molho de tomate", "kg", 6, 2, 9, "Estoque seco");
    const queijo = await insumo("Muçarela fatiada", "kg", 1.5, 3, 38, "Geladeira", true);
    const pao = await insumo("Pão de hambúrguer", "un", 80, 40, 0.9, "Estoque seco");
    const lata = await insumo("Refrigerante em lata", "un", 30, 24, 3.2, "Bebidas");

    const fichaDe = (produto, linhas) => prisma.productRecipe.createMany({
      data: linhas.map(([item, quantityConsumed]) => ({ menuProductId: produtos[produto].id, stockItemId: item.id, quantityConsumed })),
    });
    await fichaDe("X-Burger", [[pao, 1], [carne, 1], [queijo, 0.03]]);
    await fichaDe("X-Bacon", [[pao, 1], [carne, 1], [queijo, 0.03], [bacon, 0.04]]);
    await fichaDe("X-Tudo", [[pao, 1], [carne, 1], [queijo, 0.04], [bacon, 0.04]]);
    await fichaDe("Batata Frita", [[batata, 0.4]]);
    await fichaDe("Coca-Cola lata", [[lata, 1]]);

    const mov = (item, type, quantity, notes, createdAt, extra = {}) =>
      prisma.stockTransaction.create({ data: { stockItemId: item.id, franchiseeId: L, type, quantity, notes, createdAt, ...extra } });

    for (const [item, q] of [[bacon, 3], [batata, 12], [carne, 60], [molho, 6], [queijo, 4], [pao, 100], [lata, 36]]) {
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
    const itens = Object.fromEntries([bacon, batata, carne, queijo, pao, lata].map((i) => [i.id, i]));
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
   * - o aviso do Assistente de Impressão (o desta máquina é de outra loja) sai
   *   pelo "Não ver mais" (fica guardado no navegador);
   * - balões flutuantes escondidos (aqui e nas telas que o vídeo abre);
   * - o quadro "Etiqueta com QR" recolhido: é assunto do vídeo de Etiquetas.
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    const naoVerMais = p.getByRole("button", { name: "Não ver mais" });
    if (await naoVerMais.count()) { await naoVerMais.first().click().catch(() => {}); await dormir(600); }
    await p.addInitScript(esconderFlutuantes);
    await p.evaluate(esconderFlutuantes);
    const trilha = p.getByRole("heading", { name: /Etiqueta com QR/ });
    if (await trilha.count()) { await trilha.first().click(); await dormir(500); }
    await p.evaluate(() => window.scrollTo(0, 0));
    await dormir(800);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Estoque: quanto tem de cada insumo da loja, o que as vendas gastaram e quando repor.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(600);
        await palco.mover(p.getByRole("heading", { name: "Controle de estoque" }), { ms: 900 });
        await ctx.ate(0.4);
        await palco.destacar(p.locator("header.fh-cabecalho"), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os números e a lista",
      fala: "Os quadros mostram os insumos com estoque baixo, os negativos e quantos produtos têm ficha técnica.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quadros = p.locator(".kpi-grid").first();
        await palco.rolarAte(quadros, { bloco: "start" });
        await palco.destacar(quadros, { folga: 8 });
        for (const [i, f] of [0.12, 0.42, 0.68].entries()) {
          await ctx.ate(f);
          await palco.mover(quadros.locator(".kpi-card").nth(i + 1).locator(".kpi-value"), { ms: 500 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Na lista, cada insumo tem saldo, mínimo e custo. O bacon chegou no mínimo e ficou com Estoque Baixo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cabeca = (texto) => p.locator(".items-table th").filter({ hasText: texto });
        await palco.rolarAte(p.locator(".items-table thead"), { bloco: "start" });
        await ctx.ate(0.15);
        await palco.mover(cabeca("Saldo Atual"), { ms: 500 });
        await ctx.ate(0.28);
        await palco.mover(cabeca("Estoque Mínimo"), { ms: 450 });
        await ctx.ate(0.4);
        await palco.mover(cabeca("Custo Unit."), { ms: 400 });
        await ctx.ate(0.55);
        const bacon = linha(p, "Bacon em fatias");
        await palco.destacar([bacon.locator("td").first(), bacon.locator(".status-label")], { folga: 6 });
        await palco.mover(bacon.locator(".status-label"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Editar o insumo",
      fala: "Em Editar, você diz onde o insumo fica e se ele entra na contagem de todo dia.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(linha(p, "Bacon em fatias").getByRole("button", { name: "Editar" }), { ms: 600 });
        const j = editar(p);
        await j.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(j, { zoomMax: 1.45, margem: 40, ms: 500 });
        await ctx.ate(0.35);
        await palco.mover(campo(j, "Onde fica"), { ms: 500 });
        await ctx.ate(0.68);
        await palco.destacar(j.locator("label").filter({ hasText: "Contar todo dia" }), { folga: 4 });
        await palco.mover(j.getByText("Contar todo dia", { exact: true }), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Limpeza e gás ficam Fora do CMV. Massa e recheio são um preparo, com a receita do lote e quanto ele rende.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = editar(p);
        await palco.mover(j.getByText("Fora do CMV", { exact: true }), { ms: 500 });
        await ctx.ate(0.3);
        await palco.clicar(j.getByText("É um preparo da cozinha", { exact: true }), { ms: 450 });
        const rende = campo(j, "O lote rende");
        await rende.waitFor({ state: "visible", timeout: 5000 });
        await palco.camera(j, { zoomMax: 1.3, margem: 30, ms: 400 });
        await ctx.ate(0.62);
        await palco.mover(j.getByRole("button", { name: "Componente" }), { ms: 450 });
        await ctx.ate(0.8);
        await palco.mover(rende, { ms: 450 });
        await ctx.ate(0.93);
        await palco.clicar(j.getByRole("button", { name: "Cancelar" }), { ms: 400 });
        await j.waitFor({ state: "hidden", timeout: 5000 });
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Pausa pelo estoque",
      fala: "Este interruptor pausa sozinho o que usa um item quando ele acaba. Ele vem desligado: clique para ligar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.destacar(pausa(p), { folga: 6 });
        await palco.mover(pausa(p).getByText("Pausar sozinho o que usa um item quando ele acabar"), { ms: 800 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(interruptor(p), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Ligado, quando um insumo zera, o que leva ele na ficha técnica sai do cardápio. Repôs, volta sozinho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // O PUT do interruptor pode demorar no banco local: a espera fica aqui, limitada.
        await p.locator('[role="switch"][aria-checked="true"]').waitFor({ timeout: 4000 }).catch(() => {});
        await palco.camera(pausa(p), { zoomMax: 1.5, margem: 30 });
        await palco.mover(pausa(p).getByText(/^Zerou um item/), { ms: 800 });
        await ctx.ate(0.6);
        await palco.mover(pausa(p).getByText(/Repôs, voltam sozinhos/), { ms: 600 });
        await ctx.ate(1);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Desperdício",
      fala: "Digamos que o bacon venceu: na aba Desperdício, clique em Lançar desperdício para tirar ele do estoque.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(p.locator(".tabs-container"), { bloco: "start" });
        await ctx.ate(0.3);
        await palco.clicar(aba(p, "Desperdício"), { ms: 600 });
        const lancar = p.getByRole("button", { name: /Lançar desperdício/ });
        await lancar.waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.7);
        await palco.clicar(lancar, { ms: 600 });
        await desperdicio(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Pode ser um produto do cardápio ou um insumo. Aqui é o insumo: escolha o bacon, a quantidade e o motivo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = desperdicio(p);
        await palco.camera(j, { zoomMax: 1.4, margem: 40, ms: 500 });
        const tipos = j.locator(".radio-label");
        await palco.mover(tipos.nth(0), { ms: 500 });
        await ctx.ate(0.3);
        await palco.clicar(tipos.nth(1), { ms: 450 });
        await ctx.ate(0.5);
        const lista = j.locator("select");
        await palco.apontar(lista, { ms: 450 });
        await lista.selectOption({ label: "Bacon em fatias (kg)" });
        await palco.digitar(j.getByPlaceholder("Ex: 500"), "0,8");
        await ctx.ate(0.88);
        await palco.clicar(j.getByRole("button", { name: "Venceu", exact: true }), { ms: 450 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Clique em Confirmar desperdício. O bacon sai do estoque, e o custo entra no CMV como desperdício.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(desperdicio(p).getByRole("button", { name: "Confirmar desperdício" }), { ms: 500 });
        await palco.cameraAberta({ ms: 400 });
        const aviso = p.getByRole("status").filter({ hasText: "Desperdício lançado" });
        await aviso.waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(aviso, { folga: 6 });
        await palco.mover(aviso, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O produto pausado sozinho",
      fala: "O bacon zerou, e a pausa já agiu: o X-Bacon e o X-Tudo saíram do cardápio por falta de bacon.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const etiquetas = pausa(p).locator("li");
        await etiquetas.first().waitFor({ state: "visible", timeout: 15_000 });
        await palco.camera(pausa(p), { zoomMax: 1.5, margem: 30 });
        await palco.destacar(pausa(p).locator("ul"), { folga: 6 });
        await ctx.ate(0.45);
        await palco.mover(etiquetas.filter({ hasText: "X-Bacon" }), { ms: 600 });
        await ctx.ate(0.62);
        await palco.mover(etiquetas.filter({ hasText: "X-Tudo" }), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      fala: "Atualize a tela e, na aba Fichas Técnicas, os dois aparecem com a etiqueta Pausado pelo estoque.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.locator("header.fh-cabecalho").getByRole("button", { name: "Atualizar" }), { ms: 600 });
        await p.locator(".kpi-grid").first().waitFor({ state: "visible", timeout: 15_000 });
        await dormir(400);
        await palco.rolarAte(p.locator(".tabs-container"), { bloco: "start" });
        await ctx.ate(0.3);
        await palco.clicar(aba(p, "Fichas Técnicas"), { ms: 500 });
        const bacon = ficha(p, "X-Bacon");
        await bacon.waitFor({ state: "visible", timeout: 8000 });
        const tudo = ficha(p, "X-Tudo");
        await palco.rolarAte(tudo, { bloco: "end" });
        await ctx.ate(0.62);
        await palco.destacar(bacon, { folga: 6 });
        await palco.mover(bacon.getByText("Pausado pelo estoque"), { ms: 600 });
        await ctx.ate(0.85);
        await palco.destacar(tudo, { folga: 6 });
        await palco.mover(tudo.getByText("Pausado pelo estoque"), { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Compras",
      fala: "Chegou bacon. Toda compra se lança em Compras, uma vez só: ela vai para o estoque, para o CMV e para as contas a pagar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await ctx.ate(0.15);
        await palco.clicar(p.locator("header.fh-cabecalho").getByRole("link", { name: "Compras" }), { ms: 700 });
        await p.getByText("Últimos 30 dias", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
        await dormir(500);
        const texto = p.getByText(/^Toda compra de insumo/);
        await palco.destacar(texto, { folga: 6 });
        await palco.mover(texto, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Com nota fiscal, use Nota com foto: a inteligência artificial lê a nota.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("link", { name: "Nota com foto" });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 800 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Sem nota, clique em Compra sem nota. Diga o dia em que a mercadoria chegou, o insumo, a quantidade e o valor pago.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Compra sem nota" }), { ms: 600 });
        const s = compraSemNota(p);
        await s.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(s, { zoomMax: 1.35, margem: 30, ms: 500 });
        await ctx.ate(0.32);
        await palco.mover(campo(s, "A mercadoria chegou em"), { ms: 500 });
        await ctx.ate(0.52);
        const insumo = campo(s, "Insumo");
        await palco.apontar(insumo, { ms: 450 });
        await insumo.selectOption({ label: "Bacon em fatias (kg)" });
        await ctx.ate(0.7);
        await palco.digitar(campo(s, "Quantidade"), "3");
        await ctx.ate(0.85);
        await palco.digitar(campo(s, "Valor pago"), "126");
        await ctx.ate(1);
      },
    },
    {
      fala: "Em Pagamento, diga se pagou na hora, a prazo ou sem conta, e clique em Lançar compra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const s = compraSemNota(p);
        const lancar = s.getByRole("button", { name: "Lançar compra" });
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(lancar, { bloco: "end" });
        const formas = s.locator("fieldset");
        await palco.destacar(formas, { folga: 4 });
        await palco.mover(s.getByRole("button", { name: "Pago na hora" }), { ms: 500 });
        await ctx.ate(0.33);
        await palco.mover(s.getByRole("button", { name: "A prazo (boleto)" }), { ms: 400 });
        await ctx.ate(0.5);
        await palco.mover(s.getByRole("button", { name: "Não criar conta" }), { ms: 400 });
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.clicar(lancar, { ms: 500 });
        const ok = p.getByRole("status").filter({ hasText: "Compra lançada" });
        await ok.waitFor({ state: "visible", timeout: 15_000 });
        await palco.rolarPagina(0);
        await palco.destacar(ok, { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "De volta ao Estoque, o bacon tem saldo de novo, e os dois lanches voltaram sozinhos ao cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.locator("a:has(svg.lucide-arrow-left)").first(), { ms: 600 });
        await linha(p, "Bacon em fatias").waitFor({ state: "visible", timeout: 30_000 });
        await dormir(600);
        await palco.destacar(pausa(p), { folga: 6 });
        await palco.mover(interruptor(p), { ms: 700 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        const bacon = linha(p, "Bacon em fatias");
        await palco.rolarAte(bacon, { bloco: "center" });
        await palco.destacar([bacon.locator("td").first(), bacon.locator(".qty-col")], { folga: 6 });
        await palco.mover(bacon.locator(".qty-col"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Contagem",
      fala: "Em Contagem, a contagem do dia é rápida, só com os itens marcados. A completa é a da semana.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.clicar(p.locator("header.fh-cabecalho").getByRole("link", { name: "Contagem" }), { ms: 700 });
        const rapida = p.getByRole("button", { name: /Contagem do dia/ });
        await rapida.waitFor({ state: "visible", timeout: 30_000 });
        await p.getByText(/^É o que sobrou no fim do expediente/).waitFor({ state: "visible", timeout: 15_000 });
        await dormir(700);
        await ctx.ate(0.4);
        await palco.destacar(rapida, { folga: 6 });
        await palco.mover(rapida, { ms: 600 });
        await ctx.ate(0.78);
        const completa = p.getByRole("button", { name: /Contagem completa/ });
        await palco.destacar(completa, { folga: 6 });
        await palco.mover(completa, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Contagem do dia e digite o que contou em cada item. Ele grava sozinho, sem precisar salvar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: /Contagem do dia/ }), { ms: 500 });
        const caixa = (nome) => p.getByRole("textbox", { name: new RegExp(`^${nome}`) });
        await caixa("Batata").waitFor({ state: "visible", timeout: 15_000 });
        for (const [nome, valor] of [["Batata", "11,5"], ["Hambúrguer", "44"], ["Bacon", "3"], ["Muçarela", "1,2"]]) {
          await palco.digitar(caixa(nome), valor);
        }
        await p.keyboard.press("Enter");
        await ctx.ate(1);
      },
    },
    {
      fala: "No fim, clique em Terminei, fechar contagem: a tela mostra a diferença entre o contado e o sistema.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const terminei = p.getByRole("button", { name: /Terminei, fechar contagem/ });
        await palco.rolarAte(terminei, { bloco: "center" });
        await palco.clicar(terminei, { ms: 600 });
        const fechar = p.getByRole("button", { name: "Fechar contagem", exact: true });
        await fechar.waitFor({ state: "visible", timeout: 8000 });
        await palco.clicar(fechar, { ms: 500 });
        const titulo = p.getByRole("heading", { name: "Diferença entre o contado e o sistema" });
        await titulo.waitFor({ state: "visible", timeout: 20_000 });
        await palco.rolarPagina(0);
        const tabela = p.locator("table").first();
        await ctx.ate(0.42);
        await palco.camera([titulo, tabela], { zoomMax: 1.5, margem: 30 });
        await palco.destacar(tabela, { folga: 6 });
        await palco.mover(tabela.locator("tbody tr").first(), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "Com isso, você sabe o que tem na loja, o que falta e quando repor.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.3);
        await palco.mover(p.getByRole("heading", { name: /^Contagem do dia/ }), { ms: 900 });
        await ctx.ate(1);
        await dormir(700);
      },
      pausa: 600,
    },
  ],
};
