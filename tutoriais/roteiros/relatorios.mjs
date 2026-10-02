// Tutorial da tela de Relatórios (/store/relatorios) — o menu e o que cada relatório responde.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever cada frase:
// - o menu (components/relatorios/MenuDeRelatorios.tsx + lib/relatorios/
//   catalogo-de-relatorios.ts): seções, busca por palavra e estrela de
//   favoritos, guardados no navegador; a frase de cada relatório segue a
//   descrição que o próprio cartão traz;
// - Vendas por período (relatorios/vendas): atalhos de período e as duas datas,
//   filtros de horário, tipo de venda e canal, quadros comparados com o período
//   anterior, lista de pedidos em que a linha abre os itens, botões Imprimir e
//   Exportar Excel;
// - Itens vendidos (relatorios/itens-vendidos): árvore categoria → produto com
//   quantidade e valor;
// - Vendas por dia e hora (relatorios/data-hora): quadros "Melhor horário" e
//   "Melhor dia" e o mapa de calor (linha = dia da semana, coluna = hora, cor
//   mais escura = mais venda);
// - os cartões de Mesas e garçons, Acerto de entregadores, Histórico de
//   caixas, DRE e Notas fiscais apontam para outras telas do painel.
//
// ── O que a fala NÃO diz, de propósito ──────────────────────────────────────
// As réguas finas de cada relatório (a mesa conta uma vez, o anterior cortado
// no mesmo horário, a média por dia da semana) ficam fora: o vídeo é um guia do
// que cada relatório responde, não a regra de cada número.
import { dormir } from "../motor/palco.mjs";
import { cadastrarCustos, criarHistorico } from "./_historico-comum.mjs";

/** O cartão de um relatório no menu, pelo título (o link pega título + descrição). */
const cartao = (p, titulo) => p.getByRole("link", { name: new RegExp(`^${titulo}`) }).first();
/** A grade de cartões da seção em que este relatório está. */
const grade = (p, titulo) => cartao(p, titulo).locator("xpath=../..");
/** O "← Relatórios" do alto de cada relatório (a barra lateral tem outro link igual). */
const voltar = (p) => p.locator('a.fh-sem-impressao[href="/store/relatorios"]');
const atalho = (p, nome) => p.getByRole("button", { name: nome, exact: true });
/** Um quadro de número do alto do relatório, pelo rótulo. */
const quadro = (p, rotulo) => p.getByText(rotulo, { exact: true }).first().locator("xpath=..");

/** Rola a PÁGINA até `y` e espera a rolagem PARAR (rolagem longa passa dos 750 ms do palco). */
async function rolarPagina(palco, y) {
  await palco.rolarPagina(y);
  let antes = -1;
  for (let i = 0; i < 25; i++) {
    const agora = await palco.pagina.evaluate(() => window.scrollY);
    if (agora === antes) break;
    antes = agora;
    await dormir(110);
  }
}

/** Rola a PÁGINA até o alvo ficar a `topo` pixels do alto da tela. */
async function rolarPaginaPara(palco, alvo, topo = 120) {
  const c = await alvo.boundingBox();
  const y = await palco.pagina.evaluate(() => window.scrollY);
  await rolarPagina(palco, Math.max(0, Math.round(y + c.y - topo)));
}

/** Volta ao menu pelo "← Relatórios" do alto do relatório e espera os cartões. */
async function voltarAoMenu(palco) {
  const p = palco.pagina;
  await palco.cameraAberta({ ms: 350 });
  await rolarPagina(palco, 0);
  await palco.clicar(voltar(p), { ms: 600 });
  await cartao(p, "Painel de vendas").waitFor({ state: "visible", timeout: 20_000 });
  await dormir(250);
}

export default {
  id: "relatorios",
  titulo: "Relatórios: o que cada um responde",
  rota: "store/relatorios",
  prontaQuando: 'a:has-text("Painel de vendas")',
  pronuncia: { DRE: "dê erre é" },

  /** Dois meses de venda (e o custo dos produtos, para o Painel não abrir com aviso). */
  async preparar(prisma, base) {
    await cadastrarCustos(prisma, base);
    await criarHistorico(prisma, base);
  },

  async antesDeGravar(palco) {
    const p = palco.pagina;
    // O botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo na captura: só o pulso para.
    // (O estilo é reaplicado a cada tela aberta: a troca de relatório é navegação dentro da mesma página.)
    await p.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    // O menu adianta (prefetch) os dezesseis relatórios; no banco de brinquedo isso ocupa o servidor por segundos.
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await p.evaluate(() => window.scrollTo({ top: 0 }));
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Relatórios. Cada cartão é um relatório, e cada relatório responde uma pergunta sobre a loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await palco.mover(p.getByRole("heading", { name: "Relatórios", exact: true }), { ms: 900 });
        await ctx.ate(0.3);
        await palco.destacar(grade(p, "Painel de vendas"), { folga: 8 });
        await palco.mover(cartao(p, "Painel de vendas"), { ms: 700 });
        await ctx.ate(0.7);
        await palco.mover(cartao(p, "Vendas por área de entrega"), { ms: 900 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Vendas por período",
      fala: "Vendas por período responde quanto a loja vendeu, e traz a lista dos pedidos, um por um.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, "Vendas por período");
        await palco.destacar(c, { folga: 4 });
        await palco.mover(c, { ms: 700 });
        await ctx.ate(0.8);
        await palco.apagarDestaque();
        await palco.clicar(c);
        await p.getByText("Valor vendido", { exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Período e filtros",
      fala: "Primeiro escolha o período: use um atalho, como 30 dias, ou marque as duas datas. Logo abaixo ficam os filtros de horário, tipo de venda e canal.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const filtros = p.locator("section.fh-sem-impressao").first();
        const periodo = atalho(p, "Hoje").locator("xpath=..");
        await rolarPaginaPara(palco, filtros, 110);
        await palco.camera(filtros, { zoomMax: 1.3, margem: 26, ms: 600 });
        await palco.destacar(periodo, { folga: 6 });
        await palco.mover(atalho(p, "7 dias"), { ms: 500 });
        await ctx.ate(0.26);
        await palco.apagarDestaque();
        await palco.clicar(atalho(p, "30 dias"));
        await ctx.ate(0.5);
        await palco.mover(p.locator('input[name="de"]'), { ms: 500 });
        await ctx.ate(0.64);
        const tipo = (nome) => filtros.locator("label").filter({ hasText: nome });
        const canais = filtros.getByText(/^Todos os canais/).first();
        await palco.destacar([p.locator('input[name="horaDe"]'), tipo("Totem"), canais], { folga: 10 });
        await palco.mover(p.locator('input[name="horaDe"]'), { ms: 500 });
        await ctx.ate(0.82);
        await palco.mover(tipo("Retirada"), { ms: 450 });
        await ctx.ate(0.93);
        await palco.mover(canais, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No alto do relatório ficam os botões Imprimir e Exportar Excel.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const imprimir = p.getByRole("button", { name: "Imprimir" });
        const excel = p.getByRole("link", { name: "Exportar Excel" });
        await palco.cameraAberta({ ms: 400 });
        await rolarPagina(palco, 0);
        await palco.destacar([imprimir, excel], { folga: 6 });
        await palco.mover(imprimir, { ms: 600 });
        await ctx.ate(0.75);
        await palco.mover(excel, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Os quadros mostram as vendas, o valor vendido e o ticket médio, cada um comparado com o período anterior.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quadros = ["Vendas", "Valor vendido", "Ticket médio"].map((r) => quadro(p, r));
        await rolarPaginaPara(palco, quadros[1], 150);
        await palco.camera(quadros, { zoomMax: 1.55, margem: 40, ms: 600 });
        const quando = [0.14, 0.3, 0.46];
        for (const [i, q] of quadros.entries()) {
          await ctx.ate(quando[i]);
          await Promise.all([palco.destacar(q, { folga: 4 }), palco.mover(q, { ms: 420 })]);
        }
        await ctx.ate(0.66);
        await palco.destacar(quadros, { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "Mais abaixo vem a lista dos pedidos. Clique numa linha para ver os itens daquele pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const linha = p.locator("tr.fh-vendas-linha").filter({ hasText: "Carlos Mendes" }).first();
        await rolarPaginaPara(palco, p.getByRole("heading", { name: "Pedidos", exact: true }), 90);
        await palco.mover(linha.locator("td").nth(2), { ms: 700 });
        await ctx.ate(0.48);
        await palco.clicar(linha.locator("td").nth(2));
        const itens = p.getByText("Itens", { exact: true }).last().locator("xpath=../..");
        await itens.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar([linha, itens], { folga: 4 });
        await palco.mover(itens, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Itens vendidos",
      fala: "Voltando ao menu: o relatório Itens vendidos responde quantas unidades de cada produto saíram no período.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await voltarAoMenu(palco);
        const c = cartao(p, "Itens vendidos");
        await palco.destacar(c, { folga: 4 });
        await palco.mover(c, { ms: 600 });
        await ctx.ate(0.88);
        await palco.apagarDestaque();
        await palco.clicar(c);
        await p.locator("tr[aria-expanded]").filter({ hasText: "Lanches" }).waitFor({ state: "visible", timeout: 20_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Os produtos vêm agrupados por categoria. Clique numa categoria, ou em Abrir tudo, para ver os produtos, com a quantidade e o valor de cada um.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lanches = p.locator("tr[aria-expanded]").filter({ hasText: "Lanches" });
        const arvore = p.getByText("Itens e opções", { exact: true }).locator("xpath=../..");
        const abrirTudo = p.getByRole("button", { name: "Abrir tudo" });
        await rolarPaginaPara(palco, abrirTudo, 300);
        await palco.destacar(lanches, { folga: 2 });
        await palco.mover(lanches.locator("td").first(), { ms: 600 });
        await ctx.ate(0.36);
        await palco.apagarDestaque();
        await palco.clicar(abrirTudo);
        const filhos = ["X-Bacon", "X-Burger", "X-Tudo"].map((n) => p.locator("tr").filter({ hasText: n }).first());
        await filhos[0].waitFor({ state: "visible", timeout: 8000 });
        // Com tudo aberto a página cresce e a tabela sobe. A câmera fica na parte de cima dela: a última
        // linha cai embaixo da bolinha "WhatsApp da loja", que nesta altura de tela tampa o valor.
        await rolarPaginaPara(palco, abrirTudo, 70);
        await palco.camera([arvore.locator("strong").first(), p.locator("tr").filter({ hasText: "Guaraná 2 L" }).first()], { zoomMax: 1.3, margem: 4, ms: 500 });
        await ctx.ate(0.66);
        await palco.destacar(filhos, { folga: 2 });
        await palco.mover(filhos[0].locator("td").nth(1), { ms: 600 });
        await ctx.ate(0.86);
        await palco.mover(filhos[0].locator("td").nth(2), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Vendas por dia e hora",
      fala: "De volta ao menu, Vendas por dia e hora mostra o melhor dia e o melhor horário da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await voltarAoMenu(palco);
        const c = cartao(p, "Vendas por dia e hora");
        await palco.destacar(c, { folga: 4 });
        await palco.mover(c, { ms: 600 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(c);
        await p.getByRole("heading", { name: /^Mapa de calor/ }).waitFor({ state: "visible", timeout: 20_000 });
        const melhores = [quadro(p, "Melhor horário"), quadro(p, "Melhor dia")];
        await rolarPaginaPara(palco, melhores[0], 250);
        await palco.destacar(melhores, { folga: 4 });
        await palco.mover(melhores[1], { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No mapa de calor, cada quadrinho é uma hora de um dia da semana. Quanto mais escuro, mais a loja vendeu ali.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const mapa = p.getByRole("heading", { name: /^Mapa de calor/ }).locator("xpath=ancestor::section[1]");
        await rolarPaginaPara(palco, mapa, 100);
        await palco.camera(mapa, { zoomMax: 1.25, margem: 24, ms: 600 });
        const sabado = mapa.locator("tr").filter({ hasText: "Sábado" });
        await palco.mover(mapa.locator("tr").filter({ hasText: "Segunda" }).locator("td").nth(2), { ms: 700 });
        await ctx.ate(0.55);
        await palco.destacar(sabado, { folga: 2 });
        await palco.mover(sabado.locator("td").nth(8), { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os outros relatórios de vendas",
      fala: "De volta ao menu, ainda tem mais. O Painel de vendas junta o resumo do período numa tela só, e Faturamento por dia mostra quanto a loja vendeu em cada dia.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await voltarAoMenu(palco);
        await ctx.ate(0.3);
        await palco.destacar(cartao(p, "Painel de vendas"), { folga: 4 });
        await palco.mover(cartao(p, "Painel de vendas"), { ms: 600 });
        await ctx.ate(0.66);
        await Promise.all([palco.destacar(cartao(p, "Faturamento por dia"), { folga: 4 }), palco.mover(cartao(p, "Faturamento por dia"), { ms: 600 })]);
        await ctx.ate(1);
      },
    },
    {
      fala: "Vendas por forma de pagamento separa o que entrou em dinheiro, Pix e cartão. Vendas por área de entrega mostra qual bairro pede mais.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await Promise.all([palco.destacar(cartao(p, "Vendas por forma de pagamento"), { folga: 4 }), palco.mover(cartao(p, "Vendas por forma de pagamento"), { ms: 600 })]);
        await ctx.ate(0.56);
        await Promise.all([palco.destacar(cartao(p, "Vendas por área de entrega"), { folga: 4 }), palco.mover(cartao(p, "Vendas por área de entrega"), { ms: 600 })]);
        await ctx.ate(1);
      },
    },
    {
      fala: "E Cupons e descontos mostra quanto de desconto foi dado e quem pagou, a loja ou a plataforma.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await Promise.all([palco.destacar(cartao(p, "Cupons e descontos"), { folga: 4 }), palco.mover(cartao(p, "Cupons e descontos"), { ms: 600 })]);
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Tempo e estoque",
      fala: "Em Operação, Tempo por status e produção mostra quanto tempo o pedido fica em cada etapa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, "Tempo por status e produção");
        await rolarPaginaPara(palco, c, 200);
        await palco.destacar(c, { folga: 4 });
        await palco.mover(c, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Estoque, Itens consumidos mostra quanto de cada insumo saiu pelas vendas, para a loja que cadastrou a ficha técnica.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, "Itens consumidos");
        await rolarPaginaPara(palco, c, 420);
        await palco.destacar(c, { folga: 4 });
        await palco.mover(c, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Atalhos para outras telas",
      fala: "Os outros cartões são atalhos para outras telas do painel: as mesas e os garçons, o acerto dos entregadores e o histórico de caixas, além do DRE e das notas fiscais.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nomes = ["Mesas e garçons", "Acerto de entregadores", "Histórico de caixas", "DRE e resultado", "Notas fiscais"];
        await rolarPaginaPara(palco, cartao(p, "Mesas e garçons"), 120);
        const quando = [0.36, 0.5, 0.66, 0.82, 0.9];
        for (const [i, n] of nomes.entries()) {
          await ctx.ate(quando[i]);
          await Promise.all([palco.destacar(cartao(p, n), { folga: 4 }), palco.mover(cartao(p, n), { ms: 420 })]);
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Busca e favoritos",
      fala: "Para achar um relatório, escreva uma palavra na busca. E a estrela guarda o relatório em Favoritos, no alto da tela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPagina(palco, 0);
        const busca = p.getByLabel("Procurar relatório");
        await palco.digitar(busca, "pix");
        await ctx.ate(0.5);
        await busca.fill("");
        await dormir(250);
        await palco.clicar(p.getByRole("button", { name: "Favoritar Vendas por período" }));
        const favoritos = p.getByRole("heading", { name: "Favoritos" }).locator("xpath=..");
        await favoritos.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(favoritos, { folga: 6 });
        await palco.mover(p.getByRole("heading", { name: "Favoritos" }), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você já sabe qual relatório abrir para cada pergunta. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPagina(palco, 0);
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
