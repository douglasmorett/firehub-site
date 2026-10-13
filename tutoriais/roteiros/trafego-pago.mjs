// Tutorial da tela Tráfego Pago (/store/meta-ads, TrafegoPagoClient).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// O que foi conferido no código antes de escrever (12/10/2026, master 1a3402a0):
// - menu: grupo "Cardápio & vendas", item "Tráfego pago" (lib/menu-do-painel.ts);
// - termos: R$ 50/semana de gestão; "ativou a campanha = a semana inteira é
//   cobrada"; acumula na fatura do mês seguinte; sem campanha ativa = R$ 0; o
//   investimento em mídia vai direto para a Meta, na conta do lojista;
// - "Configuração Acompanhada" abre o WhatsApp do FireHub; "Configurar Sozinho"
//   vai ao investimento (a partir de R$ 100, presets e régua até R$ 2.000);
// - sem conexão utilizável (token + conta de anúncios + Página) o Confirmar vai
//   para a tela de conexão; o OAuth volta em /store/meta-ads?connected=true&budget=…
//   (api/meta-ads/callback) e a tela abre direto no passo do anúncio;
// - na conexão o servidor usa ou CRIA o pixel da conta (garantirPixelDaConta) e
//   o cardápio instala; a tela mostra "Contagem de pedidos ligada";
// - "Quem vai ver": loja no centro (não arrasta), raio = maior faixa da área de
//   entrega, idade e gênero; público aberto é o recomendado;
// - foto: Do cardápio (fotos do cardápio com 400 px ou mais), Upload, Gerar com
//   IA (10 por semana); o texto vem sugerido e é editável; o link do anúncio é o
//   cardápio online da loja (slug obrigatório no servidor);
// - painel: Pausar não cobra; Retomar pede confirmação (window.confirm, que não
//   aparece no vídeo — por isso só é apontado) e lança a semana se ela não
//   estiver paga; saldo da conta de anúncios vem do /status (carteira).
//
// ── O FACEBOOK, NESTA GRAVAÇÃO ──────────────────────────────────────────────
// O ambiente não tem app da Meta nem conta de Facebook, de propósito. As rotas
// /api/meta-ads/* que CONVERSAM COM A META são respondidas no navegador
// (page.route), no formato exato das rotas reais, para uma conta de anúncios
// recém-conectada: Página e conta de anúncios presentes, pixel criado, saldo
// pré-pago de R$ 150 e NENHUM resultado — a campanha publicada nasce com
// gasto, impressões, cliques e pedidos em zero, como sai da Meta. Nenhum número
// de venda é mostrado. O clique em "Conectar com Facebook" volta direto com
// "connected=true", que é o que o callback real faz depois da autorização.
// As rotas que não falam com a Meta (texto sugerido e fotos do cardápio, cota
// de imagens da IA) rodam de verdade no servidor local.
import fs from "node:fs";
import path from "node:path";
import { dormir } from "../motor/palco.mjs";

const FOTOS = "C:/Users/Micro/tutoriais-teste/fotos-trafego";
const PIXEL = "1029384756102938";
const CONTA = "act_1029384756";
const INVESTIMENTO = 150;

const menu = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/meta-ads"]');
const PULSO = "#contact-widget-fab,.fcw-fab-pulse{animation:none !important}";

/** As respostas das rotas da Meta, para uma conta recém-conectada (formato de api/meta-ads/*). */
function simularMeta() {
  const s = { conectado: false, campanhas: [] };
  const json = (rota, corpo, status = 200) => rota.fulfill({ status, contentType: "application/json", body: JSON.stringify(corpo) });
  const status = () => (!s.conectado
    ? { conectado: false, pronto: false, proximoPasso: "conectar_facebook", mensagem: "Conecte sua conta do Facebook para começar a anunciar." }
    : {
        conectado: true, pixelId: PIXEL, adAccountId: CONTA, pronto: true,
        mensagem: "Tudo certo. Sua conta está pronta para veicular anúncios.", moeda: "BRL",
        carteira: { moeda: "BRL", saldoDisponivel: 150, aFaturar: 0, totalGasto: 0, tetoDaConta: null, limiteDiarioDaMeta: null, cobrancaAutomatica: false, formaDePagamento: null },
        linkParaRecarregar: `https://business.facebook.com/billing_hub/payment_settings?asset_id=${CONTA.slice(4)}`,
      });

  return async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const metodo = req.method();
    switch (url.pathname) {
      case "/api/meta-ads/auth": {
        // O que o callback real faz depois da autorização no Facebook.
        s.conectado = true;
        const valor = url.searchParams.get("investment");
        return rota.fulfill({ status: 302, headers: { location: `/store/meta-ads?connected=true${valor ? `&budget=${valor}` : ""}` } });
      }
      case "/api/meta-ads/status":
        return json(rota, status());
      case "/api/meta-ads/diagnostico":
        return json(rota, {
          conectado: true, contaSalvaHoje: CONTA, contaQueSeriaEscolhidaAgora: CONTA, precisaReconectar: false, paginaSalva: "1122334455",
          totalDeContas: 1,
          contas: [{ id: CONTA, nome: "Sabor da Praça", status: 1, significado: "Ativa", moeda: "BRL", temFormaDePagamento: true, apareceuEm: "me/adaccounts", ehAEscolhida: true, ehASalva: true }],
          errosDeConsulta: [],
        });
      case "/api/meta-ads/campaign": {
        if (metodo === "GET") {
          return json(rota, { campaigns: s.campanhas, connected: s.conectado, hasAdAccount: s.conectado, hasPage: s.conectado, metricasDesatualizadas: false });
        }
        const corpo = JSON.parse(req.postData() || "{}");
        if (metodo === "POST") {
          const agora = new Date().toISOString();
          const campanha = {
            id: "tutorial-campanha-1", franchiseeId: "tutorial", metaCampaignId: "120200000000000001",
            status: "ACTIVE", weeklyBudget: corpo.weeklyBudget, radiusKm: corpo.radiusKm, objective: "LINK_CLICKS",
            adCopy: corpo.adCopy, adImageUrl: corpo.adImageUrl,
            spend: 0, impressions: 0, clicks: 0, ordersGenerated: 0, revenue: 0,
            feeAccrued: 50, feePaid: 0, lastBilledAt: agora, createdAt: agora, updatedAt: agora,
          };
          s.campanhas = [campanha];
          return json(rota, { campaign: campanha });
        }
        if (metodo === "PUT") {
          const c = s.campanhas.find((x) => x.id === corpo.campaignId);
          if (c && corpo.action === "pause") c.status = "PAUSED";
          if (c && corpo.action === "resume") c.status = "ACTIVE";
          return json(rota, { success: true });
        }
        return rota.abort();
      }
      default:
        // Texto sugerido, fotos do cardápio e cota da IA: o servidor local responde de verdade.
        return rota.continue();
    }
  };
}

export default {
  id: "trafego-pago",
  titulo: "Tráfego Pago: anúncios no Facebook e Instagram",
  rota: "store/meta-ads",
  prontaQuando: "text=Ativar para meu restaurante",
  pronuncia: {
    "R$ 150": "cento e cinquenta reais",
    "R$ 100": "cem reais",
    "R$ 50": "cinquenta reais",
  },

  /**
   * A loja no mapa, com entrega até 5 km, e fotos nos produtos do cardápio.
   * As fotos são ilustrações geradas para a loja fictícia (nenhuma é de loja
   * real) e são copiadas para a pasta de uploads do painel local.
   */
  async preparar(prisma, { loja, produtos }) {
    await prisma.user.update({
      where: { id: loja.id },
      data: {
        storeLatLng: { lat: -16.6806, lng: -49.2563 },
        deliveryZoneType: "KM",
        deliveryZones: [{ km: 3, time: 30, fee: 5 }, { km: 5, time: 40, fee: 8 }],
      },
    });
    const destino = path.join(process.cwd(), "public", "uploads", "tutorial-trafego");
    fs.mkdirSync(destino, { recursive: true });
    const fotos = { "X-Bacon": "x-bacon", "X-Tudo": "x-tudo", "Pizza Calabresa": "pizza-calabresa", "Batata Frita": "batata-frita" };
    for (const [nome, arquivo] of Object.entries(fotos)) {
      fs.copyFileSync(path.join(FOTOS, `${arquivo}.jpg`), path.join(destino, `${arquivo}.jpg`));
      await prisma.menuProduct.update({ where: { id: produtos[nome].id }, data: { imageUrl: `/uploads/tutorial-trafego/${arquivo}.jpg` } });
    }
  },

  /**
   * - as rotas da Meta passam a ser respondidas (ver o cabeçalho) e a tela é
   *   recarregada, para nascer já sem o aviso "não configurado neste servidor"
   *   (o ambiente não tem META_APP_ID);
   * - o adiantamento (prefetch) das telas do menu é dispensado: no banco da
   *   gravação ele trava a tela por segundos;
   * - o pulso do botão de ajuda para (a regra volta a cada carga de página).
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.route((url) => url.pathname.startsWith("/api/meta-ads/"), simularMeta());
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await p.addInitScript((css) => {
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent = css;
        document.head.appendChild(s);
      });
    }, PULSO);
    await p.reload({ waitUntil: "load" });
    await p.getByRole("button", { name: /Ativar para meu restaurante/ }).waitFor({ state: "visible", timeout: 60_000 });
    await dormir(2500);
  },

  cenas: [
    {
      capitulo: "O que é o Tráfego Pago",
      fala: "O Tráfego Pago fica no menu, em Cardápio e vendas. Ele cria anúncios da sua loja no Facebook e no Instagram, para quem está na sua área de entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(400);
        await palco.destacar(menu(p), { folga: 4 });
        await palco.mover(menu(p), { ms: 900 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.mover(p.getByText("Facebook e Instagram", { exact: true }), { ms: 800 });
        await ctx.ate(0.8);
        await palco.mover(p.getByText("Só quem você entrega", { exact: true }), { ms: 600 });
      },
    },
    {
      fala: "Quem clica no anúncio cai direto no cardápio online da sua loja e faz o pedido por lá.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartoes = p.getByText("Onde aparece", { exact: true }).locator("xpath=../..");
        await palco.destacar(cartoes, { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os termos e a cobrança",
      fala: "Clique em Ativar para meu restaurante. Antes de tudo, a tela mostra os termos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(p.getByRole("button", { name: /Ativar para meu restaurante/ }), { ms: 700 });
        await p.getByRole("heading", { name: "Termos do Tráfego Pago" }).waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      fala: "A gestão do FireHub custa R$ 50 por semana, só nas semanas com campanha ativa. Ativou, a semana é cobrada, mesmo que você pause no dia seguinte.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: "1. Taxa de Gestão" });
        const taxa = titulo.locator("xpath=following-sibling::p[1]");
        await palco.camera(p.locator("[data-fim-dos-termos]").locator("xpath=.."), { zoomMax: 1.35, margem: 20 });
        await palco.esperarRolagemParar(taxa);
        await palco.destacar([titulo, taxa], { folga: 6 });
        await palco.mover(taxa.getByText("R$ 50,00/semana"), { ms: 700 });
        await ctx.ate(0.5);
        const ativou = p.getByText(/Ativou a campanha = a semana inteira é cobrada/);
        await palco.destacar(ativou, { folga: 4 });
        await palco.mover(ativou, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Essa taxa entra na fatura do mês seguinte. Já o dinheiro do anúncio, o Facebook cobra direto na sua conta de anúncios.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const fatura = p.getByText(/incluída na fatura do mês seguinte/).locator("xpath=..");
        await palco.rolarAte(p.getByRole("heading", { name: "3. Investimento em Mídia" }), { bloco: "center" });
        await palco.destacar(fatura, { folga: 4 });
        await palco.mover(fatura, { ms: 600 });
        await ctx.ate(0.45);
        const midia = p.getByText(/direto para a Meta/).locator("xpath=..");
        await palco.destacar(midia, { folga: 4 });
        await palco.mover(midia, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Role até o fim, marque a caixa e clique em Continuar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(p.locator("[data-fim-dos-termos]"), { bloco: "end" });
        await palco.cameraAberta({ ms: 500 });
        await palco.rolarAte(p.getByRole("checkbox"), { bloco: "center" });
        await palco.clicar(p.getByRole("checkbox"), { ms: 600 });
        const continuar = p.getByRole("button", { name: /Aceito os termos/ });
        await continuar.waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.8);
        await palco.clicar(continuar, { ms: 500 });
        await p.getByRole("heading", { name: "Como deseja configurar?" }).waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      capitulo: "Acompanhada ou sozinho",
      fala: "Na Configuração Acompanhada, um especialista do FireHub configura com você pelo WhatsApp. Neste vídeo, vamos em Configurar Sozinho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const acompanhada = p.getByRole("button", { name: /Configuração Acompanhada/ });
        await palco.destacar(acompanhada, { folga: 4 });
        await palco.mover(acompanhada, { ms: 700 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(p.getByRole("button", { name: /Configurar Sozinho/ }), { ms: 600 });
        await p.getByRole("heading", { name: "Investimento semanal" }).waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      capitulo: "Investimento semanal",
      fala: "Escolha quanto investir por semana em anúncios, a partir de R$ 100. Vamos de R$ 150.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(p.getByRole("slider"), { ms: 700 });
        await ctx.ate(0.6);
        await palco.clicar(p.getByRole("button", { name: /^R\$150/ }), { ms: 600 });
      },
    },
    {
      fala: "A tela lembra da taxa de gestão. Clique em Confirmar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const taxa = p.getByText(/Taxa de gestão:/).locator("xpath=..");
        const confirmar = p.getByRole("button", { name: /Confirmar R\$ 150\/semana/ });
        await palco.rolarAte(confirmar, { bloco: "end" });
        await palco.destacar(taxa, { folga: 4 });
        await palco.mover(taxa, { ms: 600 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.clicar(confirmar, { ms: 500 });
        await p.getByRole("heading", { name: "Conectar Facebook" }).waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      capitulo: "Conectar o Facebook",
      fala: "Para anunciar, a loja precisa de uma Página no Facebook e de uma conta de anúncios. Clique em Conectar com Facebook.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const pergunta = p.getByText("Preciso ter uma página no Facebook?").locator("xpath=..");
        await palco.rolarAte(pergunta, { bloco: "center" });
        await palco.destacar(pergunta, { folga: 6 });
        await palco.mover(pergunta, { ms: 700 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.rolarAte(p.getByRole("button", { name: /Conectar com Facebook/ }), { bloco: "center" });
        await palco.clicar(p.getByRole("button", { name: /Conectar com Facebook/ }), { ms: 500 });
        await p.getByRole("heading", { name: "Configure seu anúncio" }).waitFor({ state: "visible", timeout: 60_000 });
      },
    },
    {
      fala: "O Facebook pede para você entrar e autorizar o FireHub. Na volta, a tela avisa que o Facebook está conectado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.getByText(/Facebook conectado!/);
        await aviso.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.5);
        await palco.destacar(aviso.locator("xpath=.."), { folga: 4 });
        await palco.mover(aviso, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Quem vê o anúncio",
      fala: "No quadro Quem vai ver o anúncio, o mapa já abre com a sua loja no centro. O círculo vermelho tem o tamanho da sua área de entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const mapa = p.locator(".leaflet-container");
        await p.locator(".leaflet-tile-loaded").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
        await palco.rolarAte(mapa, { bloco: "center" });
        await palco.camera(mapa, { zoomMax: 1.4, margem: 30 });
        await ctx.ate(0.5);
        await palco.mover(mapa, { ms: 700 });
        await ctx.ate(0.8);
        const raio = p.getByRole("button", { name: /Minha área de entrega/ });
        await palco.rolarAte(raio, { bloco: "center" });
        await palco.destacar(raio, { folga: 4 });
        await palco.mover(raio, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      fala: "Dá para mudar o raio, a idade e o gênero. Na dúvida, deixe tudo aberto: o Facebook aprende sozinho quem mais pede.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(p.getByRole("slider", { name: /Raio do anúncio/ }), { ms: 600 });
        await ctx.ate(0.2);
        const idade = p.getByRole("button", { name: /Todas as idades/ }).locator("xpath=..");
        await palco.rolarAte(idade, { bloco: "center" });
        await palco.mover(p.getByRole("button", { name: /Todas as idades/ }), { ms: 500 });
        await ctx.ate(0.4);
        await palco.mover(p.getByRole("button", { name: "Todos", exact: true }), { ms: 500 });
        await ctx.ate(0.6);
        const recomendado = p.getByText(/Recomendado: com o público aberto/);
        await palco.destacar(recomendado, { folga: 6 });
        await palco.mover(recomendado, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Contagem de pedidos",
      fala: "Este quadro verde é a contagem de pedidos. O FireHub instala o pixel do Facebook no seu cardápio, e os pedidos de quem veio do anúncio são contados aqui no painel.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quadro = p.getByText(/Contagem de pedidos ligada/).locator("xpath=..");
        await palco.rolarAte(quadro, { bloco: "center" });
        await palco.destacar(quadro, { folga: 6 });
        await palco.mover(p.getByText(/Contagem de pedidos ligada/), { ms: 700 });
        await ctx.ate(0.6);
        await palco.mover(p.getByText(/são contados aqui no painel/), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A foto do anúncio",
      fala: "Agora a foto. Na aba Do cardápio, clique na foto de um produto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const foto = p.locator('img[alt="X-Bacon"]').locator("xpath=..");
        await foto.waitFor({ state: "visible", timeout: 20_000 });
        await palco.rolarAte(p.getByText("Imagem do anúncio"), { bloco: "start" });
        await palco.mover(p.getByRole("button", { name: /Do cardápio/ }), { ms: 600 });
        await ctx.ate(0.6);
        await palco.clicar(foto, { ms: 600 });
      },
    },
    {
      fala: "Também dá para enviar uma foto do celular em Upload, ou criar uma em Gerar com IA, com 10 imagens por semana.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const abas = p.getByRole("button", { name: /Do cardápio/ }).locator("xpath=..");
        await ctx.ate(0.15);
        await palco.clicar(abas.getByRole("button", { name: /Upload/ }), { ms: 600 });
        await ctx.ate(0.45);
        await palco.clicar(abas.getByRole("button", { name: /Gerar com IA/ }), { ms: 500 });
        const cota = p.getByText(/10 (de 10 imagens restantes|imagens por semana)/);
        await cota.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.7);
        await palco.destacar(cota, { folga: 6 });
        await palco.mover(cota, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.clicar(abas.getByRole("button", { name: /Do cardápio/ }), { ms: 500 });
      },
    },
    {
      fala: "O texto do anúncio já vem sugerido. Mude à vontade e confira na prévia como ele vai aparecer.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const texto = p.getByText("Texto principal").locator("xpath=..");
        await palco.rolarAte(texto, { bloco: "center" });
        await palco.destacar(texto, { folga: 6 });
        await palco.mover(texto.locator("textarea"), { ms: 600 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        const previa = p.getByText("Preview do anúncio").locator("xpath=..");
        await palco.rolarAte(previa, { bloco: "center" });
        await palco.mover(previa.getByRole("button", { name: "Pedir agora" }), { ms: 600 });
      },
    },
    {
      capitulo: "Resumo e publicar",
      fala: "No resumo estão quem vai ver, o investimento, a taxa de gestão e o total da semana. Clique em Publicar campanha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const resumo = p.getByText("👥 Quem vai ver:").locator("xpath=../..");
        const publicar = p.getByRole("button", { name: /Publicar campanha/ });
        await palco.rolarAte(publicar, { bloco: "end" });
        await palco.camera([resumo, publicar], { zoomMax: 1.4, margem: 24 });
        await palco.destacar(resumo, { folga: 6 });
        await palco.mover(p.getByText("👥 Quem vai ver:"), { ms: 600 });
        await ctx.ate(0.3);
        await palco.mover(p.getByText("💰 Investimento semanal:"), { ms: 400 });
        await ctx.ate(0.45);
        await palco.mover(p.getByText("🔧 Taxa de gestão FireHub:"), { ms: 400 });
        await ctx.ate(0.6);
        await palco.mover(p.getByText("Total semanal:"), { ms: 400 });
        await ctx.ate(0.75);
        await palco.apagarDestaque();
        await palco.clicar(publicar, { ms: 500 });
        await p.getByRole("heading", { name: "Suas campanhas" }).waitFor({ state: "visible", timeout: 20_000 });
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "O painel da campanha",
      fala: "Pronto: a campanha está ativa. Os números começam em zero e vão aparecendo conforme o Facebook mostra o anúncio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const ativo = p.getByText("✅ Ativo");
        await ativo.waitFor({ state: "visible", timeout: 10_000 });
        await palco.mover(p.getByText(/campanha\(s\) ativa\(s\)/), { ms: 700 });
        await ctx.ate(0.4);
        const kpis = p.getByText("Total investido", { exact: true }).locator("xpath=../../..");
        await palco.destacar(kpis, { folga: 6 });
        await palco.mover(p.getByText("Pedidos gerados", { exact: true }), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Aqui fica o saldo da sua conta de anúncios. Quando o crédito acaba, o anúncio para. Com um cartão cadastrado, o Facebook cobra sozinho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const saldo = p.getByText("Crédito na sua conta do Facebook").locator("xpath=../../..");
        await palco.rolarAte(saldo, { bloco: "center" });
        await palco.destacar(saldo, { folga: 6 });
        await palco.mover(p.getByText(/^R\$ 150,00$/), { ms: 700 });
        await ctx.ate(0.6);
        await palco.mover(p.getByText(/Você está no modo pré-pago/), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Pedidos, no cartão da campanha, aparecem os pedidos que vieram do anúncio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = p.getByText(/^Criada em/).locator("xpath=../../../..");
        await palco.rolarAte(cartao, { bloco: "center" });
        const rotulo = cartao.getByText("Pedidos", { exact: true });
        const pedidos = rotulo.locator("xpath=..");
        await palco.camera(cartao, { zoomMax: 1.5, margem: 24 });
        await ctx.ate(0.3);
        await palco.destacar(pedidos, { folga: 4 });
        await palco.mover(rotulo, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para parar, clique em Pausar. Para voltar, o Retomar pede confirmação, porque lança a semana de gestão na fatura se ela ainda não foi paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(p.getByRole("button", { name: /Pausar/ }), { ms: 600 });
        const retomar = p.getByRole("button", { name: /Retomar/ });
        await retomar.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.45);
        // Só apontado: o Retomar abre uma pergunta do navegador, que não aparece no vídeo.
        await palco.destacar(retomar, { folga: 6 });
        await palco.mover(retomar, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Para rever este vídeo, é só clicar em Tutoriais em vídeo, aqui no menu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: "Tutoriais em vídeo" });
        await ctx.ate(0.12);
        await palco.camera(botao, { zoomMax: 1.7, margem: 80 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 900 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
      pausa: 600,
    },
  ],
};
