// Tutorial de Minha loja › Entrega (/store/minha-loja#entrega).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O vídeo mostra o método POR BAIRRO de ponta a ponta, porque é o único que não
// depende de busca de endereço nem de rota: o bairro casa pelo nome
// (lib/area-de-entrega.ts, modo BAIRRO) e o simulador responde sem ir ao mapa.
// Os outros métodos aparecem só no que pedem. O mapa de fundo vem da internet
// (OpenStreetMap); se não carregar, o painel funciona do mesmo jeito.
//
// O que foi conferido no código antes de escrever:
// - cardápio, robô e Balcão calculam a taxa pela mesma regra (avaliarEntrega,
//   usada por api/customer-order, lib/entrega-do-robo e api/store/orders/presencial);
// - no método por bairro o cliente escolhe o bairro numa lista (CustomerStorePage);
// - "Um valor por bairro" exige o campo "Motoboy recebe" em todos, e "Aplicar"
//   preenche taxa − desconto (DeliveryZoneMap, aplicarAtalhoDoRepasse);
// - o Salvar do painel grava e confere no banco antes de dizer "salvas";
// - o simulador pergunta ao mesmo /api/delivery-fee, com a configuração SALVA.
//
// Fora da fala, de propósito: o que acontece com o cliente fora do contorno ou
// dentro da área de risco. A recusa depende de o pedido ter ponto no mapa, e no
// método por bairro o cliente não marca ponto — o vídeo só mostra onde se desenha.
import { dormir } from "../motor/palco.mjs";

const menuMinhaLoja = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/minha-loja"]');
const menuFilho = (p, ancora) => p.locator(`nav.fh-menu-lista a.fh-menu-filho[href="/store/minha-loja#${ancora}"]`);
const freteGratis = (p) => p.getByRole("heading", { name: /Frete Grátis por Valor Mínimo/ }).locator("xpath=ancestor::div[contains(@class,'card')][1]");
const area = (p) => p.locator(".fh-entrega-area");
const painel = (p) => p.locator(".fh-entrega-painel");
const corpo = (p) => p.locator(".fh-painel-corpo");
/** Um dos quatro cartões de "Método de cobrança". */
const metodo = (p, nome) => corpo(p).locator("button[aria-pressed]").filter({ hasText: nome });
/** O cartão do bairro de número `n` (0 = o primeiro da lista). */
const bairro = (p, n) => corpo(p).locator('input[aria-label="Nome do bairro"]').nth(n).locator("xpath=../..");
const repasse = (p) => p.locator(".fh-repasse");
const salvar = (p) => p.locator(".fh-painel-topo button");
const simulador = (p) => p.locator(".fh-simulador");

/** Rola a PÁGINA até o alvo ficar a `topo` pixels do alto da tela (o rolarAte do palco só rola caixas internas). */
async function rolarPaginaPara(palco, alvo, topo = 120) {
  const c = await alvo.boundingBox();
  const y = await palco.pagina.evaluate(() => window.scrollY);
  await palco.rolarPagina(Math.max(0, Math.round(y + c.y - topo)));
}

/** Um pedaço do painel, da altura `de` até `ate` (em pixels a partir do topo dele), para a câmera. */
async function faixaDoPainel(p, de, ate) {
  const c = await painel(p).boundingBox();
  return { x: c.x, y: c.y + de, width: c.width, height: ate - de };
}

export default {
  id: "entrega",
  titulo: "Taxa de entrega: bairros, raio, km e área de atendimento",
  rota: "store/minha-loja#entrega",
  prontaQuando: ".fh-entrega-painel",
  pronuncia: { "km": "quilômetro" },

  /**
   * Uma loja que já cobra por bairro, com dois bairros gravados e o ponto dela
   * no mapa. Assim a tela abre no cadastro da própria loja (e não na tabela de
   * exemplo, que o Salvar pergunta antes de gravar numa janela do navegador).
   */
  async preparar(prisma, { loja }) {
    await prisma.user.update({
      where: { id: loja.id },
      data: {
        storeLatLng: { lat: -16.6806, lng: -49.2563 },
        deliveryZoneType: "NEIGHBORHOOD",
        deliveryZones: [
          { name: "Centro", time: 30, fee: 5 },
          { name: "Jardim América", time: 40, fee: 7 },
        ],
      },
    });
  },

  /** O pulso do botão flutuante para (o botão fica), e o mapa ganha um instante para chegar. */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    await p.locator(".leaflet-tile-loaded").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
    await dormir(2500);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Em Minha loja, Entrega, você diz quanto a loja cobra pela entrega e até onde ela vai. É por esta regra que o cardápio do site, o robô e o Balcão calculam a taxa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await palco.rolarAte(menuFilho(p, "entrega"), { bloco: "center" });
        await palco.destacar([menuMinhaLoja(p), menuFilho(p, "entrega")], { folga: 6 });
        await palco.mover(menuFilho(p, "entrega"), { ms: 900 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.mover(p.getByRole("heading", { name: /Configurações de Entrega/ }), { ms: 900 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Frete grátis",
      fala: "No alto fica o frete grátis por valor mínimo. Ligue a chave, diga a partir de quanto, e clique em Salvar Regra de Frete Grátis.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = freteGratis(p);
        const gravar = p.getByRole("button", { name: "Salvar Regra de Frete Grátis" });
        await palco.destacar(cartao, { folga: 4 });
        await palco.mover(cartao.locator("button").first(), { ms: 800 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(cartao.locator("button").first());
        const valor = cartao.locator('input[type="number"]');
        await valor.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([cartao.getByRole("heading"), valor, gravar], { zoomMax: 1.5, margem: 60, ms: 600 });
        await palco.destacar(valor, { folga: 6 });
        await dormir(1000);
        await palco.apagarDestaque();
        await palco.clicar(gravar);
        await p.waitForFunction(() => {
          const b = [...document.querySelectorAll("button")].find((x) => /Salvar Regra de Frete Grátis/.test(x.textContent || ""));
          return b && b.disabled && !/Salvando/.test(b.textContent || "");
        }, null, { timeout: 15_000 });
        await ctx.ate(1);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "O pedido mínimo fica em outra parte: Informações da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(menuFilho(p, "info"), { folga: 6 });
        await palco.mover(menuFilho(p, "info"), { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os métodos de cobrança",
      fala: "Mais abaixo você escolhe o método de cobrança. Por raio, vale a distância em linha reta. Por km percorrido, o caminho pelas ruas. Por bairro, a lista de bairros que a loja atende. E em Desenhar no mapa, você contorna cada área e dá a taxa dela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, area(p), 150);
        await palco.camera(await faixaDoPainel(p, 0, 480), { zoomMax: 1.5, margem: 30 });
        await palco.mover(corpo(p).getByText("Método de cobrança"), { ms: 600 });
        for (const [i, nome] of ["Por raio", "Por km percorrido", "Por bairro"].entries()) {
          await ctx.ate([0.2, 0.4, 0.58][i]);
          await palco.destacar(metodo(p, nome), { folga: 3 });
          await palco.mover(metodo(p, nome), { ms: 450 });
        }
        await ctx.ate(0.76);
        await palco.apagarDestaque();
        // no meio do painel: no pé dele os botões flutuantes de ajuda ficam por cima
        await palco.rolarAte(metodo(p, "Desenhar no mapa"), { bloco: "center" });
        await palco.destacar(metodo(p, "Desenhar no mapa"), { folga: 3 });
        await palco.mover(metodo(p, "Desenhar no mapa"), { ms: 450 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Faixas de distância",
      fala: "No raio e no km percorrido, o cadastro é por faixas: até quantos quilômetros, o tempo e quanto o cliente paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(metodo(p, "Por raio"), { bloco: "start" });
        await palco.cameraAberta({ ms: 500 });
        await palco.clicar(metodo(p, "Por raio"));
        const faixa = corpo(p).locator('input[aria-label="Até quantos km"]').first().locator("xpath=ancestor::div[2]");
        await faixa.waitFor({ state: "attached", timeout: 8000 });
        await ctx.ate(0.4);
        await palco.rolarAte(faixa, { bloco: "center" });
        await palco.camera(faixa, { zoomMax: 1.6, margem: 80, ms: 600 });
        await palco.destacar(faixa, { folga: 4 });
        await palco.mover(faixa.locator("input").first(), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Cadastro por bairro",
      fala: "No método por bairro, cada bairro tem o nome, o tempo de entrega e quanto o cliente paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(metodo(p, "Por bairro"), { bloco: "center" });
        await palco.clicar(metodo(p, "Por bairro"));
        await bairro(p, 0).waitFor({ state: "attached", timeout: 8000 });
        await palco.rolarAte(bairro(p, 0), { bloco: "start" });
        await palco.camera([bairro(p, 0), bairro(p, 1)], { zoomMax: 1.6, margem: 60, ms: 600 });
        await palco.destacar(bairro(p, 0), { folga: 4 });
        await palco.mover(bairro(p, 0).getByLabel("Cliente paga (R$)"), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para incluir um bairro, clique em Adicionar bairro, no pé do painel, e preencha o nome, o tempo de entrega e o valor que o cliente paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(await faixaDoPainel(p, 60, 571), { zoomMax: 1.45, margem: 24, ms: 500 });
        await palco.clicar(p.getByRole("button", { name: "Adicionar bairro" }));
        const novo = bairro(p, 2);
        await novo.waitFor({ state: "attached", timeout: 8000 });
        await palco.rolarAte(novo, { bloco: "center" });
        await palco.digitar(novo.getByLabel("Nome do bairro"), "Vila Nova");
        await palco.digitar(novo.getByLabel("Tempo de entrega em minutos"), "50");
        await palco.digitar(novo.getByLabel("Cliente paga (R$)"), "9");
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Quanto o motoboy recebe",
      fala: "No quadro Quanto o motoboy recebe, escolha: pelo acerto de cada entregador, que fica em Motoboys, ou um valor por bairro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(repasse(p), { bloco: "start" });
        await palco.camera(repasse(p), { zoomMax: 1.6, margem: 70, ms: 600 });
        const acerto = p.getByRole("radio", { name: "Pelo acerto de cada entregador" });
        const porBairro = p.getByRole("radio", { name: "Um valor por bairro" });
        await ctx.ate(0.3);
        await palco.destacar(acerto, { folga: 4 });
        await palco.mover(acerto, { ms: 500 });
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.clicar(porBairro);
        await p.getByRole("button", { name: "Aplicar" }).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Neste caso, preencha o campo Motoboy recebe em todos os bairros. O botão Aplicar preenche de uma vez, com a taxa menos o valor ao lado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aplicar = p.getByRole("button", { name: "Aplicar" });
        await palco.rolarAte(repasse(p), { bloco: "start" });
        await palco.camera(repasse(p), { zoomMax: 1.6, margem: 50, ms: 500 });
        await ctx.ate(0.42);
        await palco.destacar([repasse(p).getByText(/Preencher todas/), aplicar], { folga: 6 });
        await palco.mover(aplicar, { ms: 600 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(aplicar);
        await palco.rolarAte(bairro(p, 1), { bloco: "center" });
        await palco.camera([bairro(p, 0), bairro(p, 2)], { zoomMax: 1.5, margem: 30, ms: 600 });
        await palco.destacar([0, 1, 2].map((n) => bairro(p, n).getByLabel("Motoboy recebe (R$)")), { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Salvar",
      fala: "Agora o mais importante: clique em Salvar, no alto do painel, e espere o aviso de configurações salvas. Sem isso, nada muda para o cliente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(await faixaDoPainel(p, 0, 230), { zoomMax: 1.6, margem: 60, ms: 600 });
        await palco.destacar(salvar(p), { folga: 6 });
        await palco.mover(salvar(p), { ms: 600 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(salvar(p));
        const aviso = p.locator(".fh-painel-aviso").filter({ hasText: "Configurações de entrega salvas." });
        await aviso.waitFor({ state: "visible", timeout: 20_000 });
        await palco.destacar(aviso, { folga: 4 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Simular um endereço",
      fala: "Para conferir, use Simular um endereço. Digite o bairro e clique em Simular: a tela responde o que o cliente veria, se a loja atende e quanto ele paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // o aviso de "salvas" já foi lido: fechado, o painel ganha espaço para o resultado
        await palco.clicar(p.getByRole("button", { name: "Fechar aviso" }));
        await palco.rolarAte(simulador(p), { bloco: "start" });
        await palco.camera(simulador(p), { zoomMax: 1.6, margem: 60, ms: 600 });
        await palco.digitar(p.getByLabel("Bairro para simular"), "Vila Nova");
        await ctx.ate(0.5);
        await palco.clicar(p.getByRole("button", { name: "Simular" }));
        const resultado = p.locator(".fh-sim-resultado");
        await resultado.getByText("Entrega atendida").waitFor({ state: "visible", timeout: 20_000 });
        await palco.rolarAte(simulador(p), { bloco: "start" });
        await palco.camera(simulador(p), { zoomMax: 1.6, margem: 40, ms: 500 });
        await palco.destacar(resultado, { folga: 4 });
        await palco.mover(resultado.getByText("Cliente paga"), { ms: 600 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Onde entrega e onde não entrega",
      fala: "No fim do painel, dá para desenhar no mapa o contorno de onde a loja entrega e as áreas onde ela não entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const contorno = p.getByRole("button", { name: "+ Desenhar no mapa onde você entrega" });
        const risco = p.getByRole("button", { name: "+ Desenhar área de risco no mapa" });
        await palco.rolarAte(p.getByRole("heading", { name: /Onde você entrega/ }), { bloco: "start" });
        await palco.camera(await faixaDoPainel(p, 50, 490), { zoomMax: 1.55, margem: 30, ms: 600 });
        await ctx.ate(0.35);
        await palco.destacar(contorno, { folga: 5 });
        await palco.mover(contorno, { ms: 500 });
        await ctx.ate(0.72);
        await palco.destacar(risco, { folga: 5 });
        await palco.mover(risco, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso a entrega da loja fica configurada. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
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
