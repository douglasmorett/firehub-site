// Tutorial: conectar a Keeta (/store/integracoes, cartão "Keeta").
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// A Keeta é serviço de fora e o ambiente de gravação não tem a chave dela, de
// propósito. Sem a chave, a tela pergunta ao servidor (GET
// /api/store/integracoes/keeta) e ouve "disponivel: false": o cartão mostra
// "Em liberação" e o botão de conectar fica apagado — o que nenhum lojista vê
// em produção. Por isso SÓ essa consulta de leitura é respondida aqui, no
// formato exato da rota (src/app/api/store/integracoes/keeta/route.ts):
//   1. primeiro, a loja que ainda não conectou;
//   2. depois, a loja conectada (nome "Sabor da Praça", ID fictício, aberta no
//      app da Keeta) — mostrada pelo mesmo caminho da vida real: a Keeta devolve
//      o lojista para /store/integracoes?integracao=keeta&keeta=ok, e a janela
//      abre sozinha.
// Qualquer outro método (conectar, pausar, enviar cardápio, desconectar) é
// abortado no navegador e NUNCA chega ao servidor. Os botões "Conectar com a
// Keeta", "Pausar na Keeta", "Enviar horário do FireHub", "Enviar cardápio
// para a Keeta" e "Enviar telefone e e-mail" são apontados, nunca clicados.
import { dormir, BASE } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

/** O cartão da Keeta (o título mora dois níveis abaixo do cartão). */
const cartao = (p) => p.locator("h3", { hasText: /^Keeta$/ }).first().locator("xpath=../..");
/** O selo de situação, no canto do cartão. */
const selo = (p) => cartao(p).locator("span").first();
/** A janela da Keeta aberta (a caixa branca inteira). */
const janela = (p) => p.locator("h2", { hasText: /^Keeta$/ }).first().locator("xpath=../../../..");

/** O que a tela ouve do servidor: muda no meio do vídeo, quando a loja "volta conectada". */
let conectada = false;
const respostaDaKeeta = () =>
  conectada
    ? {
        disponivel: true,
        conectada: true,
        loja: { nome: LOJA.nome, keetaMerchantId: "158402736", ativa: true },
        naKeeta: {
          status: "AVAILABLE",
          horario: [{ dayOfWeek: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"], timePeriods: { startTime: "18:00", endTime: "23:30" } }],
        },
      }
    : { disponivel: true, conectada: false, loja: null };

/** O aviso do Assistente de Impressão (o desta máquina é de outra loja; ver balanca.mjs). */
function esconderAvisoDoAssistente() {
  const varrer = () => {
    for (const el of document.querySelectorAll('[role="status"]')) {
      if ((el.textContent || "").includes("Assistente de Impressão")) el.style.setProperty("display", "none", "important");
    }
  };
  varrer();
  setInterval(varrer, 120);
}

/**
 * Some a faixa "Esta tela tem vídeos", a pulsação do chat e o aviso do
 * Assistente, nesta página e na que abrir depois (a volta da Keeta recarrega).
 */
async function assentar(p) {
  const css = ".fh-tutorial-faixa{display:none!important}.fcw-fab-pulse{animation:none!important}";
  await p.addInitScript((regra) => {
    const pôr = () => { const s = document.createElement("style"); s.textContent = regra; document.head.appendChild(s); };
    if (document.head) pôr(); else document.addEventListener("DOMContentLoaded", pôr);
  }, css);
  await p.addInitScript(esconderAvisoDoAssistente);
  await p.addStyleTag({ content: css });
}

export default {
  id: "integracao-keeta",
  titulo: "Integração: conectar a Keeta",
  rota: "store/integracoes",
  prontaQuando: "text=Conecte Seus Canais",
  // Só para a VOZ (a legenda fica "Keeta", como na tela): o nome soa "Kíta".
  pronuncia: { Keeta: "Kíta" },

  async antesDeGravar(palco) {
    const p = palco.pagina;
    conectada = false;
    await p.route((url) => url.pathname === "/api/store/integracoes/keeta", (rota) => {
      if (rota.request().method() !== "GET") return rota.abort();
      return rota.fulfill({ contentType: "application/json", body: JSON.stringify(respostaDaKeeta()) });
    });
    await assentar(p);
    await p.reload({ waitUntil: "load" });
    await p.getByText("Conecte Seus Canais").first().waitFor({ state: "visible", timeout: 60_000 });
    await selo(p).filter({ hasText: "Não Conectado" }).waitFor({ state: "visible", timeout: 30_000 });
    await dormir(2000);
  },

  cenas: [
    {
      capitulo: "Onde fica",
      fala: "Para receber os pedidos da Keeta no FireHub, entre em Integrações e clique em Canais de Venda e Delivery.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(600);
        await palco.mover(p.locator("h1", { hasText: "Conecte Seus Canais" }), { ms: 800 });
        await ctx.ate(0.55);
        await palco.clicar(p.getByRole("button", { name: /Canais de Venda/ }), { ms: 600 });
        await dormir(300);
        await palco.rolarAte(cartao(p), { bloco: "center" });
        await palco.mover(p.locator("h3", { hasText: /^Keeta$/ }).first(), { ms: 500 });
      },
    },
    {
      fala: "O selo no cartão da Keeta mostra a situação: por enquanto, Não Conectado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(cartao(p), { zoomMax: 1.6, margem: 40 });
        await ctx.ate(0.45);
        await palco.destacar(selo(p), { folga: 6 });
        await palco.mover(selo(p), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 450 });
      },
    },
    {
      capitulo: "Como conectar",
      fala: "Clique no cartão. A janela mostra que a loja ainda não está conectada e o passo a passo, que leva menos de um minuto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.08);
        await palco.clicar(p.locator("h3", { hasText: /^Keeta$/ }).first(), { ms: 450 });
        const status = p.getByText("⚪ Loja ainda não conectada").locator("xpath=..");
        await status.waitFor({ state: "visible", timeout: 10_000 });
        await dormir(250);
        await palco.camera(janela(p), { zoomMax: 1.3, margem: 22 });
        await ctx.ate(0.3);
        await palco.destacar(status, { folga: 4 });
        await palco.mover(p.getByText("⚪ Loja ainda não conectada"), { ms: 450 });
        await ctx.ate(0.65);
        const passos = p.getByText("Como conectar (leva menos de um minuto)").locator("xpath=..");
        await palco.destacar(passos, { folga: 4 });
        await palco.mover(p.getByText("Como conectar (leva menos de um minuto)"), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "O botão Conectar com a Keeta abre o site da Keeta. Entre com a mesma conta onde você vê os pedidos, a conta principal da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // Só apontado: o clique abriria o site da Keeta, e o ambiente não tem a chave.
        const conectar = p.getByRole("button", { name: /Conectar com a Keeta/ });
        const passos = p.getByText("Como conectar (leva menos de um minuto)").locator("xpath=..");
        await ctx.ate(0.05);
        await palco.destacar(conectar, { folga: 6 });
        await palco.mover(conectar, { ms: 600 });
        await ctx.ate(0.45);
        await palco.destacar(passos.locator("li").nth(1), { folga: 4 });
        await palco.mover(passos.locator("li").nth(1).locator("b"), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Marque a sua loja e confirme. A Keeta traz você de volta já conectado, sem código nem senha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const passos = p.getByText("Como conectar (leva menos de um minuto)").locator("xpath=..");
        await palco.destacar(passos.locator("li").nth(1), { folga: 4 });
        await ctx.ate(0.3);
        await palco.destacar(passos.locator("li").nth(2), { folga: 4 });
        await palco.mover(passos.locator("li").nth(2), { ms: 450 });
        await ctx.ate(0.7);
        const semCodigo = p.getByText(/Você não precisa de código/);
        await palco.destacar(semCodigo, { folga: 4 });
        await palco.mover(semCodigo, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Atenção: conecte sempre pelo painel desta loja. A conexão vale para a loja que está aberta aqui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.getByText(/Conecte pelo painel/);
        await palco.camera(aviso, { zoomMax: 1.8, margem: 60 });
        await palco.destacar(aviso, { folga: 6 });
        await palco.mover(aviso, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Depois de conectada",
      fala: "Na volta, esta janela abre sozinha com o nome da loja conectada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // O caminho da vida real: a Keeta devolve o lojista para esta rota, e a janela abre sozinha.
        conectada = true;
        await palco.cameraAberta({ ms: 300 });
        await p.goto(`${BASE}/store/integracoes?integracao=keeta&keeta=ok`, { waitUntil: "load" });
        const nome = p.getByText(`${LOJA.nome} — conectada na Keeta`);
        await nome.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
        await palco.camera(janela(p), { zoomMax: 1.3, margem: 22 });
        await ctx.ate(0.6);
        await palco.destacar(nome.locator("xpath=.."), { folga: 4 });
        await palco.mover(nome, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A loja no app da Keeta",
      fala: "Logo abaixo, você vê se a loja está aberta no app da Keeta. O horário e a pausa do FireHub não mudam a Keeta sozinhos: para isso, use estes botões.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = p.getByText(/Sua loja no app da Keeta/).locator("xpath=..");
        await palco.rolarAte(bloco, { bloco: "center" });
        await palco.destacar(bloco, { folga: 4 });
        await palco.mover(p.getByText(/Sua loja no app da Keeta/), { ms: 500 });
        await ctx.ate(0.35);
        await palco.mover(p.getByText(/O horário e a pausa da LOJA/), { ms: 500 });
        // Só apontados: cada botão chamaria a Keeta.
        await ctx.ate(0.8);
        const pausar = p.getByRole("button", { name: "Pausar na Keeta" });
        await palco.destacar(pausar, { folga: 6 });
        await palco.mover(pausar, { ms: 400 });
        await ctx.ate(0.9);
        const horario = p.getByRole("button", { name: "Enviar horário do FireHub" });
        await palco.destacar(horario, { folga: 6 });
        await palco.mover(horario, { ms: 400 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "O cardápio é o do FireHub: este botão envia, e depois cada produto que você salva ou pausa aqui muda lá sozinho. O último envia o telefone e o e-mail.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cardapio = p.getByRole("button", { name: "Enviar cardápio para a Keeta" });
        const contato = p.getByRole("button", { name: "Enviar telefone e e-mail" });
        await ctx.ate(0.12);
        await palco.destacar(cardapio, { folga: 6 });
        await palco.mover(cardapio, { ms: 500 });
        await ctx.ate(0.45);
        await palco.destacar(p.getByText(/O horário e a pausa da LOJA/), { folga: 4 });
        await ctx.ate(0.8);
        await palco.destacar(contato, { folga: 6 });
        await palco.mover(contato, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Feche a janela. No cartão, o selo agora está verde: Conectado e Ativo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Fechar", exact: true }), { ms: 400 });
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(cartao(p), { bloco: "center" });
        await palco.camera(cartao(p), { zoomMax: 1.6, margem: 40 });
        await ctx.ate(0.55);
        await palco.destacar(selo(p), { folga: 6 });
        await palco.mover(selo(p), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 450 });
      },
    },
    {
      capitulo: "Antes dos primeiros pedidos",
      fala: "Depois de conectar, a Keeta faz um teste rápido de pedido com a loja antes de liberar os pedidos de verdade, e o suporte do FireHub acompanha com você.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.2);
        await palco.mover(p.locator("h3", { hasText: /^Keeta$/ }).first(), { ms: 700 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.4);
        if (await botao.count()) {
          await palco.destacar(botao.first(), { folga: 6 });
          await palco.mover(botao.first(), { ms: 700 });
        }
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
