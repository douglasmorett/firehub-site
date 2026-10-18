// Tutorial da tela Bill, seu assessor (/store/bill: BillClient + PainelDoBill).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// Conferido no código antes de escrever (18/10/2026, master 23dabfd7):
// - menu: grupo "Gestão", item "Bill, seu assessor" (lib/menu-do-painel.ts);
// - desligado, a tela é a oferta (BillClient › Oferta): o celular toca as cenas
//   sozinho e o card põe a cena no celular; o que as cenas mostram é o que as
//   ferramentas fazem (lib/assessor/ferramentas.ts e cardapio.ts);
// - R$ 49,90/mês no boleto da mensalidade; 7 dias grátis só na primeira
//   ativação; ligar só com o "concordo" do termo (lib/assessor/termo.ts e
//   assinatura.ts); desligou, o mês seguinte não é cobrado;
// - o Bill atende só os números do dono (WhatsApp do proprietário em Minha
//   Loja + sócio/gerente em Chatbot IA › Notificações); cliente fica com o robô;
// - aba Conversa: a mesma conversa do WhatsApp, grava de verdade
//   (api/store/assessor/conversar → conversarComOAssessor, Gemini no servidor);
//   o exemplo do "O que posso pedir" vai para a caixa de texto, sem enviar;
// - pausar = MenuProduct.active (site, robô, balcão, totem e combos; o iFood
//   pelo app do iFood);
// - Visão geral: hoje/7 dias/mês, compras, despesas e contas em R$; "Pausados
//   pelo Bill" com Reativar;
// - Histórico: Desfazer só no lançamento mais novo (a regra do "desfaz"),
//   pede um segundo toque ("Toque de novo");
// - Configuração: "Desligar o Bill" + "Toque de novo para desligar".
//
// ── O BILL, NESTA GRAVAÇÃO ──────────────────────────────────────────────────
// A conversa roda DE VERDADE: o painel do ambiente sobe com GEMINI_API_KEY e o
// Bill lança no banco descartável da loja fictícia (a compra entra no estoque e
// no financeiro, a batata é pausada). Nada sai da loja fictícia: o painel não
// manda WhatsApp (a conversa é a do painel). A resposta do Gemini muda de uma
// gravação para outra; por isso a fala descreve o que a FERRAMENTA fez (o que
// está no banco), e a cena para se o Bill não gravou (`gravou: false`).
import { dormir } from "../motor/palco.mjs";

const menu = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/bill"]');
const aba = (p, nome) => p.getByRole("tab", { name: nome });
const caixaDeTexto = (p) => p.getByPlaceholder("Ex.: acabou a esfirra de frango, pausa");
/** O último balão da conversa (o penúltimo filho da área que rola; o último é a âncora do fim). */
const ultimoBalao = (p) => p.locator(".pb-conversa-caixa > div:nth-child(2) > div:first-child > div:nth-last-child(2)");
const cartao = (p, titulo) => p.locator(".pb-card").filter({ has: p.getByRole("heading", { name: titulo }) });

/** Espera a resposta de /api/store/assessor/conversar (pedida na cena anterior) e confere que o Bill gravou. */
let respostaPendente = null;
function vigiarResposta(p) {
  respostaPendente = p.waitForResponse((r) => r.url().includes("/api/store/assessor/conversar"), { timeout: 60_000 })
    .then(async (r) => ({ status: r.status(), corpo: await r.json().catch(() => ({})) }));
  respostaPendente.catch(() => {});
}
async function respostaDoBill(p) {
  const r = await respostaPendente;
  if (r.status !== 200 || !r.corpo?.gravou) {
    throw new Error(`O Bill não gravou (status ${r.status}): ${JSON.stringify(r.corpo).slice(0, 200)}`);
  }
  // o balão aparece logo depois (buscarNovas)
  await p.waitForFunction(() => !document.querySelector(".pb-conversa-caixa .animate-spin"), null, { timeout: 15_000 });
  await dormir(300);
  return r.corpo;
}

/**
 * Esconde o que não é desta tela: os balões flutuantes do canto (WhatsApp da
 * loja, suporte), que tampam o fim dos cartões. Roda de novo a cada meio
 * segundo, porque os balões renascem a cada render.
 */
function esconderFlutuantes() {
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
}

const roteiro = {
  id: "bill",
  titulo: "Bill, seu assessor: estoque e financeiro pelo WhatsApp",
  rota: "store/bill",
  prontaQuando: "text=Você cuida da loja.",
  pronuncia: {
    "R$ 49,90": "quarenta e nove e noventa",
    "R$ 45": "quarenta e cinco reais",
  },

  async preparar(prisma, { loja }) {
    // A loja da semente NÃO é isenta (planPercent 1, e-mail fora da lista de
    // isenção): a tela mostra a oferta, o preço e o termo. Garantido aqui para
    // o vídeo nunca sair com o Bill "sempre ligado" de conta da casa.
    // O WhatsApp do proprietário e o número do robô são fictícios.
    await prisma.user.update({
      where: { id: loja.id },
      data: {
        planPercent: 1,
        isFranqueadoHakim: false,
        notificationPhone: "11988887777",
        chatbotConfig: { phone: "5511999990000" },
      },
    });
    await prisma.stockItem.createMany({
      data: [
        { franchiseeId: loja.id, name: "Coca-Cola Lata 350ml", unit: "un", quantity: 24, minQuantity: 12, unitCost: 4.2, supplier: "Atacadão" },
        { franchiseeId: loja.id, name: "Mussarela", unit: "kg", quantity: 6, minQuantity: 3, unitCost: 42, supplier: "Laticínios Bom Gosto" },
        { franchiseeId: loja.id, name: "Batata congelada", unit: "kg", quantity: 10, minQuantity: 4, unitCost: 14, supplier: "Atacadão" },
        { franchiseeId: loja.id, name: "Pão de hambúrguer", unit: "un", quantity: 60, minQuantity: 30, unitCost: 0.9, supplier: "Padaria Central" },
      ],
    });
  },

  /**
   * - o aviso do Assistente de Impressão (o desta máquina é de outra loja) sai
   *   pelo "Não ver mais";
   * - nada sai para o WhatsApp (wa.me barrado, window.open desligado);
   * - balões flutuantes escondidos; o celular da oferta volta à primeira cena.
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.route(/wa\.me|api\.whatsapp\.com/, (rota) => rota.abort());
    await p.evaluate(() => { window.open = () => null; });
    const naoVerMais = p.getByRole("button", { name: "Não ver mais" });
    if (await naoVerMais.count()) { await naoVerMais.first().click().catch(() => {}); await dormir(600); }
    await p.evaluate(esconderFlutuantes);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.locator(".bo-cel-pontos button").first().click();
    await dormir(1500);
  },

  cenas: [
    {
      capitulo: "Onde fica o Bill",
      fala: "O Bill, seu assessor, fica no menu, em Gestão: estoque, financeiro e cardápio pelo WhatsApp.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(300);
        await palco.rolarAte(menu(p), { bloco: "center" });
        await palco.destacar(menu(p), { folga: 4 });
        await palco.mover(menu(p), { ms: 900 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.mover(p.locator(".bo-hero h2"), { ms: 800 });
      },
    },
    {
      capitulo: "O que ele faz",
      fala: "Do seu WhatsApp, você manda áudio, texto ou foto da nota para o número da loja, como falaria com um gerente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const garantias = p.locator(".bo-garantias");
        await palco.destacar([p.locator(".bo-hero-texto p"), garantias], { folga: 8 });
        await palco.mover(p.locator(".bo-hero-texto p"), { ms: 700 });
        await ctx.ate(0.5);
        await palco.mover(garantias.locator("li").first(), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No exemplo, um áudio de compra vira entrada no estoque e conta paga no financeiro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const celular = p.locator(".bo-celular");
        await palco.clicar(p.locator(".bo-cel-pontos button").first(), { ms: 700 });
        await palco.camera(celular, { zoomMax: 1.6, margem: 30 });
        await palco.mover(celular.locator(".bo-dono").first(), { ms: 600 }).catch(() => {});
        await ctx.ate(0.55);
        await palco.mover(celular.locator(".bo-bill").last(), { ms: 600 }).catch(() => {});
        await ctx.ate(1);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "Embaixo estão outros exemplos: pausar o que acabou, lançar um gasto, anotar boletos e fechar a loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cards = p.locator(".bo-cards");
        await palco.rolarAte(cards, { bloco: "center" });
        await palco.destacar(cards, { folga: 8 });
        const nomes = ["Pausa o que acabou", "Fala do gasto", "Contas e boletos", "Abre e fecha a loja"];
        for (const [i, nome] of nomes.entries()) {
          await ctx.ate(0.32 + i * 0.16);
          await palco.mover(p.locator(".bo-card").filter({ hasText: nome }), { ms: 450 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Preço e teste grátis",
      fala: "O Bill custa R$ 49,90 por mês, no boleto da mensalidade do FireHub, com 7 dias grátis na primeira ativação.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const preco = p.locator(".bo-preco");
        await palco.rolarAte(preco, { bloco: "center" });
        await palco.destacar(preco, { folga: 6 });
        await palco.mover(p.locator(".bo-preco-valor"), { ms: 700 });
        await ctx.ate(0.5);
        await palco.mover(preco.locator("li").first(), { ms: 600 });
        await ctx.ate(0.8);
        await palco.mover(preco.locator("li").first(), { ms: 300 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique em Testar 7 dias grátis. Antes de ligar, aparece o termo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(p.locator(".bo-preco .bo-cta"), { ms: 600 });
        await p.getByRole("dialog").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.75);
        await palco.mover(p.getByRole("dialog").getByText(/^Termo de contratação/), { ms: 600 });
      },
    },
    {
      fala: "Depois do teste, o mês em que o Bill ficar ligado é cobrado inteiro. Desligou, o mês seguinte não é cobrado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const clausulas = p.getByRole("dialog").locator("ol li");
        await palco.destacar(clausulas.nth(2), { folga: 6 });
        await palco.mover(clausulas.nth(2), { ms: 700 });
        await ctx.ate(0.55);
        await palco.destacar(clausulas.nth(3), { folga: 6 });
        await palco.mover(clausulas.nth(3), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Marque Li e concordo e clique em Concordo e ativar o Bill.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const caixa = p.getByRole("dialog").locator('input[type="checkbox"]');
        await palco.rolarAte(caixa, { bloco: "center" });
        await ctx.ate(0.15);
        await palco.clicar(caixa, { ms: 600 });
        await ctx.ate(0.55);
        await palco.clicar(p.getByRole("button", { name: "Concordo e ativar o Bill" }), { ms: 600 });
        await p.locator(".pb-selo").waitFor({ state: "visible", timeout: 20_000 });
      },
    },
    {
      fala: "Pronto: Bill ligado. O selo mostra até quando vai o teste grátis.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const selo = p.locator(".pb-selo");
        await ctx.ate(0.3);
        await palco.camera([p.locator(".pb-topo")], { zoomMax: 1.5, margem: 30 });
        await palco.destacar(selo, { folga: 6 });
        await palco.mover(selo, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Quem fala com o Bill",
      fala: "Em Configuração ficam os números que falam com o Bill: o WhatsApp do proprietário e os de sócio ou gerente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(aba(p, /Configuração/), { ms: 600 });
        const quem = cartao(p, /Quem fala com o Bill/);
        await quem.waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(quem, { folga: 6 });
        await ctx.ate(0.45);
        await palco.mover(quem.locator(".pb-numeros li").first(), { ms: 600 });
        await ctx.ate(0.8);
        await palco.mover(quem.getByText(/Adicionar sócio ou gerente/), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Cliente continua com o robô de atendimento. E este é o número da loja, para onde você manda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quem = cartao(p, /Quem fala com o Bill/);
        await palco.mover(quem.getByText(/cliente continua com o robô/), { ms: 600 });
        await ctx.ate(0.5);
        const onde = cartao(p, /Para onde mandar/);
        await palco.destacar(onde, { folga: 6 });
        await palco.mover(onde.locator(".pb-numero-loja"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Lançar uma compra",
      fala: "Na aba Conversa, você fala com o Bill pelo painel. É a mesma conversa do WhatsApp, e vale de verdade.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.08);
        await palco.clicar(aba(p, /Conversa/), { ms: 600 });
        await caixaDeTexto(p).waitFor({ state: "visible", timeout: 10_000 });
        // deixa a caixa de texto à vista: a conversa rola a página sozinha a cada fala nova
        await palco.rolarAte(p.locator(".pb-conversa-caixa"), { bloco: "end" });
        const topo = p.locator(".pb-conversa-topo");
        await palco.destacar(topo, { folga: 4 });
        await palco.mover(topo, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em O que posso pedir, toque num exemplo: ele vai para a caixa de texto. Confira e envie.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const exemplo = p.locator(".pb-exemplos").getByRole("button", { name: "Comprei 10 Coca lata no Atacadão, paguei 45 no Pix" });
        await palco.mover(p.locator(".pb-exemplos h2"), { ms: 600 });
        await ctx.ate(0.3);
        await palco.clicar(exemplo, { ms: 600 });
        await ctx.ate(0.62);
        await palco.mover(caixaDeTexto(p), { ms: 600 });
        await ctx.ate(0.88);
        vigiarResposta(p);
        await palco.clicar(p.getByTitle("Enviar"), { ms: 500 });
      },
    },
    {
      fala: "Pelo WhatsApp é igual, e pode ser áudio ou foto da nota.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(p.locator(".pb-conversa-caixa"), { bloco: "end" });
        await ctx.ate(0.45);
        await palco.mover(p.locator('.pb-conversa-caixa button[title="Gravar áudio"], .pb-conversa-caixa button[title="Parar e enviar"]').first(), { ms: 600 });
        await ctx.ate(0.8);
        await palco.mover(p.getByTitle("Foto da nota ou do boleto"), { ms: 500 });
      },
    },
    {
      fala: "Ele responde o que lançou: 10 latas a mais no estoque e R$ 45 pagos no financeiro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await respostaDoBill(p);
        const balao = ultimoBalao(p);
        await palco.camera(balao, { zoomMax: 1.7, margem: 40 });
        await palco.destacar(balao, { folga: 4 });
        await palco.mover(balao, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Pausar o que acabou",
      fala: "Se a batata frita acabou, escreva: acabou a batata frita, pausa. E envie.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(p.locator(".pb-conversa-caixa"), { bloco: "end" });
        await ctx.ate(0.2);
        await palco.digitar(caixaDeTexto(p), "Acabou a batata frita, pausa");
        await ctx.ate(0.85);
        vigiarResposta(p);
        await palco.clicar(p.getByTitle("Enviar"), { ms: 500 });
      },
    },
    {
      fala: "Ele procura o item no seu cardápio e pausa na hora, sem você abrir outra tela.",
      acao: async (palco) => {
        const p = palco.pagina;
        await palco.mover(p.locator(".pb-conversa-caixa"), { ms: 900 });
      },
    },
    {
      fala: "A batata sai do site, do robô, do balcão e dos combos. No iFood, pause pelo app do iFood.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await respostaDoBill(p);
        const balao = ultimoBalao(p);
        await palco.camera(balao, { zoomMax: 1.7, margem: 40 });
        await palco.destacar(balao, { folga: 4 });
        await palco.mover(balao, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Visão geral",
      fala: "Na Visão geral está o que ele fez hoje, em 7 dias ou no mês, em reais.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await ctx.ate(0.05);
        await palco.clicar(aba(p, /Visão geral/), { ms: 600 });
        const kpis = p.locator(".pb-kpis");
        await p.locator(".pb-kpi").filter({ hasText: "R$ 45,00" }).waitFor({ state: "visible", timeout: 15_000 });
        await palco.mover(p.locator(".pb-pilulas"), { ms: 600 });
        await ctx.ate(0.5);
        await palco.destacar(kpis, { folga: 6 });
        await palco.mover(p.locator(".pb-kpi").filter({ hasText: "Compras" }), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Pausados pelo Bill fica o que segue fora do cardápio, com o botão Reativar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const pausados = cartao(p, "Pausados pelo Bill");
        await palco.rolarAte(pausados, { bloco: "center" });
        await palco.destacar(pausados, { folga: 6 });
        await palco.mover(pausados.getByText("Batata Frita").first(), { ms: 700 });
        await ctx.ate(0.65);
        await palco.mover(pausados.getByRole("button", { name: "Reativar" }), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Histórico e desfazer",
      fala: "No Histórico está tudo o que ele lançou, com busca e filtros.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await ctx.ate(0.05);
        await palco.clicar(aba(p, /Histórico/), { ms: 600 });
        const linhas = p.locator(".pb-dia .pb-linha");
        await linhas.nth(1).waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(p.locator(".pb-filtros"), { folga: 6 });
        await palco.mover(p.locator(".pb-busca"), { ms: 600 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.mover(linhas.first(), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Se lançou errado, o Desfazer vale para o lançamento mais novo, como o desfaz do WhatsApp. Desfazendo a pausa, a batata volta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const linha = p.locator(".pb-dia .pb-linha").first();
        const botao = linha.locator(".pb-desfazer");
        await palco.destacar(p.locator(".pb-regra"), { folga: 4 });
        await palco.mover(p.locator(".pb-regra"), { ms: 600 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(botao, { ms: 600 });
        await linha.getByText("Toque de novo").waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.72);
        await palco.clicar(botao, { ms: 300 });
        await p.locator(".pb-dia .pb-linha.desfeita").first().waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(p.locator(".pb-dia .pb-linha.desfeita").first(), { folga: 4 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Desligar o Bill",
      fala: "Para desligar, em Configuração, clique em Desligar o Bill e toque de novo. O mês seguinte não é cobrado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await ctx.ate(0.08);
        await palco.clicar(aba(p, /Configuração/), { ms: 600 });
        const desligar = p.getByRole("button", { name: "Desligar o Bill" });
        await desligar.waitFor({ state: "visible", timeout: 10_000 });
        await palco.rolarAte(desligar, { bloco: "center" });
        await ctx.ate(0.3);
        await palco.clicar(desligar, { ms: 600 });
        const confirmar = p.getByRole("button", { name: "Toque de novo para desligar" });
        await confirmar.waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.6);
        await palco.clicar(confirmar, { ms: 300 });
        await p.getByText("Você cuida da loja.").waitFor({ state: "visible", timeout: 20_000 });
        await palco.rolarPagina(0);
        await ctx.ate(1);
      },
    },
    {
      // Fechamento sem o "Tutoriais em vídeo": na build da gravação nenhum vídeo
      // está no disco (public/tutoriais), e o menu só mostra o botão quando há
      // vídeo (StoreSidebar, temTutoriais). Volta-se ao item do menu.
      fala: "Com o Bill, você resolve a loja pelo WhatsApp e confere tudo aqui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(menu(p), { bloco: "center" });
        await ctx.ate(0.4);
        await palco.camera(menu(p), { zoomMax: 1.7, margem: 80 });
        await palco.destacar(menu(p), { folga: 4 });
        await palco.mover(menu(p), { ms: 900 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
      pausa: 600,
    },
  ],
};

// Respiro de 300 ms entre as falas (o padrão é 450): o vídeo passava de 3 minutos.
roteiro.cenas = roteiro.cenas.map((c) => ({ pausa: 300, ...c }));

export default roteiro;
