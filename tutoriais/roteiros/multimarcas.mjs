// Tutorial do Multimarcas (/store/multimarcas, módulo de 17/10/2026).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// O que foi conferido no código antes de escrever (18/10/2026, master 23dabfd7):
// - menu: grupo "Cardápio & vendas", item "Multimarcas" (lib/menu-do-painel.ts);
//   no Cardápio, a faixa ConviteDoMultimarcas ("Conhecer o Multimarcas");
// - preço R$ 97/mês numa linha própria do boleto, À PARTE da mensalidade de cada
//   loja; 7 dias grátis só na primeira ativação; cortesia para quem tem o
//   Aplicativo da loja no Android e no iPhone (lib/multimarcas/assinatura.ts,
//   termo.ts, OfertaDoMultimarcas.tsx);
// - ativar pede o termo com a caixa "Li e concordo" (MultimarcasClient.tsx);
// - marca = conjunto de categorias do cardápio da MESMA loja; categoria sem marca
//   aparece em todas, "para acompanhar" (EditorDoMultimarcas.tsx, pagina.ts);
// - /marcas/<slug>: tocar na marca abre o cardápio da loja filtrado
//   (/loja/<slug>?marca=), com "Todas as marcas" no topo e a MESMA sacola
//   (fh_cart_<slug>) — um pedido, pelo checkout de sempre (Vitrine.tsx,
//   CustomerStorePage.tsx);
// - o pedido do site grava cada item com "[NOME DA MARCA]" na frente — é o que a
//   comanda, o KDS e o painel mostram (lib/multimarcas/itens.ts,
//   api/customer-order).
//
// Dados: a loja fictícia ganha duas marcas inventadas (Burguer do Bairro e Pizza
// da Esquina) com as categorias da semente; logos gerados para o vídeo e fotos
// geradas por IA (public/multimarcas e as do vídeo do Tráfego pago), copiados de
// C:\Users\Micro\tutoriais-teste\fotos-multimarcas. Nenhum é de loja real.
//
// Duas coisas fora da imagem, que não mudam o que a tela faz:
// - a página pública tem cache de 60 s (ISR) e a build é dividida entre os
//   ambientes de gravação: depois de salvar, as duas páginas da loja são
//   refeitas na hora (cabeçalho x-prerender-revalidate, o mesmo do
//   revalidatePath), para a gravação não pegar a página de outra gravação;
// - o cliente não preenche o checkout na imagem: com a sacola montada na tela, o
//   pedido é enviado pela MESMA rota do checkout (/api/customer-order, retirada
//   e dinheiro), com os itens que estão na sacola, e o painel recebe de verdade.
import fs from "node:fs";
import path from "node:path";
import { dormir } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";
import { assentar } from "./_cardapio-comum.mjs";

const FOTOS = "C:/Users/Micro/tutoriais-teste/fotos-multimarcas";

const menu = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/multimarcas"]');
/** O bloco de uma marca no editor (o mais próximo que tem os botões das categorias). */
const blocoMarca = (p, i) => p.getByLabel("Nome da marca").nth(i).locator("xpath=ancestor::div[.//button[contains(., 'Bebidas')]][1]");
const categoriaDaMarca = (p, i, nome) => blocoMarca(p, i).getByRole("button", { name: new RegExp(nome) });

/**
 * O que não é assunto do vídeo e tampa a tela: o aviso do Assistente de
 * impressão desta máquina (o Assistente real do computador que grava) e os
 * balões flutuantes (Bill, WhatsApp da loja, suporte).
 */
function esconderOQueTampa() {
  // O estilo chega escrito "position:fixed" (vindo do servidor) ou "position: fixed" (desenhado no navegador).
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

/** Envia um arquivo pelo botão de verdade: o clique abre o seletor de arquivos e o arquivo é escolhido. */
async function enviar(palco, botao, arquivo) {
  const [seletor] = await Promise.all([palco.pagina.waitForEvent("filechooser", { timeout: 10_000 }), palco.clicar(botao, { ms: 500 })]);
  await seletor.setFiles(path.join(FOTOS, arquivo));
}

/** Refaz na hora a página pública (cache de 60 s) — ver o cabeçalho do arquivo. */
async function refazerPaginasPublicas(BASE) {
  const manifesto = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".next", "prerender-manifest.json"), "utf8"));
  for (const rota of [`/marcas/${LOJA.slug}`, `/loja/${LOJA.slug}`]) {
    await fetch(`${BASE}${rota}`, { headers: { "x-prerender-revalidate": manifesto.preview.previewModeId }, redirect: "manual" }).catch(() => {});
  }
}

/**
 * O pedido da sacola que está na tela, pela rota do checkout (ver o cabeçalho):
 * os mesmos itens, retirada e dinheiro.
 */
async function fecharPedidoDaSacola(ctx, p) {
  const r = await p.evaluate((slug) => {
    const sacola = JSON.parse(localStorage.getItem(`fh_cart_${slug}`) || "{}");
    return { itens: (sacola.items || []).map((i) => ({ menuProductId: i.productId || i.id, quantity: i.quantity })) };
  }, LOJA.slug);
  const lojaId = (await ctx.prisma.user.findUnique({ where: { email: LOJA.email }, select: { id: true } })).id;
  const status = await p.evaluate(async ({ slug, lojaId, itens }) => {
    const res = await fetch("/api/customer-order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        franchiseeId: lojaId, franchiseeSlug: slug, customerName: "Juliana Rocha", customerPhone: "11977770009",
        customerAddress: null, deliveryType: "RETIRADA", paymentMethod: "DINHEIRO", notes: "", deliveryFee: 0,
        items: itens.map((i) => ({ ...i, comboSelections: null, notes: "" })),
      }),
    });
    return res.status;
  }, { slug: LOJA.slug, lojaId, itens: r.itens });
  if (status !== 200) throw new Error(`O pedido da sacola não foi aceito (${status}).`);
}

export default {
  id: "multimarcas",
  titulo: "Multimarcas: todas as suas marcas numa sacola só",
  rota: "store/cardapio",
  prontaQuando: "text=Tem várias marcas na mesma cozinha?",
  pronuncia: {
    "R$ 97": "noventa e sete reais",
  },

  /**
   * - a loja PAGA a mensalidade (não é isenta: isenta veria "LIBERADO", sem termo
   *   e sem preço);
   * - área de entrega (o prazo aparece no cartão de cada marca);
   * - fotos nos produtos (os destaques da página e o cardápio de cada marca).
   */
  async preparar(prisma, { loja, produtos }) {
    await prisma.user.update({
      where: { id: loja.id },
      data: {
        planPercent: 2,
        isFranqueadoHakim: false,
        storeLatLng: { lat: -16.6806, lng: -49.2563 },
        deliveryZoneType: "KM",
        deliveryZones: [{ km: 3, time: 30, fee: 5 }, { km: 5, time: 40, fee: 8 }],
      },
    });
    const destino = path.join(process.cwd(), "public", "uploads", "tutorial-multimarcas");
    fs.mkdirSync(destino, { recursive: true });
    const fotos = {
      "X-Burger": "smash.webp", "X-Bacon": "x-bacon.jpg", "X-Tudo": "x-tudo.jpg", "Batata Frita": "batata-frita.jpg",
      "Pizza Calabresa": "pizza-calabresa.jpg", "Pizza Marguerita": "pizza.webp",
    };
    for (const [nome, arquivo] of Object.entries(fotos)) {
      fs.copyFileSync(path.join(FOTOS, arquivo), path.join(destino, arquivo));
      await prisma.menuProduct.update({ where: { id: produtos[nome].id }, data: { imageUrl: `/uploads/tutorial-multimarcas/${arquivo}` } });
    }
  },

  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.context().addInitScript(esconderOQueTampa);
    await p.evaluate(esconderOQueTampa);
    // O adiantamento (prefetch) das telas do menu trava a tela por segundos no banco da gravação.
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await assentar(palco);
  },

  cenas: [
    // ── 1. Onde fica ─────────────────────────────────────────────────────────
    {
      capitulo: "Onde fica o Multimarcas",
      fala: "O Multimarcas é para quem tem várias marcas na mesma cozinha. Ele fica no menu, em Cardápio e vendas, e nesta faixa, no topo do Cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await ctx.ate(0.35);
        await palco.destacar(menu(p), { folga: 4 });
        await palco.mover(menu(p), { ms: 800 });
        await ctx.ate(0.72);
        const faixa = p.getByText("Tem várias marcas na mesma cozinha?").locator("xpath=../..");
        await palco.destacar(faixa, { folga: 4 });
        await palco.mover(p.getByText("Tem várias marcas na mesma cozinha?"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Conhecer o Multimarcas.",
      acao: async (palco) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("link", { name: /Conhecer o Multimarcas/ }), { ms: 600 });
        await p.getByText("Uma sacola só.").waitFor({ state: "visible", timeout: 60_000 });
      },
    },

    // ── 2. O que é ───────────────────────────────────────────────────────────
    {
      capitulo: "O que é",
      fala: "O cliente entra numa marca, põe no carrinho, entra em outra, põe mais, e fecha um pedido só, com uma entrega, num layout de aplicativo de delivery que ele já conhece.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(300);
        await palco.mover(p.getByRole("heading", { level: 1 }), { ms: 700 });
        await ctx.ate(0.3);
        const frase = p.getByText(/Ele entra numa loja, põe no carrinho/);
        await palco.destacar(frase, { folga: 6 });
        await palco.mover(frase, { ms: 600 });
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.mover(p.getByText("Sacola única entre as marcas"), { ms: 700 });
      },
    },
    {
      fala: "Aqui, a página mostra como o seu cliente pede, passo a passo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const passo = (re) => p.getByRole("button", { name: re });
        await palco.rolarAte(passo(/Entra numa marca e põe no carrinho/), { bloco: "center" });
        await ctx.ate(0.4);
        await palco.clicar(passo(/Entra numa marca e põe no carrinho/), { ms: 500 });
        await ctx.ate(0.65);
        await palco.clicar(passo(/Volta, entra em outra/), { ms: 500 });
        await ctx.ate(0.88);
        await palco.clicar(passo(/Fecha tudo junto/), { ms: 500 });
      },
    },

    // ── 3. Quanto custa ──────────────────────────────────────────────────────
    {
      capitulo: "Quanto custa",
      fala: "Custa R$ 97 por mês, numa linha própria do boleto. A mensalidade de cada loja continua igual.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const preco = p.locator("#preco");
        const nova = preco.getByText(/Fixo, com quantas marcas/).locator("xpath=..");
        const continua = preco.getByText("O que você já paga — continua igual").locator("xpath=..");
        await palco.rolarAte(continua, { bloco: "center" });
        await palco.destacar(nova, { folga: 6 });
        await palco.mover(nova.getByText(/R\$\s?97/).first(), { ms: 700 });
        await ctx.ate(0.6);
        await palco.destacar(continua, { folga: 6 });
        await palco.mover(continua.getByText("Mensalidade de cada loja"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A primeira ativação tem 7 dias grátis. Quem tem o Aplicativo da loja no Android e no iPhone ganha o Multimarcas de cortesia.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const teste = p.locator("#preco").getByText(/primeiros dias grátis/);
        await palco.destacar(teste, { folga: 6 });
        await palco.mover(teste, { ms: 600 });
        await ctx.ate(0.4);
        const cortesia = p.getByText(/Cortesia para quem tem o aplicativo completo/).locator("xpath=../..");
        await palco.rolarAte(cortesia, { bloco: "center" });
        await palco.destacar(cortesia, { folga: 6 });
        await palco.mover(p.getByText(/Cortesia para quem tem o aplicativo completo/), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },

    // ── 4. Ativar ────────────────────────────────────────────────────────────
    {
      capitulo: "Ativar",
      fala: "Para ativar, clique em Ativar com 7 dias grátis. Leia o termo, marque que concorda e clique em Concordo e ativar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ativar = p.locator("#preco").getByRole("button", { name: /Ativar com 7 dias grátis/ });
        await palco.rolarAte(ativar, { bloco: "center" });
        await palco.clicar(ativar, { ms: 600 });
        const termo = p.getByRole("dialog");
        await termo.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.45);
        await palco.clicar(termo.getByRole("checkbox"), { ms: 600 });
        await ctx.ate(0.75);
        await palco.clicar(termo.getByRole("button", { name: "Concordo e ativar" }), { ms: 500 });
        await p.getByText("Multimarcas ativado!").waitFor({ state: "visible", timeout: 30_000 });
      },
    },

    // ── 5. Criar as marcas ───────────────────────────────────────────────────
    {
      capitulo: "Criar as marcas",
      fala: "Pronto, está ativo. Cada marca é um grupo de categorias do seu cardápio. Clique em Marca para criar a primeira.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: "Suas marcas" });
        await titulo.waitFor({ state: "visible", timeout: 30_000 });
        await palco.mover(p.getByText(/^ATIVO · grátis até/), { ms: 700 });
        await ctx.ate(0.45);
        await palco.rolarAte(titulo, { bloco: "start" });
        await palco.mover(p.getByText(/Cada marca é um grupo de categorias/), { ms: 600 });
        await ctx.ate(0.82);
        await palco.clicar(p.getByRole("button", { name: "Marca", exact: true }), { ms: 600 });
        await p.getByLabel("Nome da marca").first().waitFor({ state: "visible", timeout: 5000 });
      },
    },
    {
      fala: "Dê o nome e o tipo de comida, e toque nas categorias da marca: Lanches e Porções.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nome = p.getByLabel("Nome da marca").nth(0);
        await nome.fill("");
        await palco.digitar(nome, "Burguer do Bairro");
        await palco.clicar(p.getByLabel("Tipo de comida").nth(0), { ms: 400 });
        await p.getByLabel("Tipo de comida").nth(0).fill("Hambúrguer");
        await p.keyboard.press("Escape");
        await ctx.ate(0.62);
        await palco.rolarAte(categoriaDaMarca(p, 0, "Lanches"), { bloco: "center" });
        await palco.clicar(categoriaDaMarca(p, 0, "Lanches"), { ms: 500 });
        await ctx.ate(0.85);
        await palco.clicar(categoriaDaMarca(p, 0, "Porções"), { ms: 500 });
      },
    },
    {
      fala: "Crie a segunda do mesmo jeito: Pizza da Esquina, tipo Pizza, com a categoria Pizzas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Marca", exact: true }), { ms: 600 });
        const nome = p.getByLabel("Nome da marca").nth(1);
        await nome.waitFor({ state: "visible", timeout: 5000 });
        await palco.rolarAte(blocoMarca(p, 1), { bloco: "center" });
        await nome.fill("");
        await palco.digitar(nome, "Pizza da Esquina");
        await palco.clicar(p.getByLabel("Tipo de comida").nth(1), { ms: 400 });
        await p.getByLabel("Tipo de comida").nth(1).fill("Pizza");
        await p.keyboard.press("Escape");
        await palco.clicar(categoriaDaMarca(p, 1, "Pizzas"), { ms: 500 });
      },
    },
    {
      fala: "As bebidas não estão em nenhuma marca. Por isso, elas aparecem em todas as marcas, para acompanhar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const acompanhar = p.getByText(/Para acompanhar \(aparece em todas as marcas\)/).locator("xpath=..");
        await palco.rolarAte(acompanhar, { bloco: "center" });
        await palco.destacar(acompanhar, { folga: 6 });
        await palco.mover(acompanhar, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
      pausa: 900,
    },

    // ── 6. Logo, capa e salvar ───────────────────────────────────────────────
    {
      capitulo: "Logo, capa e salvar",
      fala: "Suba o logo e a capa de cada marca. Ao lado, você vê a página como o cliente vai ver.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(blocoMarca(p, 0), { bloco: "start" });
        const envios = [[0, "Logo", "logo-burguer.png"], [0, "Capa da marca (foto larga)", "capa-burguer.webp"], [1, "Logo", "logo-pizza.png"], [1, "Capa da marca (foto larga)", "capa-pizza.webp"]];
        for (const [n, [i, rotulo, arquivo]] of envios.entries()) {
          const botao = blocoMarca(p, i).getByRole("button", { name: rotulo, exact: true });
          if (n === 2) await palco.rolarAte(blocoMarca(p, 1), { bloco: "center" });
          await enviar(palco, botao, arquivo);
          await blocoMarca(p, i).locator("img").nth(rotulo === "Logo" ? 0 : 1).waitFor({ state: "visible", timeout: 20_000 });
          await dormir(250);
        }
        await ctx.ate(0.7);
        const previa = p.getByLabel("Como o cliente vê");
        await palco.mover(previa.getByRole("heading", { name: "Nossas marcas" }), { ms: 700 });
      },
    },
    {
      fala: "Em Banners de oferta, você põe promoções. No fim, clique em Salvar a página.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const banners = p.getByRole("heading", { name: "Banners de oferta" }).locator("xpath=../..");
        await palco.rolarAte(banners, { bloco: "center" });
        await palco.destacar(banners, { folga: 6 });
        await palco.mover(p.getByRole("button", { name: "Banner", exact: true }), { ms: 600 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.clicar(p.getByRole("button", { name: "Salvar a página" }), { ms: 600 });
        await p.getByText("Página salva").waitFor({ state: "visible", timeout: 30_000 });
      },
    },

    // ── 7. O link ────────────────────────────────────────────────────────────
    {
      capitulo: "O link da página",
      fala: "Este é o link da sua página. Copie e divulgue na bio, no WhatsApp e no anúncio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await refazerPaginasPublicas(ctx.BASE);
        const barra = p.getByText("Link da sua página").locator("xpath=../..");
        await palco.rolarPagina(0);
        await palco.destacar(barra, { folga: 6 });
        await palco.mover(p.getByText(/firehubfood\.com\.br\/marcas\//), { ms: 700 });
        await ctx.ate(0.5);
        await palco.mover(p.getByRole("button", { name: /Copiar/ }), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },

    // ── 8. O cliente ─────────────────────────────────────────────────────────
    {
      capitulo: "Como o cliente pede",
      fala: "Assim o cliente vê: todas as suas marcas, uma embaixo da outra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/marcas/${LOJA.slug}`, { waitUntil: "load", timeout: 60_000 });
        const marcas = p.getByRole("heading", { name: "Nossas marcas" });
        await marcas.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(400);
        const cartoes = [p.getByRole("link", { name: /Burguer do Bairro/ }).first(), p.getByRole("link", { name: /Pizza da Esquina/ }).first()];
        await ctx.ate(0.5);
        await palco.destacar(cartoes, { folga: 8 });
        await palco.mover(cartoes[0], { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Ele entra no Burguer do Bairro e põe um X-Bacon na sacola.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("link", { name: /Burguer do Bairro/ }).first(), { ms: 500 });
        await p.waitForURL(/marca=/, { timeout: 30_000 });
        const produto = p.getByText("X-Bacon", { exact: true }).first();
        await produto.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
        await palco.rolarAte(produto, { bloco: "center" });
        await palco.clicar(produto.locator("xpath=ancestor::*[.//button][1]").locator("button").first(), { ms: 500 });
        const adicionar = p.getByRole("button", { name: /Adicionar à sacola/ });
        await adicionar.waitFor({ state: "visible", timeout: 10_000 });
        await palco.clicar(adicionar, { ms: 500 });
        await adicionar.waitFor({ state: "hidden", timeout: 10_000 });
      },
    },
    {
      fala: "Ele volta em Todas as marcas, e a sacola continua com o lanche.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.clicar(p.getByRole("link", { name: /Todas as marcas/ }), { ms: 500 });
        const pizza = p.getByRole("link", { name: /Pizza da Esquina/ }).first();
        await pizza.waitFor({ state: "visible", timeout: 30_000 });
        const verSacola = p.getByRole("link", { name: /Ver sacola/ });
        await verSacola.waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(verSacola, { folga: 6 });
        await palco.mover(verSacola, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Agora entra na Pizza da Esquina e põe uma pizza.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const pizza = p.getByRole("link", { name: /Pizza da Esquina/ }).first();
        await palco.clicar(pizza, { ms: 500 });
        await p.waitForURL(/marca=/, { timeout: 30_000 });
        const produto = p.getByText("Pizza Calabresa", { exact: true }).first();
        await produto.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
        await palco.rolarAte(produto, { bloco: "center" });
        await palco.clicar(produto.locator("xpath=ancestor::*[.//button][1]").locator("button").first(), { ms: 500 });
        const adicionar = p.getByRole("button", { name: /Adicionar à sacola/ });
        await adicionar.waitFor({ state: "visible", timeout: 10_000 });
        await palco.clicar(adicionar, { ms: 500 });
        await adicionar.waitFor({ state: "hidden", timeout: 10_000 });
      },
    },
    {
      fala: "Os dois itens, de marcas diferentes, estão na mesma sacola, e ele fecha tudo num pedido só.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const continuar = p.getByRole("button", { name: /Continuar pedido/ });
        await palco.rolarAte(continuar, { bloco: "end" });
        const itens = [p.getByText("Sua sacola", { exact: true }), p.getByText(/1x X-Bacon/), p.getByText(/1x Pizza Calabresa/), continuar];
        await palco.destacar(itens, { folga: 10 });
        await palco.mover(p.getByText(/1x X-Bacon/), { ms: 600 });
        await ctx.ate(0.3);
        await palco.mover(p.getByText(/1x Pizza Calabresa/), { ms: 500 });
        await ctx.ate(0.7);
        await palco.mover(continuar, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await fecharPedidoDaSacola(ctx, p);
      },
    },

    // ── 9. Na cozinha ────────────────────────────────────────────────────────
    {
      capitulo: "Na cozinha",
      fala: "No seu painel, chega um pedido só, como qualquer outro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/pedidos-clientes`, { waitUntil: "load", timeout: 60_000 });
        const cartao = p.locator("[draggable]").filter({ hasText: "#8 — " }).first();
        await cartao.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(400);
        await palco.destacar(cartao, { folga: 6 });
        await palco.mover(cartao.getByText(/#8 — Juliana Rocha/), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Na comanda, cada item sai com o nome da marca na frente. A cozinha sabe de qual marca é cada coisa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = p.locator("[draggable]").filter({ hasText: "#8 — " }).first();
        const ver = cartao.getByTitle("Ver pedido");
        await palco.rolarAte(ver, { bloco: "center" });
        await palco.clicar(ver, { ms: 600 });
        const burguer = p.getByText("[BURGUER DO BAIRRO] X-Bacon").last();
        const pizza = p.getByText("[PIZZA DA ESQUINA] Pizza Calabresa").last();
        await burguer.waitFor({ state: "visible", timeout: 15_000 });
        await palco.rolarAte(pizza, { bloco: "center" });
        await palco.camera([burguer.locator("xpath=.."), pizza.locator("xpath=..")], { zoomMax: 1.8, margem: 40 });
        await palco.destacar([burguer, pizza], { folga: 8 });
        await palco.mover(burguer, { ms: 600 });
        await ctx.ate(0.6);
        await palco.mover(pizza, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Resumo",
      fala: "Pronto: todas as suas marcas numa página só, com uma sacola e uma entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 700 });
        const fechar = p.getByRole("button", { name: "Fechar" }).last();
        if (await fechar.isVisible().catch(() => false)) {
          await palco.rolarAte(fechar, { bloco: "end" });
          await palco.clicar(fechar, { ms: 600 });
        }
        await ctx.ate(0.55);
        await palco.rolarPagina(0);
        await palco.destacar(menu(p), { folga: 4 });
        await palco.mover(menu(p), { ms: 800 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
      pausa: 700,
    },
  ],
};
