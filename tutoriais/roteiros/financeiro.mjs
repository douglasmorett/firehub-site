// Tutorial da tela Financeiro (/store/financeiro) — o DRE da loja.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código (src/app/store/financeiro/DREClient.tsx) antes
// de escrever cada frase:
// - a tela abre na aba Mensalidade; o resultado fica na aba "DRE Geral";
// - Receita Bruta Total = soma do total dos pedidos do período com status
//   diferente de CANCELADO; "Receita de Produtos" é ela menos a taxa de entrega;
// - CMV = custo cadastrado no produto × quantidade vendida (produto sem custo
//   conta zero — é o aviso amarelo da própria tela);
// - Taxa de Pagamento = total do pedido × a taxa da forma de pagamento dele;
// - Custo de Entrega = a taxa do motoboy gravada nos pedidos de entrega;
// - despesa lançada (DespesaLancada) entra pelo dia escolhido, somada por
//   categoria, sem proporção;
// - custos fixos entram na proporção do período (dias ÷ 30, no máximo o mês);
// - Lucro Líquido Final = o que sobra depois de tudo isso e da mensalidade.
//
// ── O que a fala NÃO diz, de propósito ──────────────────────────────────────
// - Percentuais da mensalidade: a linha do DRE diz "3% · mín R$60" e a conta
//   real (lib/firehub-billing.ts) é 1% com mínimo de R$ 100. Está no relatório.
// - Que a nota de compra ou a conta a pagar entram no DRE: o texto de ajuda da
//   aba promete, mas a conta do DRE não lê nenhuma das duas.
// - Que a aba Configurações grava a chave Pix: o botão dela só abre um aviso.
// - Saque e repasse: o botão da aba Extrato diz "Saque indisponível (em
//   implantação)". O vídeo não clica em nada que fale com banco.
import { dormir } from "../motor/palco.mjs";
import { cadastrarCustos, criarDespesas, criarHistorico } from "./_historico-comum.mjs";

const aba = (p, nome) => p.getByRole("button", { name: nome });
const periodo = (p, nome) => p.getByRole("button", { name: nome, exact: true });
/** Uma linha do demonstrativo, pelo texto dela ("(+) Receita Bruta Total"). */
const linha = (p, texto) => p.getByText(texto, { exact: true }).first().locator("xpath=..");
/** O valor da linha (a segunda coluna). */
const valor = (p, texto) => linha(p, texto).locator("span").nth(1);
/** A faixa colorida que abre cada bloco do demonstrativo ("RECEITAS", "DESPESAS OPERACIONAIS"). */
const faixa = (p, texto) => p.getByText(texto, { exact: true }).first().locator("xpath=..");
/** Um dos quadros de resumo, pelo título ("Receita Bruta"). */
const quadro = (p, titulo) => p.getByText(titulo, { exact: true }).first().locator("xpath=../..");
/** A bolinha "WhatsApp da loja", que o lojista pode arrastar para tirar da frente (lib/useArrastavel.ts). */
const botaoDoWhatsApp = (p) => p.getByText("WhatsApp da loja", { exact: true }).locator("xpath=..").locator("button").last();
const tituloDoDemonstrativo = (p) => p.getByRole("heading", { name: /^Demonstrativo de Resultado —/ });

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

export default {
  id: "financeiro",
  titulo: "Financeiro: quanto sobrou no mês",
  rota: "store/financeiro",
  prontaQuando: "text=Mensalidade FireHub Pro",
  pronuncia: { CMV: "cê eme vê", DRE: "dê erre é" },

  /** Dois meses de venda, custo em cada produto, custos fixos e despesas já lançadas. */
  async preparar(prisma, base) {
    await cadastrarCustos(prisma, base);
    await criarHistorico(prisma, base);
    await criarDespesas(prisma, base);
  },

  async antesDeGravar(palco) {
    const p = palco.pagina;
    // O botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo na captura: só o pulso para.
    await p.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    // O painel adianta (prefetch) as telas do menu; no banco de brinquedo isso ocupa o servidor por segundos.
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
      fala: "Esta é a tela Financeiro. Ela mostra quanto a loja vendeu, quanto saiu de custo e quanto sobrou no período.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await palco.mover(p.getByRole("heading", { name: /DRE — Demonstrativo de Resultado/ }), { ms: 1000 });
        await ctx.ate(0.5);
        const abas = aba(p, "Mensalidade").first().locator("xpath=..");
        await palco.destacar(abas, { folga: 4 });
        await palco.mover(aba(p, "DRE Geral"), { ms: 900 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A tela abre na aba Mensalidade, que é a cobrança do FireHub. A conta do resultado fica na aba DRE Geral.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(aba(p, "Mensalidade").first(), { folga: 4 });
        await palco.mover(aba(p, "Mensalidade").first(), { ms: 700 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await ctx.ate(0.62);
        await palco.clicar(aba(p, "DRE Geral"));
        await p.getByRole("heading", { name: "DRE — o resultado da sua loja" }).waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(aba(p, "DRE Geral"), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Escolher o período",
      fala: "Primeiro escolha o período nos botões do alto, ou marque as duas datas de um intervalo. Vamos olhar os últimos 30 dias.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botoes = periodo(p, "Hoje").locator("xpath=..");
        await palco.camera([botoes, p.getByRole("heading", { name: /DRE — Demonstrativo de Resultado/ })], { zoomMax: 1.45, margem: 50, ms: 600 });
        await palco.destacar(botoes, { folga: 6 });
        await palco.mover(periodo(p, "7 dias"), { ms: 600 });
        await ctx.ate(0.42);
        await palco.mover(p.locator('input[type="date"]').first(), { ms: 700 });
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.clicar(periodo(p, "30 dias"));
        await ctx.ate(1);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Os números do período",
      fala: "Os quadros do alto resumem o período. Eles mostram a receita, o lucro com a margem, o ticket médio, o que custaram os produtos e os motoboys, e quantos pedidos foram cancelados.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, quadro(p, "Receita Bruta"), 110);
        const quadros = ["Receita Bruta", "Lucro Líquido", "Ticket Médio", "CMV (Custo Produto)", "Custo Motoboy", "Cancelamentos"];
        await palco.camera(quadros.map((q) => quadro(p, q)), { zoomMax: 1.3, margem: 30, ms: 600 });
        const quando = [0.27, 0.38, 0.5, 0.64, 0.76, 0.88];
        for (const [i, q] of quadros.entries()) {
          await ctx.ate(quando[i]);
          await Promise.all([palco.destacar(quadro(p, q), { folga: 4 }), palco.mover(quadro(p, q), { ms: 420 })]);
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "De onde vem a receita",
      fala: "No demonstrativo, a Receita Bruta Total soma todos os pedidos do período, menos os cancelados. Ela aparece separada entre os produtos e a taxa de entrega cobrada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, tituloDoDemonstrativo(p), 110);
        await palco.camera([tituloDoDemonstrativo(p), linha(p, "(=) LUCRO BRUTO")], { zoomMax: 1.25, margem: 26, ms: 600 });
        await palco.destacar(linha(p, "(+) Receita Bruta Total"), { folga: 2 });
        await palco.mover(valor(p, "(+) Receita Bruta Total"), { ms: 800 });
        await ctx.ate(0.58);
        await palco.destacar([linha(p, "Receita de Produtos"), linha(p, "Taxa de Entrega Cobrada")], { folga: 2 });
        await palco.mover(valor(p, "Receita de Produtos"), { ms: 500 });
        await ctx.ate(0.84);
        await palco.mover(valor(p, "Taxa de Entrega Cobrada"), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O custo dos produtos",
      fala: "Depois sai o CMV, o custo dos produtos vendidos, que vem do custo cadastrado em cada produto do Cardápio. Produto sem custo conta como se fosse de graça.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(linha(p, "(-) CMV — Custo das Mercadorias"), { folga: 2 });
        await palco.mover(valor(p, "(-) CMV — Custo das Mercadorias"), { ms: 700 });
        await ctx.ate(0.62);
        await palco.destacar(linha(p, "(=) LUCRO BRUTO"), { folga: 2 });
        await palco.mover(valor(p, "(=) LUCRO BRUTO"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Taxas e entrega",
      fala: "Em Despesas Operacionais entram a taxa de pagamento, calculada pela forma de pagamento de cada pedido, e o custo de entrega, que é o valor do motoboy nos pedidos de entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, faixa(p, "DESPESAS OPERACIONAIS"), 130);
        await palco.camera([faixa(p, "DESPESAS OPERACIONAIS"), linha(p, "(-) Despesas lançadas")], { zoomMax: 1.25, margem: 40, ms: 600 });
        await ctx.ate(0.2);
        await palco.destacar(linha(p, "(-) Taxa de Pagamento (Gateway)"), { folga: 2 });
        await palco.mover(valor(p, "(-) Taxa de Pagamento (Gateway)"), { ms: 650 });
        await ctx.ate(0.62);
        await palco.destacar(linha(p, "(-) Custo de Entrega (Motoboy)"), { folga: 2 });
        await palco.mover(valor(p, "(-) Custo de Entrega (Motoboy)"), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Lançar uma despesa",
      fala: "Gás, embalagem ou um conserto não nascem do pedido. Para esses gastos, clique em Lançar despesa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lancar = p.getByRole("button", { name: "Lançar despesa" });
        await palco.destacar(["(-) Despesas lançadas", "Gás", "Embalagens", "Manutenção e conserto", "Material de limpeza", "Marketing e anúncios"].map((t) => linha(p, t)), { folga: 2 });
        await palco.mover(linha(p, "Gás").locator("span").first(), { ms: 700 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await rolarPaginaPara(palco, lancar, 150);
        await palco.clicar(lancar);
        await p.getByPlaceholder("Ex.: Gás").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Confira a data, escreva a categoria e o valor, e clique em Lançar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const data = p.locator('label:has-text("Data") input[type="date"]');
        const formulario = p.getByPlaceholder("Ex.: Gás").locator("xpath=ancestor::div[.//button][1]");
        await palco.camera(formulario, { zoomMax: 1.25, margem: 30, ms: 500 });
        await palco.mover(data, { ms: 500 });
        await ctx.ate(0.22);
        await palco.digitar(p.getByPlaceholder("Ex.: Gás"), "Gás");
        await palco.digitar(p.getByPlaceholder("0,00"), "130");
        await ctx.ate(0.8);
        await palco.clicar(p.getByRole("button", { name: "Lançar", exact: true }));
        await p.getByText(/Despesa de R\$\s*130,00 lançada/).waitFor({ state: "visible", timeout: 10_000 });
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "A despesa entra na hora no demonstrativo, somada na categoria dela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // o aviso de "despesa lançada" desce no alto da tela: as linhas ficam logo abaixo dele
        await rolarPaginaPara(palco, linha(p, "(-) Despesas lançadas"), 150);
        await palco.destacar([linha(p, "(-) Despesas lançadas"), linha(p, "Gás")], { folga: 2 });
        await palco.mover(valor(p, "Gás"), { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.clicar(p.getByRole("button", { name: "Fechar", exact: true }).first());
      },
    },
    {
      capitulo: "Custos fixos",
      fala: "Aluguel, salários e as outras contas de todo mês ficam na aba Custos Fixos, sempre com o valor do mês inteiro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPagina(palco, 0);
        await palco.clicar(aba(p, /Custos Fixos/));
        const titulo = p.getByRole("heading", { name: "Custos Fixos Mensais" });
        await titulo.waitFor({ state: "visible", timeout: 10_000 });
        const lista = p.getByText("VALOR / MÊS", { exact: true }).locator("xpath=../..");
        await rolarPaginaPara(palco, lista, 190);
        await palco.camera(lista, { zoomMax: 1.3, margem: 70, ms: 600 });
        await palco.destacar(lista, { folga: 4 });
        await palco.mover(p.getByText("Aluguel", { exact: true }), { ms: 700 });
        await ctx.ate(0.8);
        await palco.mover(p.getByText("VALOR / MÊS", { exact: true }), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        // volta para o demonstrativo, que é onde a próxima fala começa
        await rolarPagina(palco, 0);
        await palco.clicar(aba(p, "DRE Geral"));
        await tituloDoDemonstrativo(p).waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      capitulo: "O resultado",
      fala: "Aqui no fim da página, a bolinha do WhatsApp fica em cima dos valores. É só arrastar a bolinha para tirar da frente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, linha(p, "(=) LUCRO LÍQUIDO FINAL"), 300);
        const bolinha = botaoDoWhatsApp(p);
        await palco.mover(bolinha, { ms: 800 });
        await ctx.ate(0.55);
        // Para baixo e para a borda: fica por cima da outra bolinha, fora da coluna dos valores.
        await palco.arrastar(bolinha, { x: 1338, y: 742 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Antes do resultado, o demonstrativo desconta a mensalidade do FireHub e os custos fixos, na proporção do período escolhido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const mensalidade = p.getByText(/^\(-\) Mensalidade FireHub/).locator("xpath=..");
        await palco.destacar(mensalidade, { folga: 2 });
        await palco.mover(mensalidade.locator("span").nth(1), { ms: 700 });
        await ctx.ate(0.55);
        await palco.destacar([faixa(p, "CUSTOS FIXOS MENSAIS"), linha(p, "(-) Total Custos Fixos (período)")], { folga: 2 });
        await palco.mover(valor(p, "(-) Total Custos Fixos (período)"), { ms: 650 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No fim da conta está o Lucro Líquido Final: é o que sobrou no período. As barras de baixo mostram as margens.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lucro = linha(p, "(=) LUCRO LÍQUIDO FINAL");
        const margens = p.getByText("Margem Bruta", { exact: true }).locator("xpath=../..");
        await palco.camera([linha(p, "(-) Total Custos Fixos (período)"), margens], { zoomMax: 1.25, margem: 40, ms: 600 });
        await palco.destacar(lucro, { folga: 2 });
        await palco.mover(valor(p, "(=) LUCRO LÍQUIDO FINAL"), { ms: 800 });
        await ctx.ate(0.66);
        await palco.destacar(margens, { folga: 6 });
        await palco.mover(p.getByText("Margem Líquida", { exact: true }), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "As outras abas",
      fala: "As abas Extrato, Relatório e Configurações são dos pagamentos online e do repasse.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPagina(palco, 0);
        await palco.destacar([aba(p, "Extrato"), aba(p, "Relatório"), aba(p, "Configurações")], { folga: 4 });
        await palco.mover(aba(p, "Extrato"), { ms: 500 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(aba(p, "Extrato"));
        await p.getByRole("heading", { name: "Extrato dos pagamentos online" }).waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.6);
        await palco.mover(aba(p, "Relatório"), { ms: 400 });
        await ctx.ate(0.78);
        await palco.mover(aba(p, "Configurações"), { ms: 400 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Em Contas a Pagar ficam os boletos dos fornecedores e os vencimentos. Em Notas de Compras ficam guardadas as notas do que a loja compra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(aba(p, /Contas a Pagar/));
        await p.getByRole("heading", { name: /Contas a Pagar/ }).waitFor({ state: "visible", timeout: 10_000 });
        await palco.mover(p.getByText("VENCEM HOJE", { exact: true }), { ms: 800 });
        await ctx.ate(0.52);
        await palco.clicar(aba(p, /Notas de Compras/));
        await p.getByRole("heading", { name: "Notas de Compras", exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
        await palco.mover(p.getByRole("heading", { name: "Notas de Compras", exact: true }).first(), { ms: 800 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você já sabe ler o resultado da loja. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
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
