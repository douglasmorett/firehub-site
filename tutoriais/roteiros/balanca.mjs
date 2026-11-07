// Tutorial da Balança (/store/balanca, módulo de 05/11/2026).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// O que foi conferido no código antes de escrever (06/11/2026, feat/modulo-balanca):
// - menu: item "Balança" com o selo NOVO (lib/menu-do-painel.ts);
// - R$ 197/mês à parte da mensalidade, 7 dias grátis na primeira ativação, termo
//   com "Li e concordo" + "Concordo e ativar" (lib/balanca/*, BalancaClient.tsx);
// - o produto marcado "por quilo" usa o preço do cardápio como preço do kg e sai
//   do delivery, do totem, do balcão e do garçom (api/store/balanca PUT);
// - cartões em Mesas › ⚙️ › 🎫 Comandas, faixa "Criar do nº … ao …", "Imprimir
//   cartões" abre /store/mesas/cartoes (ComandasConfig.tsx);
// - a tela da balança espera o peso firmar, pede o cartão e lança; com
//   ?simular=1 é uma balança de mentira e NADA é lançado (TelaDaBalanca.tsx);
// - no caixa, Mesas › 🎫 Comandas: o número do cartão abre a conta, com a linha
//   "Refeição por kg" e o peso (MesasApp.tsx, conta-da-mesa.ts).
//
// Uma coisa fora da imagem: o modo de teste não lança. Para o caixa mostrar a
// comanda com o prato, a pesagem de 0,452 kg entra pela MESMA rota da tela da
// balança (/api/store/balanca/pesar), logada como a loja — é o que a balança de
// verdade faria.
import { dormir } from "../motor/palco.mjs";
import { assentar } from "./_cardapio-comum.mjs";

const PRODUTO = "Refeição por kg";
const menu = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/balanca"]');

/** O aviso do Assistente de impressão desta máquina e os balões flutuantes (ver multimarcas.mjs). */
function esconderOQueTampa() {
  const sumir = (el) => el.style.setProperty("display", "none", "important");
  const varrer = () => {
    for (const el of document.querySelectorAll('[role="status"]')) {
      if ((el.textContent || "").includes("Assistente de Impressão") || (el.textContent || "").includes("Assistente está vinculado")) sumir(el);
    }
    for (const el of document.querySelectorAll("#floating-contact-widget, .bill-botao")) sumir(el);
    for (const el of document.querySelectorAll('[style*="position:fixed"], [style*="position: fixed"]')) {
      const z = Number(el.style.zIndex);
      if (z >= 10000 && z <= 10002) sumir(el);
    }
  };
  setInterval(varrer, 120);
}

export default {
  id: "balanca",
  titulo: "Balança: self-service por quilo na comanda",
  rota: "store/balanca",
  prontaQuando: "text=Como funciona no salão",
  pronuncia: {
    "R$ 197": "cento e noventa e sete reais",
    "R$ 59,90": "cinquenta e nove e noventa",
    "0,452 kg": "quatrocentos e cinquenta e dois gramas",
    "101 ao 150": "cento e um ao cento e cinquenta",
    "101": "cento e um",
  },

  /**
   * - a loja PAGA a mensalidade (isenta veria "LIBERADO", sem termo e sem preço);
   * - o produto do self-service, R$ 59,90 o quilo, numa categoria própria.
   */
  async preparar(prisma, { loja }) {
    await prisma.user.update({ where: { id: loja.id }, data: { planPercent: 2, isFranqueadoHakim: false } });
    await prisma.menuCategory.create({ data: { franchiseeId: loja.id, name: "Self-service", emoji: "🍽️", sortOrder: 4 } });
    await prisma.menuProduct.create({
      data: { franchiseeId: loja.id, name: PRODUTO, description: "Buffet livre, preço do quilo", price: 59.9, category: "Self-service", sortOrder: 20 },
    });
  },

  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.context().addInitScript(esconderOQueTampa);
    await p.evaluate(esconderOQueTampa);
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await assentar(palco);
  },

  cenas: [
    // ── 1. O que é ───────────────────────────────────────────────────────────
    {
      capitulo: "O que é",
      fala: "O módulo Balança é para o restaurante self-service por quilo. Ele fica aqui no menu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(400);
        await palco.mover(p.getByRole("heading", { name: /Balança/ }), { ms: 700 });
        await ctx.ate(0.6);
        await palco.destacar(menu(p), { folga: 4 });
        await palco.mover(menu(p), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Na entrada, o cliente pega um cartão numerado. Põe o prato na balança, passa o cartão, e o valor cai na comanda dele. No caixa, a conta abre com tudo o que ele consumiu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const passos = p.getByRole("heading", { name: "Como funciona no salão" }).locator("xpath=..");
        await palco.rolarAte(passos, { bloco: "center" });
        await palco.destacar(passos, { folga: 6 });
        for (const [i, t] of ["Na entrada", "Na balança", "Passa o cartão", "No caixa"].entries()) {
          await ctx.ate(0.08 + i * 0.23);
          await palco.mover(passos.getByText(t, { exact: true }), { ms: 600 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },

    // ── 2. Quanto custa ──────────────────────────────────────────────────────
    {
      capitulo: "Quanto custa",
      fala: "Custa R$ 197 por mês, à parte. A mensalidade do FireHub continua a mesma, e o equipamento a loja compra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const preco = p.getByText(/^R\$\s?197/).first();
        await palco.destacar(preco.locator("xpath=../.."), { folga: 6 });
        await palco.mover(preco, { ms: 700 });
        await ctx.ate(0.4);
        await palco.mover(p.getByText("À parte da mensalidade."), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },

    // ── 3. Ativar ────────────────────────────────────────────────────────────
    {
      capitulo: "Ativar",
      fala: "Para começar, clique em Testar 7 dias grátis. Marque que concorda com o termo e clique em Concordo e ativar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: /Testar 7 dias grátis/ }), { ms: 600 });
        const termo = p.getByRole("dialog");
        await termo.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.5);
        await palco.rolarAte(termo.getByRole("checkbox"), { bloco: "center" });
        await palco.clicar(termo.getByRole("checkbox"), { ms: 600 });
        await ctx.ate(0.8);
        await palco.rolarAte(termo.getByRole("button", { name: "Concordo e ativar" }), { bloco: "center" });
        await palco.clicar(termo.getByRole("button", { name: "Concordo e ativar" }), { ms: 500 });
        await p.getByText("Balança ligada!").waitFor({ state: "visible", timeout: 30_000 });
      },
    },

    // ── 4. Produto por quilo ─────────────────────────────────────────────────
    {
      capitulo: "Produto por quilo",
      fala: "Agora marque o produto do self-service. O preço dele no cardápio é o preço do quilo: aqui, R$ 59,90.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const linha = p.locator("label").filter({ hasText: PRODUTO });
        await palco.rolarAte(p.getByRole("heading", { name: "Produtos vendidos por quilo" }), { bloco: "start" });
        await palco.digitar(p.getByLabel("Buscar no cardápio"), "Refeição");
        await linha.waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.25);
        await palco.clicar(linha.getByRole("checkbox"), { ms: 600 });
        await ctx.ate(0.6);
        await palco.destacar(linha, { folga: 4 });
        await palco.mover(linha.getByText(/\/kg/), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Salvar produtos por quilo. Ele sai do delivery e do balcão: agora só se vende pesando.",
      acao: async (palco) => {
        const p = palco.pagina;
        const salvar = p.getByRole("button", { name: "Salvar produtos por quilo" });
        await palco.rolarAte(salvar, { bloco: "center" });
        await palco.clicar(salvar, { ms: 600 });
        await p.getByText("Produtos por quilo salvos.").waitFor({ state: "visible", timeout: 20_000 });
      },
    },

    // ── 5. Cartões de comanda ────────────────────────────────────────────────
    {
      capitulo: "Cartões de comanda",
      fala: "Os cartões ficam em Mesas. Clique na engrenagem e abra a aba Comandas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/mesas`, { waitUntil: "load", timeout: 60_000 });
        const engrenagem = p.getByRole("button", { name: "⚙️", exact: true });
        await engrenagem.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(400);
        await palco.clicar(engrenagem, { ms: 600 });
        await p.getByRole("heading", { name: "⚙️ Gerenciar Mesas" }).waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.65);
        await palco.clicar(p.getByRole("button", { name: /^🎫 Comandas/ }), { ms: 600 });
        await p.getByText("Nenhum cartão cadastrado").waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      fala: "Escolha a faixa, por exemplo do 101 ao 150, e clique em Criar cartões.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const de = p.getByLabel("Primeiro número");
        const ate = p.getByLabel("Último número");
        await de.fill("");
        await palco.digitar(de, "101");
        await ate.fill("");
        await palco.digitar(ate, "150");
        await ctx.ate(0.7);
        await palco.clicar(p.getByRole("button", { name: "Criar cartões" }), { ms: 600 });
        await p.getByText(/50 cartões cadastrados/).waitFor({ state: "visible", timeout: 20_000 });
      },
    },
    {
      fala: "Em Imprimir cartões, sai cada um com o número grande e o código de barras, que o leitor lê.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const imprimir = p.getByRole("link", { name: /Imprimir cartões/ });
        await palco.destacar(imprimir, { folga: 6 });
        await palco.mover(imprimir, { ms: 600 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await p.goto(`${ctx.BASE}/store/mesas/cartoes?de=101&ate=150`, { waitUntil: "load", timeout: 60_000 });
        await p.getByText("101", { exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
        await dormir(300);
        await palco.mover(p.getByText("101", { exact: true }).first(), { ms: 700 });
      },
      pausa: 500,
    },

    // ── 6. A tela da balança ─────────────────────────────────────────────────
    {
      capitulo: "A tela da balança",
      fala: "A tela da balança abre no computador ou no tablet ligado à balança. Aqui, no modo de teste, com uma balança de mentira.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/balanca`, { waitUntil: "load", timeout: 60_000 });
        const testar = p.getByRole("link", { name: "Testar sem balança" });
        await testar.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
        await palco.destacar(p.getByRole("link", { name: "Abrir tela da balança" }), { folga: 6 });
        await palco.mover(p.getByRole("link", { name: "Abrir tela da balança" }), { ms: 600 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.clicar(testar, { ms: 600 });
        await p.getByText("SIMULAÇÃO — NÃO LANÇA").waitFor({ state: "visible", timeout: 30_000 });
      },
    },
    {
      fala: "O cliente põe o prato. A tela espera o peso firmar e mostra o valor.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Pôr prato de 0,452 kg" }), { ms: 600 });
        await p.getByText("Passe o cartão da comanda").waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(0.75);
        await palco.mover(p.getByText(/R\$\s?27,07/), { ms: 600 });
      },
    },
    {
      fala: "Embaixo do peso vem escrito Não verificado: quem vale é o visor da balança, como pede o Inmetro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.getByText(/Não verificado/);
        await palco.destacar(aviso, { folga: 8 });
        await palco.mover(aviso, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Ele passa o cartão no leitor, que digita o número sozinho, e pronto. No teste, nada é lançado; com a balança de verdade, o prato vai para a comanda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const campo = p.getByLabel("Número do cartão da comanda");
        await palco.digitar(campo, "101");
        await p.keyboard.press("Enter");
        await p.getByText(/na comanda 101/).waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(0.55);
        await palco.mover(p.getByText(/SIMULAÇÃO — nada foi lançado/), { ms: 600 });
      },
    },

    // ── 7. No caixa ──────────────────────────────────────────────────────────
    {
      capitulo: "No caixa",
      fala: "No caixa, abra Mesas, Comandas, e passe o cartão 101.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // A pesagem de verdade, pela rota da tela da balança (ver o cabeçalho).
        const produto = await ctx.prisma.menuProduct.findFirst({ where: { name: PRODUTO }, select: { id: true } });
        const status = await p.evaluate(async (produtoId) => {
          const r = await fetch("/api/store/balanca/pesar", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comanda: "101", produtoId, pesoKg: 0.452 }),
          });
          return r.status;
        }, produto.id);
        if (status !== 200) throw new Error(`A pesagem não entrou na comanda (${status}).`);
        await p.goto(`${ctx.BASE}/store/mesas`, { waitUntil: "load", timeout: 60_000 });
        const chip = p.getByRole("button", { name: /^🎫 Comandas/ });
        const campo = p.getByLabel("Número da comanda");
        await Promise.race([chip.waitFor({ state: "visible", timeout: 30_000 }), campo.waitFor({ state: "visible", timeout: 30_000 })]);
        await dormir(400);
        if (await chip.isVisible().catch(() => false)) await palco.clicar(chip, { ms: 600 });
        await campo.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.6);
        await palco.digitar(campo, "101");
        await p.keyboard.press("Enter");
        await p.getByText(PRODUTO).first().waitFor({ state: "visible", timeout: 20_000 });
      },
    },
    {
      fala: "A conta abre com o prato e o peso. Você lança a bebida no mesmo cartão e fecha como uma mesa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const item = p.getByText(PRODUTO).first();
        await palco.destacar(item.locator("xpath=../.."), { folga: 6 });
        await palco.mover(item, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
      pausa: 500,
    },

    // ── 8. Para rever ────────────────────────────────────────────────────────
    {
      capitulo: "Para rever este vídeo",
      fala: "O que comprar e como configurar a balança está na tela Balança. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/balanca`, { waitUntil: "load", timeout: 60_000 });
        const comprar = p.getByRole("heading", { name: "O que a loja compra" });
        await comprar.waitFor({ state: "attached", timeout: 30_000 });
        await palco.rolarAte(comprar, { bloco: "start" });
        await palco.mover(comprar, { ms: 600 });
        await ctx.ate(0.5);
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 800 });
        }
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
