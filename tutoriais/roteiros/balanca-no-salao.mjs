// DEMONSTRAÇÃO da Balança para o cliente (não é tutorial do painel): o processo
// no salão, do cartão ao caixa. Pedido do Douglas, 20/11/2026.
//
// A tela da balança é a de VERDADE (sem ?simular=1): a balança é uma Prix 3 Fit
// de teste atrás da Web Serial, falando o protocolo Toledo em bytes
// (_salao-da-balanca.mjs). Cada pesagem passa pela rota /api/store/balanca/pesar
// e é CONFERIDA no banco durante a gravação: se o valor gravado não bater, o
// vídeo para — a gravação é também o teste de ponta a ponta.
import { dormir } from "../motor/palco.mjs";
import { balancaToledoDeTeste, desenharSalao } from "./_salao-da-balanca.mjs";

const PRODUTO = "Refeição por kg";
const PRECO = 59.9;
const VERSAO_DO_TERMO = "2026-11-05";

/** O aviso do Assistente e os balões flutuantes (como em balanca.mjs). */
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

const salao = (p, metodo, ...args) => p.evaluate(([m, a]) => window.__salao?.[m](...a), [metodo, args]);
const balanca = (p, metodo, ...args) => p.evaluate(([m, a]) => window.__balanca?.[m](...a), [metodo, args]);

/** O leitor de mesa é um "teclado": digita o número do cartão e um Enter. */
async function passarCartao(p, numero) {
  await p.keyboard.type(String(numero), { delay: 18 });
  await p.keyboard.press("Enter");
}

/** Confere no banco o prato que a tela disse ter lançado. */
async function conferirNoBanco(prisma, { kg, comanda, totalEsperado }) {
  const item = await prisma.customerOrderItem.findFirst({ where: { pesoKg: kg }, orderBy: { id: "desc" }, include: { order: true } });
  const valor = Math.round(kg * PRECO * 100) / 100;
  if (!item) throw new Error(`Prato de ${kg} kg não está no banco.`);
  if (item.quantity !== 1 || Math.abs(item.price - valor) > 0.001) throw new Error(`Prato gravado errado: qtd ${item.quantity}, preço ${item.price} (esperado ${valor}).`);
  if (item.order.status !== "ENTREGUE") throw new Error(`Pedido do prato com status ${item.order.status} (esperado ENTREGUE, fora da cozinha).`);
  const sessao = await prisma.tableSession.findUnique({ where: { id: item.order.tableSessionId }, include: { table: true } });
  if (sessao?.table?.number !== comanda || sessao.status !== "OPEN") throw new Error(`Prato caiu na mesa ${sessao?.table?.number} (${sessao?.status}), não na comanda ${comanda} aberta.`);
  const soma = await prisma.customerOrder.aggregate({ where: { tableSessionId: sessao.id, status: { not: "CANCELADO" } }, _sum: { totalAmount: true } });
  if (Math.abs((soma._sum.totalAmount ?? 0) - totalEsperado) > 0.001) throw new Error(`Total da comanda ${soma._sum.totalAmount} (esperado ${totalEsperado}).`);
}

export default {
  id: "balanca-no-salao",
  titulo: "Balança no self-service: do prato à comanda, sem atendente",
  rota: "store/balanca",
  prontaQuando: "text=Como funciona no salão",
  pronuncia: {
    "R$ 59,90": "cinquenta e nove reais e noventa",
    "R$ 27,07": "vinte e sete reais e sete centavos",
    "R$ 13,06": "treze reais e seis centavos",
    "R$ 40,13": "quarenta reais e treze centavos",
    "452 gramas": "quatrocentos e cinquenta e dois gramas",
    "101 ao 150": "cento e um ao cento e cinquenta",
    "101": "cento e um",
  },

  async preparar(prisma, { loja }) {
    await prisma.user.update({ where: { id: loja.id }, data: { planPercent: 2, isFranqueadoHakim: false } });
    await prisma.menuCategory.create({ data: { franchiseeId: loja.id, name: "Self-service", emoji: "🍽️", sortOrder: 4 } });
    await prisma.menuProduct.create({
      data: { franchiseeId: loja.id, name: PRODUTO, description: "Buffet livre, preço do quilo", price: PRECO, category: "Self-service", sortOrder: 20 },
    });
  },

  async antesDeGravar(palco, ctx) {
    const p = palco.pagina;
    // O dono já ligou o módulo e marcou o produto por quilo — pelas rotas da tela Balança.
    const produto = await ctx.prisma.menuProduct.findFirst({ where: { name: PRODUTO }, select: { id: true } });
    const r = await p.evaluate(async ([produtoId, versao]) => {
      const a = await fetch("/api/store/balanca", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ligar: true, aceite: { versao } }) });
      const b = await fetch("/api/store/balanca", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ produtos: [produtoId] }) });
      // Self-service não cobra os 10% do garçom (engrenagem › Taxa, em Mesas).
      const c = await fetch("/api/store/tables", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxaServicoPadrao: 0 }) });
      return [a.status, b.status, c.status, await a.text(), await b.text()];
    }, [produto.id, VERSAO_DO_TERMO]);
    if (r[0] !== 200 || r[1] !== 200 || r[2] !== 200) throw new Error(`Não ligou a balança: ${r.join(" | ")}`);

    const contexto = p.context();
    await contexto.addInitScript(esconderOQueTampa);
    await contexto.addInitScript(balancaToledoDeTeste, { velocidade: 2400 });
    await contexto.addInitScript(desenharSalao);
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await p.goto(`${ctx.BASE}/store/balanca`, { waitUntil: "load", timeout: 60_000 });
    await p.getByRole("heading", { name: "O que a loja compra" }).waitFor({ state: "attached", timeout: 30_000 });
    await p.evaluate(esconderOQueTampa);
    await dormir(800);
  },

  cenas: [
    // ── 0. O que a loja compra ───────────────────────────────────────────────
    {
      capitulo: "O que a loja compra",
      fala: "Veja como funciona o self-service por quilo com o FireHub, sem atendente na balança. O equipamento, o FireHub indica e a loja compra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: "O que a loja compra" });
        await ctx.ate(0.5);
        await palco.rolarAte(titulo, { bloco: "start" });
        await palco.mover(titulo, { ms: 600 });
      },
    },
    {
      fala: "A balança com o cabo, um leitor de código de barras de mesa, um computador simples ao lado da balança, e as comandas com código de barras.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lista = p.getByRole("heading", { name: "O que a loja compra" }).locator("xpath=..").locator("ol");
        await palco.destacar(lista, { folga: 8 });
        const itens = ["Balança Toledo Prix 3 Fit", "Leitor de código de barras de mesa", "Computador com Windows ao lado da balança", "Comandas de PVC com código de barras"];
        for (const [i, t] of itens.entries()) {
          await ctx.ate(0.03 + i * 0.24);
          await palco.mover(lista.getByText(t, { exact: true }), { ms: 500 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },

    // ── 1. As comandas ───────────────────────────────────────────────────────
    {
      capitulo: "As comandas no sistema",
      fala: "As comandas são cadastradas aqui, em Mesas, na aba Comandas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/mesas`, { waitUntil: "load", timeout: 60_000 });
        await p.getByRole("button", { name: "⚙️", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
        await palco.clicar(p.getByRole("button", { name: "⚙️", exact: true }), { ms: 600 });
        await p.getByRole("heading", { name: "⚙️ Gerenciar Mesas" }).waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.8);
        await palco.clicar(p.getByRole("button", { name: /^🎫 Comandas/ }), { ms: 600 });
        await p.getByText("Nenhum cartão cadastrado").waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      fala: "Digite a numeração das comandas, por exemplo do 101 ao 150, e clique em Criar cartões.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const de = p.getByLabel("Primeiro número");
        const ate = p.getByLabel("Último número");
        await de.fill("");
        await palco.digitar(de, "101");
        await ate.fill("");
        await palco.digitar(ate, "150");
        await ctx.ate(0.6);
        await palco.clicar(p.getByRole("button", { name: "Criar cartões" }), { ms: 600 });
        await p.getByText(/50 cartões cadastrados/).waitFor({ state: "visible", timeout: 20_000 });
      },
    },
    {
      fala: "Quem não quiser comprar comandas pode imprimir as do FireHub, com o número e o código de barras.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const imprimir = p.getByRole("link", { name: /Imprimir cartões/ });
        await palco.destacar(imprimir, { folga: 6 });
        await palco.mover(imprimir, { ms: 600 });
        await ctx.ate(0.2);
        await palco.apagarDestaque();
        await p.goto(`${ctx.BASE}/store/mesas/cartoes?de=101&ate=150`, { waitUntil: "load", timeout: 60_000 });
        await p.getByText("101", { exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
        await dormir(300);
        await palco.mover(p.getByText("101", { exact: true }).first(), { ms: 700 });
      },
      pausa: 300,
    },

    // ── 2. Na balança ────────────────────────────────────────────────────────
    {
      capitulo: "Na balança",
      fala: "No salão fica assim: a balança, ligada pelo cabo ao computador com esta tela do FireHub, e o leitor de comanda do lado. Ninguém precisa ficar ali.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/balanca/pesar`, { waitUntil: "load", timeout: 60_000 });
        await p.getByText("Coloque o prato na balança").waitFor({ state: "visible", timeout: 30_000 });
        await salao(p, "passo", "Balança, leitor de cartão e a tela do FireHub");
      },
    },
    {
      fala: "O cliente pegou a comanda 101 na entrada, se serviu e coloca o prato na balança.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await salao(p, "passo", "1. Pegou a comanda e se serviu");
        await salao(p, "cartao", "mao");
        await ctx.ate(0.55);
        await salao(p, "passo", "2. Pôs o prato na balança");
        await salao(p, "prato", true);
        await balanca(p, "pesar", 0.452);
        await p.getByText("Passe o cartão da comanda").waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      fala: "O peso vai sozinho para a tela. Quando firma, ela calcula: 452 gramas, a R$ 59,90 o quilo, dá R$ 27,07.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await salao(p, "passo", "3. A tela calcula sozinha");
        await ctx.ate(0.4);
        const valor = p.getByText(/R\$\s?27,07/).first();
        await palco.destacar([p.getByText(/0,452 kg/).first(), valor], { folga: 10 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
      pausa: 250,
    },
    {
      fala: "Com o prato ainda na balança, ele encosta a comanda no leitor. Bipou, o valor está na comanda 101.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await salao(p, "passo", "4. Encostou a comanda no leitor");
        await salao(p, "cartao", "leitor");
        await ctx.ate(0.42);
        await salao(p, "bip");
        await passarCartao(p, 101);
        await p.getByText(/R\$\s?27,07 na comanda 101/).waitFor({ state: "visible", timeout: 15_000 });
        await conferirNoBanco(ctx.prisma, { kg: 0.452, comanda: 101, totalEsperado: 27.07 });
        await salao(p, "passo", "✓ Lançado na comanda 101");
      },
      pausa: 600,
    },
    {
      fala: "Ele tira o prato, a tela volta para o começo e já espera o próximo cliente. O mesmo prato não entra duas vezes.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await salao(p, "cartao", "fora");
        await ctx.ate(0.12);
        await salao(p, "passo", "5. Tirou o prato: próximo cliente");
        await salao(p, "prato", false);
        await balanca(p, "tirar");
        await p.getByText("Coloque o prato na balança").waitFor({ state: "visible", timeout: 15_000 });
      },
    },

    // ── 3. Repetiu ───────────────────────────────────────────────────────────
    {
      capitulo: "Repetiu? Soma na comanda",
      fala: "Se ele voltar para repetir, é o mesmo caminho: pesa, encosta a comanda, e o valor soma nela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await salao(p, "passo", "Repetiu: pesa de novo");
        await salao(p, "cartao", "mao");
        await salao(p, "prato", true);
        await balanca(p, "pesar", 0.218);
        await p.getByText("Passe o cartão da comanda").waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(0.5);
        await salao(p, "cartao", "leitor");
        await dormir(700);
        await salao(p, "bip");
        await passarCartao(p, 101);
        await p.getByText(/R\$\s?13,06 na comanda 101/).waitFor({ state: "visible", timeout: 15_000 });
        await conferirNoBanco(ctx.prisma, { kg: 0.218, comanda: 101, totalEsperado: 40.13 });
        await salao(p, "passo", "✓ Somou na comanda 101");
      },
    },
    {
      fala: "A tela mostra o total da comanda até agora: R$ 40,13.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const total = p.getByText(/Total da comanda/).first();
        await palco.destacar(total, { folga: 8 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await salao(p, "cartao", "fora");
        await salao(p, "prato", false);
        await balanca(p, "tirar");
      },
      pausa: 500,
    },

    // ── 4. No caixa ──────────────────────────────────────────────────────────
    {
      capitulo: "No caixa",
      fala: "Na saída, o caixa abre Mesas, Comandas, e passa a mesma comanda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/mesas`, { waitUntil: "load", timeout: 60_000 });
        const chip = p.getByRole("button", { name: /^🎫 Comandas/ });
        const campo = p.getByLabel("Número da comanda");
        await Promise.race([chip.waitFor({ state: "visible", timeout: 30_000 }), campo.waitFor({ state: "visible", timeout: 30_000 })]);
        await dormir(400);
        if (await chip.isVisible().catch(() => false)) await palco.clicar(chip, { ms: 600 });
        await campo.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.65);
        await palco.digitar(campo, "101");
        await p.keyboard.press("Enter");
        await p.getByText(PRODUTO).first().waitFor({ state: "visible", timeout: 20_000 });
      },
    },
    {
      fala: "A conta abre com os dois pratos, o peso de cada um e o total. A bebida se lança na mesma comanda, e fecha como uma mesa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const consumo = p.getByText(/^Consumo/).first();
        await palco.rolarAte(consumo, { bloco: "center" });
        const pedidos = [p.getByText("Pedido #8").first().locator("xpath=../.."), p.getByText("Pedido #9").first().locator("xpath=../.."), consumo.locator("xpath=..")];
        await palco.destacar(pedidos, { folga: 6 });
        await palco.mover(p.getByText(/0,452 kg/).first(), { ms: 700 });
        await ctx.ate(0.45);
        await palco.mover(p.getByText(/0,218 kg/).first(), { ms: 600 });
        await ctx.ate(0.7);
        await palco.mover(consumo, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
      pausa: 500,
    },
    {
      capitulo: "Resumo",
      fala: "Resumindo: o cliente pesa, encosta a comanda e paga na saída. Sem atendente na balança e sem erro de digitação.",
      acao: async (palco, ctx) => {
        await palco.pagina.evaluate(() => {
          const d = document.createElement("div");
          d.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:#0F172A;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;font-family:system-ui,'Segoe UI',sans-serif;opacity:0;transition:opacity .5s";
          const passo = (n, t, sub) => `<div style="flex:1;min-width:0;background:#1E293B;border-radius:20px;padding:26px 22px;text-align:center"><div style="font-size:44px;font-weight:900;color:#5EEAD4">${n}</div><div style="font-size:26px;font-weight:900;margin-top:6px">${t}</div><div style="font-size:16px;color:#94A3B8;margin-top:8px">${sub}</div></div>`;
          d.innerHTML = `<div style="font-size:20px;font-weight:800;letter-spacing:.14em;color:#F59E0B">SELF-SERVICE POR QUILO · FIREHUB</div>
            <div style="display:flex;gap:22px;width:min(1100px,90vw)">
              ${passo("1", "Pesa", "o cliente põe o prato na balança")}
              ${passo("2", "Encosta a comanda", "o valor cai na comanda dele")}
              ${passo("3", "Paga na saída", "o caixa passa a comanda e fecha")}
            </div>
            <div style="font-size:18px;color:#CBD5E1">Sem atendente na balança · sem erro de digitação · equipamento indicado pelo FireHub</div>`;
          document.body.appendChild(d);
          requestAnimationFrame(() => { d.style.opacity = "1"; });
        });
        await ctx.ate(1);
      },
      pausa: 1500,
    },
  ],
};
