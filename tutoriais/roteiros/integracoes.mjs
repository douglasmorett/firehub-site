// Tutorial da tela de Integrações (/store/integracoes).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// Esta é uma tela de CONEXÃO com serviço de fora, e o ambiente de gravação não
// tem chave de nenhum aplicativo, de propósito. Por isso o vídeo mostra ONDE
// cada coisa fica e o passo a passo, e PARA antes do clique que chama o iFood,
// o 99Food ou o JotaJá: os botões "1. Conectar e Autorizar no Portal iFood",
// "Concluir Vinculação", "Conectar com o 99Food" e "Salvar e Ativar JotaJá" são
// apontados e destacados, nunca clicados.
import { dormir } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

/** O cartão de uma integração (o título mora dois níveis abaixo do cartão). */
const cartao = (p, titulo) => p.locator("h3", { hasText: titulo }).first().locator("xpath=../..");
/** O selo de situação, no canto do cartão ("Não Conectado", "1 Integração(ões)"). */
const selo = (p, titulo) => cartao(p, titulo).locator("span").first();
/** A janela aberta de uma integração (a caixa branca inteira). */
const janela = (p) => p.locator("h2").first().locator("xpath=../../../..");
/** O título da janela aberta: prova de que ela abriu. */
const tituloDaJanela = (p, texto) => p.locator("h2", { hasText: texto }).first();
/** O cartão de um pedido no quadro de Pedidos. */
const pedido = (p, n) => p.locator("[draggable]").filter({ hasText: `#${n} — ` }).first();

export default {
  id: "integracoes",
  titulo: "Integrações: conectar iFood e 99Food",
  rota: "store/integracoes",
  prontaQuando: "text=Conecte Seus Canais",
  // Só para a VOZ (a legenda fica como está na tela). A conferência da voz transcreve
  // "99 Food" em duas palavras; escrito assim, a fala confere com o que foi dito.
  // "JotaJá" numa palavra só a voz encurta (soa "jajá"); em duas ela diz "jota já".
  pronuncia: { "99Food": "99 Food", "JotaJá": "Jota Já" },

  /**
   * Duas coisas antes de gravar.
   *
   * 1. O estado do 99Food. A tela pergunta ao servidor (GET /api/99food/conectar)
   *    se a loja está conectada. O ambiente de gravação não tem a chave do
   *    99Food, e sem ela o servidor responde "integração não habilitada no
   *    servidor (faltam FOOD99_APP_ID…)" — um aviso que nenhum lojista vê em
   *    produção e que desliga o botão de conectar. Aqui SÓ essa consulta de
   *    leitura é respondida com o que o servidor de produção devolve para a
   *    loja que ainda não conectou (o objeto `semVinculo` da rota). Nada é
   *    enviado ao 99Food, e o botão de conectar não é clicado.
   *
   * 2. O botão redondo do chat de suporte pulsa sem parar e faz a captura
   *    pintar quadros à toa: só a pulsação é parada.
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.route((url) => url.pathname === "/api/99food/conectar", (rota) => {
      if (rota.request().method() !== "GET") return rota.abort();
      return rota.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          conectado: false,
          disponivel: true,
          mensagem: "Loja ainda não autorizada. Clique em conectar para autorizar no 99Food.",
          candidatos: [],
        }),
      });
    });
    await p.reload({ waitUntil: "load" });
    await p.getByText("Conecte Seus Canais").first().waitFor({ state: "visible", timeout: 60_000 });
    await p.addStyleTag({ content: ".fcw-fab-pulse{animation:none !important}" });
    await dormir(2500);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Integrações. É aqui que você liga o FireHub ao iFood, ao 99Food e a outros aplicativos, para os pedidos caírem direto no seu painel. As ferramentas de marketing e o pagamento online também ficam aqui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(800);
        await palco.mover(p.locator("h1", { hasText: "Conecte Seus Canais" }), { ms: 900 });
        await ctx.ate(0.45);
        await palco.mover(p.getByRole("button", { name: /Canais de Venda/ }), { ms: 700 });
        await ctx.ate(0.74);
        await palco.mover(p.getByRole("button", { name: /Marketing & Tráfego/ }), { ms: 600 });
        await ctx.ate(0.87);
        await palco.mover(p.getByRole("button", { name: /Pagamentos & PIX/ }), { ms: 600 });
      },
    },
    {
      capitulo: "Os aplicativos de pedido",
      fala: "Clique em Canais de Venda e Delivery para ver só os aplicativos de pedido. Hoje são cinco, cada um no seu cartão, e entre eles estão o iFood e o 99Food.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.08);
        await palco.clicar(p.getByRole("button", { name: /Canais de Venda/ }), { ms: 300 });
        await palco.rolarPagina(175);
        const nomes = ["JotaJá (Open Delivery)", "iFood Merchant API", "99Food Delivery", "Brendi", "Wabiz"];
        for (const [i, nome] of nomes.entries()) {
          await ctx.ate(0.5 + i * 0.1);
          await palco.mover(p.locator("h3", { hasText: nome }).first(), { ms: 380 });
        }
      },
    },
    {
      fala: "O selo no canto de cada cartão mostra a situação: Não Conectado, ou verde quando a integração está ativa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([cartao(p, "JotaJá (Open Delivery)"), cartao(p, "99Food Delivery")], { zoomMax: 1.3, margem: 18 });
        for (const [i, nome] of ["JotaJá (Open Delivery)", "iFood Merchant API", "99Food Delivery"].entries()) {
          await ctx.ate(0.12 + i * 0.25);
          await palco.destacar(selo(p, nome), { folga: 6 });
          await palco.mover(selo(p, nome), { ms: 350 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Conectar o iFood",
      fala: "Para conectar o iFood, clique no cartão dele. A conexão é feita em dois passos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.2);
        await palco.clicar(p.locator("h3", { hasText: "iFood Merchant API" }).first(), { ms: 450 });
        await tituloDaJanela(p, "Integrações iFood").waitFor({ state: "visible", timeout: 8000 });
        await p.getByText("Nenhuma integração iFood cadastrada ainda.").waitFor({ state: "visible", timeout: 8000 });
        await dormir(250);
        await palco.camera(janela(p), { zoomMax: 1.3, margem: 22 });
      },
    },
    {
      fala: "No passo um, clique em Conectar e Autorizar no Portal iFood. O portal abre em outra aba, já com o código preenchido: entre com a sua conta do iFood e autorize o FireHub. O iFood dá dez minutos para isso.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // Só apontado: o clique pediria o código ao iFood, e o ambiente não tem a chave.
        const passoUm = p.getByRole("button", { name: /1\. Conectar e Autorizar no Portal iFood/ });
        await palco.destacar(passoUm, { folga: 6 });
        await palco.mover(passoUm, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Depois de autorizar, o iFood mostra um código de autorização. Copie esse código, cole neste campo do passo dois e clique em Concluir Vinculação.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const campo = p.getByPlaceholder(/TMFG-KNLN/);
        const concluir = p.getByRole("button", { name: /Concluir Vinculação/ });
        const passoDois = p.getByText(/2\. Cole o Código de Autorização/).locator("xpath=..");
        await palco.destacar(passoDois, { folga: 4 });
        await ctx.ate(0.45);
        await palco.mover(campo, { ms: 500 });
        await ctx.ate(0.8);
        await palco.mover(concluir, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A primeira loja do iFood já está incluída no seu plano. Cada loja a mais custa cinquenta reais por mês.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.getByText(/Cada integração adicional custa/).first();
        await palco.destacar(aviso, { folga: 4 });
        await palco.mover(aviso, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Conectar o 99Food",
      fala: "No 99Food não tem código. Abra o cartão dele, clique em Conectar com o 99Food e autorize o FireHub na mesma conta em que você vê os pedidos. Esta tela percebe sozinha e fica verde.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Fechar", exact: true }), { ms: 350 });
        await palco.cameraAberta({ ms: 450 });
        await palco.clicar(p.locator("h3", { hasText: "99Food Delivery" }).first(), { ms: 450 });
        await tituloDaJanela(p, "99Food Delivery").waitFor({ state: "visible", timeout: 8000 });
        await p.getByText(/Como conectar/).waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(janela(p), { zoomMax: 1.3, margem: 22 });
        const passos = p.getByText(/Como conectar/).locator("xpath=..");
        // Só apontado: o clique abriria a autorização no site do 99Food.
        const conectar = p.getByRole("button", { name: /Conectar com o 99Food/ });
        await ctx.ate(0.4);
        await palco.destacar(conectar, { folga: 6 });
        await palco.mover(conectar, { ms: 500 });
        await ctx.ate(0.62);
        await palco.destacar(passos, { folga: 4 });
        await palco.mover(p.getByText(/Esta tela detecta sozinha/), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "JotaJá, Brendi e Wabiz",
      fala: "Os outros três aplicativos, que são o JotaJá, a Brendi e a Wabiz, entram com as credenciais do próprio aplicativo. A janela de cada um diz onde pegar esses dados: você cola nos campos e salva.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Fechar", exact: true }), { ms: 350 });
        await palco.cameraAberta({ ms: 450 });
        await palco.clicar(p.locator("h3", { hasText: "JotaJá (Open Delivery)" }).first(), { ms: 450 });
        await tituloDaJanela(p, "JotaJá (Open Delivery)").waitFor({ state: "visible", timeout: 8000 });
        await dormir(200);
        await palco.camera(janela(p), { zoomMax: 1.35, margem: 22 });
        await ctx.ate(0.45);
        const onde = p.getByText(/Insira abaixo as credenciais/);
        await palco.destacar(onde, { folga: 6 });
        await palco.mover(onde, { ms: 450 });
        await ctx.ate(0.75);
        await palco.destacar([p.getByPlaceholder(/Client ID que o JotaJá/), p.getByPlaceholder("Ex: 22238")], { folga: 8 });
        await palco.mover(p.getByPlaceholder(/Client ID que o JotaJá/), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os pedidos do aplicativo",
      fala: "Com a integração ativa, o pedido do aplicativo entra sozinho na tela de Pedidos, junto com os outros.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Cancelar", exact: true }), { ms: 250 });
        await palco.cameraAberta({ ms: 300 });
        await palco.clicar(p.locator('a[href="/store/pedidos-clientes"]').first(), { ms: 350 });
        await p.locator('[data-droppable="col-finalizado"] [draggable]').first().waitFor({ state: "visible", timeout: 30_000 });
        await pedido(p, 4).waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(0.75);
        await palco.mover(pedido(p, 4).getByText("#4 — Bia Almeida"), { ms: 600 });
      },
    },
    {
      fala: "Você reconhece pelo selo no cartão: este pedido veio do iFood, e o selo traz o número dele no aplicativo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = pedido(p, 4);
        const seloDoApp = c.getByText(/iFood #4821/).first();
        await palco.camera([c.getByText("#4 — Bia Almeida"), c.getByText(/iFood App/).first()], { zoomMax: 1.8, margem: 60 });
        await ctx.ate(0.3);
        await palco.destacar(seloDoApp, { folga: 6 });
        await palco.mover(seloDoApp, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Conferir se está ativa",
      fala: "Para conferir se uma integração está ativa, volte a Integrações e olhe o selo do cartão: com o iFood conectado, ele fica verde.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // A loja "conecta" o iFood aqui: uma linha fictícia de integração, sem
        // token. Sem token o servidor não tem como chamar o iFood (e não chama).
        const loja = await ctx.prisma.user.findUnique({ where: { email: LOJA.email }, select: { id: true } });
        await ctx.prisma.ifoodIntegration.create({
          data: { userId: loja.id, label: "Sabor da Praça", merchantId: "3f2a9c41-7b6d-4e58-9a10-5c2d8e7f1b34", connected: true, active: true },
        });
        await palco.clicar(p.locator('a[href="/store/integracoes"]').filter({ hasText: "🔌" }).first(), { ms: 500 });
        await p.getByText("Conecte Seus Canais").first().waitFor({ state: "visible", timeout: 30_000 });
        await selo(p, "iFood Merchant API").filter({ hasText: "Integração" }).waitFor({ state: "visible", timeout: 15_000 });
        await palco.rolarPagina(330);
        await palco.camera(cartao(p, "iFood Merchant API"), { zoomMax: 1.6, margem: 40 });
        await ctx.ate(0.7);
        await palco.destacar(selo(p, "iFood Merchant API"), { folga: 6 });
        await palco.mover(selo(p, "iFood Merchant API"), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Dentro do cartão, a loja conectada aparece no alto da janela, com o selo Ativa. É aqui também que você desconecta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await palco.clicar(p.locator("h3", { hasText: "iFood Merchant API" }).first(), { ms: 400 });
        await tituloDaJanela(p, "Integrações iFood").waitFor({ state: "visible", timeout: 8000 });
        const desconectar = p.getByRole("button", { name: /Desconectar/ });
        await desconectar.waitFor({ state: "visible", timeout: 8000 });
        const linha = desconectar.locator("xpath=..");
        await palco.camera([tituloDaJanela(p, "Integrações iFood"), linha, p.getByRole("button", { name: /1\. Conectar e Autorizar/ })], { zoomMax: 1.6, margem: 30 });
        await palco.destacar(linha, { folga: 4 });
        await palco.mover(p.getByText("🟢 Ativa").first(), { ms: 500 });
        await ctx.ate(0.75);
        // Só apontado: desconectar abre uma pergunta do navegador, que não aparece no vídeo.
        await palco.mover(desconectar, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso, os pedidos dos aplicativos chegam todos no mesmo painel. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Fechar", exact: true }), { ms: 350 });
        await palco.cameraAberta({ ms: 450 });
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.5);
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 800 });
        }
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
