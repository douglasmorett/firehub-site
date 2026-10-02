// Tutorial da Roteirização (/store/roteirizacao).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// ── O mapa, sem depender de busca de endereço ───────────────────────────────
// A tela põe no mapa o pedido que já traz o ponto gravado (`customerLatLng`) e
// só procura pelo endereço os que não trazem. Aqui TODO pedido de entrega e a
// própria loja (`storeLatLng`) têm o ponto gravado no `preparar`: nenhuma busca
// de endereço acontece. A rota da tela é uma linha reta entre os pontos,
// desenhada no navegador — não há cálculo de trajeto por serviço de fora. De
// fora vêm só as imagens do mapa (OpenStreetMap).
//
// Os pontos são de ruas do centro de Ribeirão Preto; os nomes de rua, os
// números e os clientes são inventados.
//
// ── Esta tela não tem o botão Tutorial à vista ──────────────────────────────
// A Roteirização abre em tela cheia, POR CIMA da barra do topo: o botão
// Tutorial existe na página, mas fica tampado. Por isso o vídeo não termina
// apontando para ele (ver o relatório de quem gravou).
import { dormir, BASE } from "../motor/palco.mjs";

const LOJA_NO_MAPA = { lat: -21.1700, lng: -47.8100 };
/** Onde fica cada entrega, pelo número do pedido. */
const PONTO = {
  1: { lat: -21.1668, lng: -47.8060 },   // entregue (não aparece; o ponto só garante que nada é buscado)
  4: { lat: -21.1675, lng: -47.8150 },   // entregue (idem)
  5: { lat: -21.1800, lng: -47.8160 },   // já saiu, com o Carlos
  6: { lat: -21.1850, lng: -47.8005 },   // na cozinha — é o que ganha o "Dar como pronto"
  8: { lat: -21.1728, lng: -47.8062 },   // pronto — 1ª parada da rota
  9: { lat: -21.1722, lng: -47.8010 },   // pronto — 2ª parada (depois de otimizar)
  10: { lat: -21.1760, lng: -47.8215 },  // na cozinha
  11: { lat: -21.1770, lng: -47.7985 },  // pronto — 3ª parada
};
/**
 * O id dos pedidos novos termina no número do pedido de propósito: a janela de
 * despacho e a aba Rotas mostram o FIM DO ID no lugar do número do pedido (a
 * lista de rotas não recebe o número do servidor). Com o id assim, o que
 * aparece é "0008", e não quatro letras sem sentido.
 */
const idDoPedido = (n) => `tutorial-rota-${String(n).padStart(4, "0")}`;

async function preparar(prisma, { loja, produtos, motoboys, haMin }) {
  const L = loja.id;
  // A ordem das paradas é gravada numa coluna que em produção é criada por
  // /api/admin/coluna-sequencia-rota (ela vive fora do schema.prisma). No banco
  // descartável ela não existe, e sem ela criar a rota derruba a conexão do
  // banco local. É o mesmo comando da rota de administração.
  await prisma.$executeRawUnsafe('ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "routeSequence" INTEGER');

  await prisma.user.update({ where: { id: L }, data: { storeLatLng: LOJA_NO_MAPA } });

  // Os pedidos de entrega da loja-base ganham o ponto no mapa.
  for (const n of [1, 4, 5, 6]) {
    await prisma.customerOrder.updateMany({ where: { franchiseeId: L, dailyOrderNumber: n }, data: { customerLatLng: PONTO[n] } });
  }

  const entrega = (n, min, cliente, endereco, paymentMethod, linhas, pronto, extra = {}) => prisma.customerOrder.create({
    data: {
      id: idDoPedido(n), franchiseeId: L, source: "ONLINE", dailyOrderNumber: n, status: "PREPARANDO", deliveryType: "DELIVERY",
      deliveryFee: 6, motoboyFee: 6, paymentMethod, customerLatLng: PONTO[n],
      customerName: cliente, customerPhone: `119777700${String(n).padStart(2, "0")}`, customerAddress: endereco,
      totalAmount: linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 6),
      createdAt: haMin(min), acceptedAt: haMin(min - 1),
      // "Pronto" é o carimbo da cozinha (o mesmo do botão do KDS e de Pedidos).
      ...(pronto ? { kdsStage: "FINISHED", readyAt: haMin(3) } : {}),
      items: { create: linhas.map(([nome, q]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity: q, price: produtos[nome].price })) },
      ...extra,
    },
  });
  await entrega(8, 31, "Helena Prado", "Rua do Mercado, 58 - Centro", "DINHEIRO", [["X-Bacon", 1], ["Guaraná 2 L", 1]], true, { changeAmount: 50 });
  await entrega(9, 27, "Otávio Reis", "Rua da Estação, 310 - Centro", "CREDITO", [["Pizza Marguerita", 1]], true);
  await entrega(10, 12, "Lívia Campos", "Av. das Nações, 742 - Vila Nova", "PIX", [["X-Burger", 2], ["Coca-Cola lata", 2]], false);
  await entrega(11, 24, "Marcos Vieira", "Rua do Sol, 86 - Centro", "PIX", [["Pizza Calabresa", 1]], true);

  // Onde o aplicativo de cada motoboy disse que ele está: o Rafael ao lado da
  // loja, livre; o Carlos a caminho da entrega do pedido 5.
  const agora = new Date();
  await prisma.motoboy.update({ where: { id: motoboys.rafael.id }, data: { lastLat: -21.1704, lastLng: -47.8122, lastLocationUpdate: agora } });
  await prisma.motoboy.update({ where: { id: motoboys.carlos.id }, data: { lastLat: -21.1765, lastLng: -47.8128, lastLocationUpdate: agora } });

  // Comanda já impressa: sem isto o painel, ao abrir, manda os pedidos para a
  // fila de impressão e carimba cada um — e a tela lê esse carimbo num pedido
  // já entregue como "entregue agora", pondo um pino verde no mapa por 10 s.
  await prisma.customerOrder.updateMany({ where: { franchiseeId: L }, data: { printedAt: agora } });
}

// ── os alvos da tela ────────────────────────────────────────────────────────
/** Id do pedido 6 (da loja-base, criado sem id escolhido) e do Rafael: lidos do banco antes de gravar. */
const ids = {};
const idDe = (n) => ids[n] || idDoPedido(n);
/**
 * Os marcadores do mapa são redesenhados de tempos em tempos e, por um
 * instante, não existem. Medir a posição deles é com paciência: tenta de novo
 * até o marcador voltar (o palco só pede `boundingBox`).
 */
const firme = (alvo) => ({
  boundingBox: async () => {
    for (let i = 0; i < 50; i++) {
      const c = await alvo.boundingBox({ timeout: 2000 }).catch(() => null);
      if (c) return c;
      await dormir(40);
    }
    return null;
  },
});
/** O pino do pedido no mapa: a bolinha branca com o número, que é onde se clica. */
const pino = (p, n) => firme(p.locator(`.custom-order-pin-${idDe(n)}`).locator("div").last());
const casinha = (p) => firme(p.locator(".custom-store-pin"));
const capacete = (p, nome) => firme(p.locator('.leaflet-marker-icon[class*="custom-motoboy-pin-"]').filter({ hasText: nome }));
/** O cartão do pedido na lista da esquerda. */
const cartao = (p, n) => p.getByText(`Pedido #${n}`, { exact: true }).locator("xpath=ancestor::div[4]");
const legenda = (p) => p.getByText("O que aparece no mapa").locator("xpath=..");
const linhaDaLegenda = (p, rotulo) => legenda(p).locator("label").filter({ hasText: rotulo });
const botao = (p, nome) => p.getByRole("button", { name: nome });
const selecionados = (p, n) => p.getByText(`${n} selecionado(s)`);
/** A janela "Despachar Rota de Entrega". */
const janela = (p) => p.getByRole("heading", { name: /Despachar Rota de Entrega/ }).locator("xpath=..");
/** O cartão da rota na aba Rotas. */
const rota = (p) => p.getByText("Rota #1", { exact: true }).locator("xpath=ancestor::div[3]");

/**
 * A tela redesenha todos os pinos a cada consulta das rotas (de 4 em 4 s) e das
 * posições dos motoboys (de 10 em 10 s) — e pino redesenhado fecha a caixa do
 * pedido e pode engolir um clique. Aqui fica anotada a hora de cada consulta,
 * para o gesto que depende do pino começar logo depois de uma.
 */
const pulso = { rotas: 0, posicoes: 0 };
/** Quanto depois do começo da cena "O resumo do pedido" deve cair um redesenho do mapa (ms). */
const REDESENHO_NA_CENA_DO_RESUMO = 4100;
async function logoAposRedesenho(livre = 3600) {
  const limite = Date.now() + 9000;
  for (;;) {
    const agora = Date.now();
    const faltaPosicoes = pulso.posicoes + 10_000 - agora;
    const posicoesLonge = faltaPosicoes > livre || faltaPosicoes < -1500;
    if (agora - pulso.rotas < 300 && posicoesLonge) break;
    if (agora > limite) break;
    await dormir(30);
  }
  await dormir(180); // o redesenho em si
}

/** Espera passar a consulta que está para chegar, para o gesto não cair bem em cima de um redesenho. */
async function longeDoRedesenho(janela = 1300) {
  const perto = (falta) => falta < janela && falta > -250;
  for (let i = 0; i < 150; i++) {
    const agora = Date.now();
    if (!perto(pulso.rotas + 4000 - agora) && !perto(pulso.posicoes + 10_000 - agora)) return;
    await dormir(40);
  }
}

/** Um ponto ao lado do alvo (dx, dy a partir do centro) — para apontar sem ficar em cima dele. */
async function aoLado(alvo, dx, dy) {
  const c = await alvo.boundingBox();
  return { x: c.x + c.width / 2 + dx, y: c.y + c.height / 2 + dy };
}

/** Clica num pino e confere que ele entrou na rota; se um redesenho engoliu o clique, clica de novo. */
async function clicarNoPino(palco, n, quantos) {
  const p = palco.pagina;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    await longeDoRedesenho();
    await palco.clicar(pino(p, n), { ms: tentativa ? 150 : 600 });
    const entrou = await selecionados(p, quantos).waitFor({ state: "visible", timeout: 600 }).then(() => true, () => false);
    if (entrou) {
      // sai de cima do pino: mouse parado ali por 1 s abriria a caixa do pedido por cima da rota
      await palco.mover({ x: palco.x + 30, y: palco.y + 52 }, { ms: 250 });
      return;
    }
  }
  throw new Error(`O pino do pedido ${n} não entrou na rota.`);
}

const semPulso = "#contact-widget-fab{animation:none !important}";

export default {
  id: "roteirizacao",
  titulo: "Roteirização: montar a rota e despachar",
  rota: "store/roteirizacao",
  prontaQuando: ".leaflet-marker-icon",
  preparar,

  async antesDeGravar(palco, { prisma, vozes }) {
    const p = palco.pagina;
    ids[6] = (await prisma.customerOrder.findFirst({ where: { dailyOrderNumber: 6 }, select: { id: true } })).id;
    ids.rafael = (await prisma.motoboy.findFirst({ where: { name: "Rafael" }, select: { id: true } })).id;

    // As imagens do mapa vêm da internet. Para a aproximação do "Centralizar
    // Visão" não aparecer montando quadrado por quadrado no meio do vídeo, o
    // navegador passa uma vez por ela antes e a tela é reaberta do começo.
    await botao(p, /Centralizar Visão/).click();
    await dormir(4000);
    await p.reload({ waitUntil: "load" });
    await p.locator(".leaflet-marker-icon").first().waitFor({ state: "visible", timeout: 120_000 });
    await p.waitForFunction(() => document.querySelectorAll(".leaflet-tile-loaded").length >= 12, null, { timeout: 60_000 }).catch(() => {});
    await p.addStyleTag({ content: semPulso });

    p.on("response", (r) => {
      const u = r.url();
      if (/\/api\/store\/routes(\?|$)/.test(u) && r.request().method() === "GET") pulso.rotas = Date.now();
      else if (u.includes("/api/motoboys/location")) pulso.posicoes = Date.now();
    });
    // Começa a gravar com as duas consultas já vistas e nenhum pino verde de "entregue agora".
    for (let i = 0; i < 150 && !(pulso.rotas && pulso.posicoes); i++) await dormir(100);
    await linhaDaLegenda(p, "Entregue agora").getByText("0", { exact: true }).waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    await dormir(500);

    // ── A hora de começar ──────────────────────────────────────────────────
    // Na cena "O resumo do pedido" a caixa só fica aberta entre um redesenho do
    // mapa e o seguinte (4 s). Para ela abrir junto com a frase, a gravação
    // começa numa hora calculada: a consulta das rotas tem de cair ~4 s depois
    // do começo daquela cena, e a das posições dos motoboys longe dali. (É o
    // mesmo recurso do roteiro de Pedidos para o pedido novo chegar na hora.)
    const ateACena = [0, 1, 2, 3].reduce((t, i) => t + (vozes[i]?.ms ?? 0), 0) + 2950 + 250; // falas + respiros e gestos finais das 4 primeiras cenas
    const alvo = ateACena + REDESENHO_NA_CENA_DO_RESUMO;
    const agora = Date.now();
    let consulta = pulso.rotas + 4000 * Math.ceil((agora + 700 + alvo - pulso.rotas) / 4000);
    for (let k = 0; k < 6; k++, consulta += 4000) {
      const ateAsPosicoes = (((pulso.posicoes - consulta) % 10_000) + 10_000) % 10_000; // desta consulta até a próxima das posições
      if (ateAsPosicoes > 4400 && ateAsPosicoes < 9500) break;
    }
    const espera = consulta - alvo - Date.now() - 250; // 250 ms: o que a captura leva para começar
    if (espera > 0) await dormir(espera);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a Roteirização. Aqui você vê os pedidos de entrega no mapa, junta os que vão para o mesmo lado numa rota e despacha com um motoboy.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(700);
        await palco.mover({ x: 880, y: 330 }, { ms: 1100 });
        await ctx.ate(0.45);
        await palco.mover(cartao(p, 6).getByText("Pedido #6"), { ms: 900 });
        await ctx.ate(0.8);
        await palco.mover({ x: 760, y: 300 }, { ms: 900 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "O mapa",
      fala: "O botão Centralizar Visão enquadra todos os pedidos na tela. No mapa, a casinha é a sua loja, e cada pino com número é um pedido de entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const centralizar = botao(p, /Centralizar Visão/);
        await palco.destacar(centralizar, { folga: 6 });
        await palco.mover(centralizar, { ms: 600 });
        await ctx.ate(0.14);
        await palco.apagarDestaque();
        await palco.clicar(centralizar, { ms: 150 });
        await dormir(900); // o mapa aproxima
        await ctx.ate(0.42);
        // A loja e os pinos mais próximos dela, de perto.
        await palco.camera([casinha(p), pino(p, 8), pino(p, 9), capacete(p, "Rafael")], { zoomMax: 1.7, margem: 110, ms: 600 });
        await palco.destacar(casinha(p), { folga: 8 });
        await palco.mover(await aoLado(casinha(p), 30, 34), { ms: 500 });
        await ctx.ate(0.68);
        // Ao lado do pino, não em cima: mouse parado no pino abre a caixa do pedido, que é assunto de outra cena.
        await palco.destacar(pino(p, 8), { folga: 14 });
        await palco.mover(await aoLado(pino(p, 8), 30, 36), { ms: 500 });
        await ctx.ate(0.84);
        await palco.destacar(pino(p, 9), { folga: 14 });
        await palco.mover(await aoLado(pino(p, 9), 30, 36), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "As cores dos pinos",
      fala: "A cor do pino mostra em que pé está o pedido: na cozinha, pronto ou saiu para entrega. E cada linha desta legenda esconde ou mostra aquele grupo no mapa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const l = legenda(p);
        await palco.camera(l, { zoomMax: 2.1, margem: 90, ms: 600 });
        await palco.destacar(l, { folga: 6 });
        await ctx.ate(0.3);
        await palco.mover(linhaDaLegenda(p, "Na cozinha").getByText("Na cozinha"), { ms: 400 });
        await ctx.ate(0.4);
        await palco.mover(linhaDaLegenda(p, "Pronto").getByText("Pronto"), { ms: 350 });
        await ctx.ate(0.5);
        await palco.mover(linhaDaLegenda(p, "Saiu para entrega").getByText("Saiu para entrega"), { ms: 350 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
        const caixinha = linhaDaLegenda(p, "Na cozinha").locator("input");
        await palco.clicar(caixinha, { ms: 400 });
        await ctx.ate(0.9);
        await palco.clicar(caixinha, { ms: 150 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Os motoboys no mapa",
      fala: "Os capacetes são os motoboys, no lugar que o aplicativo de cada um informa. O verde está livre, e o vermelho está com entrega na rua.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const rafael = capacete(p, "Rafael"), carlos = capacete(p, "Carlos");
        await palco.camera([rafael, carlos, casinha(p)], { zoomMax: 1.8, margem: 90, ms: 600 });
        await palco.mover(rafael, { ms: 600 });
        await ctx.ate(0.52);
        await palco.destacar(rafael, { folga: 8 });
        await ctx.ate(0.74);
        await palco.destacar(carlos, { folga: 8 });
        await palco.mover(carlos, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "O resumo do pedido",
      fala: "Para saber o que é cada pino, pare o mouse em cima dele: abre o resumo do pedido, com o endereço, o prazo e a forma de pagamento.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const alvo = await pino(p, 6).boundingBox();
        const centro = { x: alvo.x + alvo.width / 2, y: alvo.y + alvo.height / 2 };
        await ctx.ate(0.2);
        await palco.mover({ x: centro.x - 70, y: centro.y + 80 }, { ms: 900 });
        // A caixa só fica aberta entre um redesenho do mapa e o seguinte: o gesto começa logo depois de um
        // (a gravação começou na hora certa para ele cair aqui — ver antesDeGravar).
        await logoAposRedesenho();
        const redesenho = Date.now();
        await palco.mover(centro, { ms: 250 });
        await palco.camera({ x: centro.x - 200, y: centro.y - 250, width: 400, height: 300 }, { zoomMax: 1.9, margem: 10, ms: 500 });
        await p.locator(".leaflet-popup").waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
        // A captura só guarda quadro novo quando a tela pinta. A caixa aparece esmaecendo e, com tudo
        // parado, o último quadro guardado seria o dela ainda transparente: o mouse mexe um ponto, sem
        // sair de cima do pino, e a tela segue pintando. Sai dali um instante antes do próximo
        // redesenho, que fecharia a caixa sozinho.
        while (Date.now() < redesenho + 3550) {
          await p.mouse.move(centro.x + 1, centro.y);
          await dormir(110);
          await p.mouse.move(centro.x, centro.y);
          await dormir(110);
        }
        await palco.mover({ x: centro.x - 150, y: centro.y + 90 }, { ms: 400 });
        await palco.cameraAberta({ ms: 500 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Os pedidos que faltam sair",
      fala: "Do lado esquerdo ficam os pedidos que ainda não saíram. Quando a cozinha terminar um deles, clique em Dar como pronto, e o pino muda de cor.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 6);
        await palco.destacar([botao(p, /PEDIDOS PENDENTES/), c, cartao(p, 8)], { folga: 4 });
        await palco.mover(c.getByText("Pedido #6"), { ms: 700 });
        await ctx.ate(0.38);
        await palco.apagarDestaque();
        const pronto = c.getByRole("button", { name: /Dar como pronto/ });
        await palco.destacar(pronto, { folga: 6 });
        await palco.mover(pronto, { ms: 500 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(pronto, { ms: 150 });
        await c.getByText("Pronto na cozinha").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.82);
        await palco.destacar(pino(p, 6), { folga: 16 });
        await palco.mover(await aoLado(pino(p, 6), 32, 38), { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Mostrar Prontos esconde, da lista e do mapa, os pedidos que ainda estão na cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const prontos = botao(p, /Mostrar Prontos/);
        await palco.destacar([botao(p, /Mostrar Todos/), prontos], { folga: 6 });
        await palco.mover(prontos, { ms: 600 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(prontos, { ms: 150 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Montar a rota",
      fala: "Para montar a rota, clique nos pedidos, na lista ou direto no pino. Cada um ganha o número da parada, e uma linha tracejada liga a loja às entregas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.12);
        await palco.clicar(cartao(p, 8).getByText("Pedido #8"), { ms: 600 });
        await selecionados(p, 1).waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.36);
        await clicarNoPino(palco, 11, 2);
        await ctx.ate(0.55);
        await clicarNoPino(palco, 9, 3);
        await palco.mover({ x: 840, y: 560 }, { ms: 500 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Otimizar Trajeto reordena as paradas pela menor distância, a partir da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const otimizar = botao(p, /Otimizar Trajeto/);
        await palco.destacar(otimizar, { folga: 6 });
        await palco.mover(otimizar, { ms: 600 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(otimizar, { ms: 150 });
        await palco.mover({ x: 840, y: 560 }, { ms: 500 });
        await ctx.ate(1);
        await dormir(400);
      },
    },
    {
      fala: "Se preferir, o botão Auto-Agrupar escolhe os pedidos sozinho: parte do primeiro da lista e junta os que estão perto ou no caminho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const auto = botao(p, /Auto-Agrupar/);
        await palco.destacar(auto, { folga: 6 });
        await palco.mover(auto, { ms: 800 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Criar a rota",
      fala: "Com as paradas escolhidas, clique em Criar rota. A janela mostra a sequência das paradas, o troco que o motoboy precisa levar e se ele vai precisar da maquininha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.1);
        await palco.clicar(botao(p, /Criar rota/), { ms: 700 });
        const j = janela(p);
        await j.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(j, { zoomMax: 1.3, margem: 14, ms: 600 });
        await ctx.ate(0.4);
        const paradas = j.getByText("SEQUÊNCIA DE PARADAS:").locator("xpath=..");
        await palco.destacar(paradas, { folga: 4 });
        await palco.mover(paradas, { ms: 500 });
        await ctx.ate(0.62);
        const resumo = j.getByText(/RESUMO DE LOGÍSTICA DE PAGAMENTO/).locator("xpath=..");
        await palco.destacar(resumo, { folga: 4 });
        await palco.mover(j.getByText(/Troco Total a Levar/), { ms: 500 });
        await ctx.ate(0.84);
        await palco.mover(j.getByText(/Levar Maquininha de Cartão/), { ms: 400 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Despachar com o motoboy",
      fala: "Selecione o motoboy que vai levar, e clique em Despachar Rota agora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const j = janela(p);
        const lista = j.locator("select");
        await palco.apontar(lista, { ms: 500 });
        await lista.selectOption(ids.rafael);
        // Escolhido o motoboy, os campos de "digite o nome" somem e a janela encolhe: o contorno vem depois.
        await dormir(350);
        await palco.destacar(lista, { folga: 6 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.clicar(j.getByRole("button", { name: /Despachar Rota agora/ }), { ms: 600 });
        // O aviso de sucesso desta tela é uma janela do navegador, que não aparece na gravação.
        await p.getByText("Rota #1", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "A rota despachada",
      fala: "A rota fica na aba Rotas, como despachada, e os pedidos dela passam para Saiu para Entrega. Se o motoboy mudar, dá para trocar o entregador aqui mesmo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const r = rota(p);
        await palco.destacar(r, { folga: 6 });
        await palco.mover(r.getByText(/Despachada/), { ms: 700 });
        await ctx.ate(0.36);
        const saiu = linhaDaLegenda(p, "Saiu para entrega");
        await palco.destacar(saiu, { folga: 6 });
        await palco.mover(saiu, { ms: 700 });
        await ctx.ate(0.66);
        const trocar = r.getByText("Trocar entregador").locator("xpath=..");
        await palco.camera(r, { zoomMax: 1.6, margem: 30, ms: 500 });
        await palco.destacar(trocar, { folga: 6 });
        await palco.mover(trocar.locator("select"), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Na tela de Pedidos",
      fala: "Na tela de Pedidos, esses pedidos já estão na coluna Saiu para Entrega, com o motoboy da rota.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${BASE}/store/pedidos-clientes`, { waitUntil: "load", timeout: 120_000 });
        const coluna = p.locator('[data-droppable="col-transporte"]');
        const pedido = coluna.locator("[draggable]").filter({ hasText: "#8 — " }).first();
        await pedido.waitFor({ state: "visible", timeout: 60_000 });
        await p.addStyleTag({ content: semPulso });
        await dormir(500);
        await palco.rolarPagina(160);
        await palco.destacar([coluna.locator("h3").first(), coluna.locator("[data-column-count]").first()], { folga: 8 });
        await palco.mover(coluna.locator("h3").first(), { ms: 600 });
        await ctx.ate(0.6);
        const motoboy = pedido.locator(".pedido-acoes-motoboy select");
        await palco.rolarAte(pedido, { bloco: "start" });
        await palco.camera(pedido, { zoomMax: 1.6, margem: 40, ms: 500 });
        await palco.destacar(motoboy, { folga: 6 });
        await palco.mover(motoboy, { ms: 500 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Com isso, você monta as rotas e despacha os motoboys direto pelo mapa, sem sair desta tela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 600 });
        await ctx.ate(0.2);
        // A Roteirização abre por cima da barra do topo: o botão Tutorial dela mora no próprio cabeçalho.
        await p.goto(`${BASE}/store/roteirizacao`, { waitUntil: "load", timeout: 120_000 });
        await p.getByRole("button", { name: /^Tutorial/ }).first().waitFor({ state: "visible", timeout: 60_000 });
        await p.addStyleTag({ content: semPulso });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Para rever este vídeo, é só clicar em Tutorial, aqui no alto da Roteirização.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // Há dois botões Tutorial na página: o da barra do topo, escondido atrás desta tela cheia,
        // e o do cabeçalho da Roteirização. O que conta é o do cabeçalho, ao lado de Configurações.
        const botao = p.getByRole("button", { name: /Configurações/ }).first()
          .locator("xpath=preceding-sibling::button[starts-with(@aria-label,'Tutorial')][1]");
        await palco.camera(botao, { zoomMax: 1.6, margem: 220, ms: 600 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
