// Tutorial do Painel de senhas (/store/painel-de-senhas) e da TV (/tv).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever (18/10/2026):
// - PainelDeSenhasClient: "Ligar na TV" (3 passos, o código, Abrir o painel,
//   Copiar link, Enviar pelo WhatsApp), a prévia ("Como fica na TV"), "O que
//   aparece na TV" (Quais pedidos / Chamada / Sua marca, cada clique salva na
//   hora e mostra "Salvo — A TV muda sozinha em alguns segundos") e
//   "Numeração dos pedidos" com a confirmação que avisa que o número muda em
//   TUDO e vale a partir do próximo pedido;
// - /tv (DigitarCodigo): pede o código, guarda no aparelho e volta sozinho;
// - PainelDeSenhasTV: pergunta a cada 4 s; Preparando à esquerda, Pronto à
//   direita; número que ENTRA em Pronto é chamado em tela cheia por 7 s, com
//   som (WebAudio) — a primeira resposta não chama ninguém; o botão "Toque
//   aqui (ou aperte OK no controle)" liga o som e a tela cheia;
// - lib/painel-de-senhas.ts: retirada pronta = status PRONTO (o botão
//   "Pronto" do quadro de Pedidos); o pronto sai na finalização ou depois de
//   prontoFicaMin.
//
// ── DUAS TELAS AO MESMO TEMPO ───────────────────────────────────────────────
// A chamada só acontece com a TV JÁ ligada quando o pedido fica pronto. Por
// isso a gravação usa duas abas do mesmo navegador: a 1ª vira a TV (/tv) e
// fica ligada; a 2ª é o painel da loja (Pedidos e depois Painel de senhas).
// A câmera passa de uma aba para a outra (filmar), copiando o jeito do palco
// de capturar os quadros (Palco.gravar) — o motor não muda.
import fs from "node:fs";
import path from "node:path";
import { dormir, TELA, DENSIDADE } from "../motor/palco.mjs";

export const CODIGO = "K7P2QX";
const RECADO = "Peça também pelo nosso site!";
const COR = "#A855F7";

/** As duas abas: a TV e o painel da loja. */
const abas = { tv: null, painel: null };
/** Hora da última pergunta da TV ao servidor (para o clique em Pronto cair perto da próxima). */
let ultimaConsulta = 0;

/**
 * Passa a câmera para outra aba: para a captura da atual e liga na nova, com o
 * mesmo formato e a mesma numeração de quadros do palco.
 */
async function filmar(palco, pagina) {
  if (palco.pagina === pagina) return;
  const velho = palco.cdp;
  await velho.send("Page.stopScreencast").catch(() => {});
  velho.removeAllListeners?.("Page.screencastFrame");
  await pagina.bringToFront();
  const cdp = await pagina.context().newCDPSession(pagina);
  cdp.on("Page.screencastFrame", (q) => {
    const nome = `${String(palco.quadros.length + 1).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(palco.pasta, nome), Buffer.from(q.data, "base64"));
    palco.quadros.push({ nome, quando: q.metadata.timestamp * 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: q.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: TELA.width * DENSIDADE, maxHeight: TELA.height * DENSIDADE, everyNthFrame: 2 });
  palco.cdp = cdp;
  palco.pagina = pagina;
  // Um movimento força o primeiro quadro e põe a seta no lugar.
  await pagina.mouse.move(palco.x + 1, palco.y);
  await pagina.mouse.move(palco.x, palco.y);
}

/**
 * Esconde o que não é assunto do vídeo: os balões flutuantes (Bill, WhatsApp
 * da loja, suporte — position fixed, z-index ≥ 9000) e a faixa do Assistente
 * de Impressão. Roda dentro de cada página.
 */
function limparTela() {
  const varrer = () => {
    const candidatos = document.querySelectorAll('body > *, body > * > *, [style*="position: fixed"], [style*="position:fixed"], .fcw-container, #contact-widget-fab, #floating-contact-widget');
    for (const el of candidatos) {
      if (el.id && el.id.startsWith("tutorial-")) continue;
      const s = getComputedStyle(el);
      if (s.position === "fixed" && Number(s.zIndex) >= 9000) el.style.setProperty("display", "none", "important");
    }
  };
  setInterval(varrer, 400);
  document.addEventListener("DOMContentLoaded", varrer);
}

// ── Atalhos da tela ────────────────────────────────────────────────────────
const secao = (p, titulo) => p.locator("section").filter({ has: p.getByRole("heading", { name: titulo, exact: true }) }).first();
const opcao = (p, titulo) => p.locator("label").filter({ has: p.getByText(titulo, { exact: true }) }).first();
/** Na TV: as duas colunas e a senha dentro delas. */
const colunaTv = (p, nome) => p.locator("main section").filter({ has: p.locator("h2", { hasText: nome }) }).first();
const senhaTv = (p, nome, n) => colunaTv(p, nome).locator("div.fh-entra").filter({ has: p.getByText(String(n), { exact: true }) }).first();
/** No quadro de Pedidos: o cartão do pedido na coluna Em Produção. */
const cartao = (p, n) => p.locator('[data-droppable="col-preparo"] [draggable]').filter({ hasText: `#${n} — ` }).first();

export default {
  id: "painel-de-senhas",
  titulo: "Painel de senhas: a TV que chama o pedido pronto",
  rota: "store/painel-de-senhas",
  prontaQuando: '[aria-label="Código da TV"]',
  pronuncia: { QR: "quê érre" },

  async preparar(prisma, { loja, produtos, haMin }) {
    // Código fixo (o painel sortearia um na primeira visita); o resto fica no padrão.
    await prisma.user.update({ where: { id: loja.id }, data: { painelDeSenhas: { codigo: CODIGO } } });
    // Mais pedidos de balcão/retirada, para a TV não ficar vazia. O 7 (Fernanda,
    // retirada, da loja-base) é o que fica pronto no vídeo; o 9 já está pronto.
    const itens = (linhas) => ({
      create: linhas.map(([nome, quantity]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity, price: produtos[nome].price })),
    });
    const soma = (linhas) => linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 0);
    const pedidos = [
      { n: 9, customerName: "Rodrigo Alves", status: "PRONTO", linhas: [["X-Tudo", 1], ["Coca-Cola lata", 1]], createdAt: haMin(14), acceptedAt: haMin(14), readyAt: haMin(2) },
      { n: 10, customerName: "Juliana Souza", status: "PREPARANDO", linhas: [["X-Bacon", 1], ["Batata Frita", 1]], createdAt: haMin(6), acceptedAt: haMin(6) },
      { n: 11, customerName: "Marcos Teixeira", status: "ACEITO", linhas: [["X-Burger", 2]], createdAt: haMin(3), acceptedAt: haMin(3) },
    ];
    for (const { n, linhas, ...d } of pedidos) {
      await prisma.customerOrder.create({
        data: {
          franchiseeId: loja.id, source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Pix",
          customerPhone: `1197776${String(1000 + n)}`, dailyOrderNumber: n, totalAmount: soma(linhas), items: itens(linhas), ...d,
        },
      });
    }
  },

  async antesDeGravar(palco, { BASE }) {
    const p = palco.pagina;
    const contexto = p.context();
    // O computador da gravação tem um Assistente de Impressão de verdade: a
    // faixa "não está vinculado a esta loja" não é assunto deste vídeo.
    await contexto.route(/^http:\/\/(localhost|127\.0\.0\.1):(7899|7900|7901|7891)\//, (r) => r.abort());
    await contexto.addInitScript(limparTela);
    p.on("request", (r) => { if (r.url().includes("/api/painel-de-senhas?")) ultimaConsulta = Date.now(); });
    await p.reload({ waitUntil: "load", timeout: 120_000 });
    await p.locator('[aria-label="Código da TV"]').waitFor({ state: "visible", timeout: 60_000 });

    // A segunda aba: o quadro de Pedidos, já aberto, com o pedido 7 em produção.
    const painel = await contexto.newPage();
    painel.setDefaultTimeout(30_000);
    await painel.goto(`${BASE}/store/pedidos-clientes`, { waitUntil: "load", timeout: 120_000 });
    await cartao(painel, 7).waitFor({ state: "visible", timeout: 60_000 });
    abas.tv = p;
    abas.painel = painel;
    await p.bringToFront();
    // A prévia carrega devagar no primeiro acesso: espera os números aparecerem.
    await p.locator('[aria-label="Prévia do painel de senhas"]').getByText("Preparando").waitFor({ state: "visible", timeout: 30_000 });
    await dormir(1500);
  },

  cenas: [
    {
      capitulo: "O que é o Painel de senhas",
      fala: "O Painel de senhas liga uma TV no salão, mostrando os pedidos em preparo e os que já podem ser retirados, com a marca da sua loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await palco.mover(p.getByRole("heading", { name: "Painel de senhas" }), { ms: 900 });
        await ctx.ate(0.5);
        await palco.mover(p.getByText(/Uma TV no salão/), { ms: 700 });
      },
    },
    {
      fala: "Aqui do lado, você vê como fica na TV.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const previa = p.locator('[aria-label="Prévia do painel de senhas"]');
        await palco.camera(previa, { zoomMax: 1.6, margem: 30 });
        await palco.mover(previa, { ms: 700 });
        await ctx.ate(1);
        await palco.cameraAberta({ ms: 600 });
      },
    },
    {
      capitulo: "Ligar na TV",
      fala: "Para ligar, abra na TV o endereço do passo 1 e digite este código. Se quiser, mande o link pelo WhatsApp para quem vai ligar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartaoTv = secao(p, "Ligar na TV");
        await palco.rolarAte(p.getByRole("button", { name: "Copiar link" }), { bloco: "end" });
        await palco.camera(cartaoTv, { zoomMax: 1.5, margem: 20 });
        await palco.destacar(cartaoTv.locator("ol li").first(), { folga: 6 });
        await palco.mover(cartaoTv.getByText("firehubfood.com.br/tv").first(), { ms: 700 });
        await ctx.ate(0.4);
        await palco.destacar(p.locator('[aria-label="Código da TV"]'), { folga: 6 });
        await palco.mover(p.locator('[aria-label="Código da TV"]'), { ms: 600 });
        await ctx.ate(0.62);
        const zap = p.getByRole("link", { name: /Enviar pelo WhatsApp/ });
        await palco.destacar([p.getByRole("button", { name: "Copiar link" }), zap], { folga: 6 });
        await palco.mover(zap, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Na TV",
      fala: "Na TV, o painel pede o código. Digite e clique em Abrir painel.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/tv`, { waitUntil: "load" });
        const campo = p.getByLabel("Código do painel");
        await campo.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(300);
        await palco.digitar(campo, CODIGO);
        await ctx.ate(0.75);
        await palco.clicar(p.getByRole("button", { name: "Abrir painel" }));
        await p.getByRole("button", { name: /aperte OK no controle/ }).waitFor({ state: "visible", timeout: 30_000 });
      },
    },
    {
      fala: "Depois, aperte OK no controle, ou toque na tela, para ligar o som e a tela cheia. A TV guarda o código para a próxima vez.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ativar = p.getByRole("button", { name: /aperte OK no controle/ });
        await palco.destacar(ativar, { folga: 6 });
        await palco.mover(ativar, { ms: 800 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        // O OK do controle remoto é o Enter do teclado: o botão já vem com o foco.
        await palco.apontar(ativar);
        await p.keyboard.press("Enter");
        await ativar.waitFor({ state: "detached", timeout: 10_000 });
        await palco.mover({ x: 1300, y: 700 }, { ms: 700 });
      },
    },
    {
      capitulo: "As duas colunas",
      fala: "À esquerda ficam as senhas em preparo. À direita, em destaque, as que já estão prontas para retirar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const preparando = colunaTv(p, "Preparando");
        const pronto = colunaTv(p, "Pronto");
        await palco.destacar(preparando, { folga: 4 });
        await palco.mover(senhaTv(p, "Preparando", 7), { ms: 800 });
        await ctx.ate(0.45);
        await palco.destacar(pronto, { folga: 4 });
        await palco.mover(senhaTv(p, "Pronto", 9), { ms: 800 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A senha chamada na TV",
      fala: "Agora, na tela de Pedidos: o pedido 7 é de retirada. Quando ele ficar pronto, clique em Pronto.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await filmar(palco, p);
        const c = cartao(p, 7);
        const pronto = c.getByRole("button", { name: "Pronto", exact: true });
        const nome = c.getByText("#7 — Fernanda Lima");
        await palco.rolarAte(nome, { bloco: "start" });
        await palco.camera([nome, pronto], { zoomMax: 1.6, margem: 40 });
        await palco.mover(nome, { ms: 700 });
        await ctx.ate(0.4);
        await palco.destacar(pronto, { folga: 6 });
        await palco.mover(pronto, { ms: 600 });
        await ctx.ate(0.75);
        await palco.apagarDestaque();
        // A TV pergunta a cada 4 s: o clique cai 1 a 2 s antes da próxima
        // pergunta, para a chamada aparecer logo (no máximo 4 s de espera).
        const limite = Date.now() + 4000;
        for (;;) {
          const falta = ultimaConsulta + 4000 - Date.now();
          if ((falta > 1100 && falta < 2400) || Date.now() > limite) break;
          await dormir(60);
        }
        await palco.clicar(pronto);
      },
      pausa: 150,
    },
    {
      fala: "Em poucos segundos, a TV chama a senha em tela cheia, com um aviso sonoro.",
      acao: async (palco, ctx) => {
        await palco.cameraAberta({ ms: 10 });
        const p = abas.tv;
        await filmar(palco, p);
        await p.locator(".fh-chamada").waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "A chamada fica alguns segundos na tela. Depois, o número continua em Pronto até o pedido ser finalizado, ou até passar o tempo que você escolher.",
      acao: async (palco, ctx) => {
        const p = abas.tv;
        // Enquanto a TV aparece, a aba do painel já abre o Painel de senhas.
        const carregando = abas.painel.goto(`${ctx.BASE}/store/painel-de-senhas`, { waitUntil: "load", timeout: 120_000 });
        await p.locator(".fh-chamada").waitFor({ state: "detached", timeout: 15_000 });
        await dormir(600);
        const senha = senhaTv(p, "Pronto", 7);
        await palco.destacar(senha, { folga: 8 });
        await palco.mover(senha, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await carregando;
        await abas.painel.locator('[aria-label="Código da TV"]').waitFor({ state: "visible", timeout: 60_000 });
      },
    },
    {
      capitulo: "O que aparece na TV",
      fala: "De volta ao Painel de senhas, escolha quais pedidos aparecem na TV: balcão e retirada, mesa ou delivery.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await filmar(palco, p);
        const titulo = p.getByRole("heading", { name: "O que aparece na TV" });
        await palco.rolarAte(titulo, { bloco: "start" });
        await ctx.ate(0.45);
        const tipos = [opcao(p, "Balcão e retirada"), opcao(p, "Mesa"), opcao(p, "Delivery")];
        await palco.destacar(tipos, { folga: 8 });
        for (const [i, t] of tipos.entries()) {
          await ctx.ate(0.55 + i * 0.14);
          await palco.mover(t.locator("input"), { ms: 450 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Chamada, ligue o som, a voz que fala a senha e o primeiro nome do cliente. E escolha quanto tempo o pronto fica na tela.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await palco.mover(opcao(p, "Tocar som quando ficar pronto").locator("input"), { ms: 700 });
        await ctx.ate(0.22);
        await palco.mover(opcao(p, "Falar a senha em voz alta").locator("input"), { ms: 500 });
        await ctx.ate(0.4);
        const nome = opcao(p, "Mostrar o primeiro nome do cliente").locator("input");
        await palco.clicar(nome);
        await p.waitForFunction(() => {
          const l = [...document.querySelectorAll("label")].find((x) => x.textContent.includes("Mostrar o primeiro nome do cliente"));
          const i = l?.querySelector("input");
          return i && i.checked && !i.disabled;
        }, null, { timeout: 15_000 });
        await ctx.ate(0.72);
        const tempo = p.locator("select").first();
        await palco.destacar(tempo.locator("xpath=.."), { folga: 6 });
        await palco.apontar(tempo);
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Sua marca",
      fala: "O nome e a logo vêm de Minha loja. Aqui, escolha a cor do destaque e ligue o QR do cardápio no rodapé.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await palco.mover(secao(p, "O que aparece na TV").getByRole("link", { name: /Minha loja/ }), { ms: 700 });
        await ctx.ate(0.4);
        const cor = p.getByRole("button", { name: `Cor ${COR}` });
        await palco.clicar(cor);
        await cor.locator("svg").waitFor({ state: "visible", timeout: 15_000 });
        await p.waitForFunction((c) => !document.querySelector(`[aria-label="Cor ${c}"]`)?.disabled, COR, { timeout: 15_000 });
        await ctx.ate(0.72);
        const qr = opcao(p, "QR do cardápio no rodapé").locator("input");
        await palco.clicar(qr);
        await p.waitForFunction(() => {
          const l = [...document.querySelectorAll("label")].find((x) => x.textContent.includes("QR do cardápio no rodapé"));
          const i = l?.querySelector("input");
          return i && i.checked && !i.disabled;
        }, null, { timeout: 15_000 });
      },
    },
    {
      fala: "E escreva um recado para o rodapé.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        const campo = p.getByPlaceholder(/Peça também pelo nosso site/);
        await palco.digitar(campo, RECADO);
        await p.keyboard.press("Enter");
        await p.getByText("A TV muda sozinha em alguns segundos.").waitFor({ state: "visible", timeout: 15_000 });
        await dormir(800);
      },
    },
    {
      fala: "A TV muda sozinha em alguns segundos: o nome do cliente, a cor nova, o QR e o recado.",
      acao: async (palco, ctx) => {
        const p = abas.tv;
        await filmar(palco, p);
        await p.getByText(RECADO).waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(0.32);
        await palco.mover(senhaTv(p, "Pronto", 7).getByText("Fernanda"), { ms: 700 });
        await ctx.ate(0.5);
        await palco.mover(colunaTv(p, "Pronto").locator("h2"), { ms: 600 });
        await ctx.ate(0.66);
        await palco.mover(p.getByText("Peça pelo celular"), { ms: 600 });
        await ctx.ate(0.82);
        await palco.mover(p.getByText(RECADO), { ms: 600 });
      },
    },
    {
      capitulo: "Numeração dos pedidos",
      fala: "Em Numeração dos pedidos, na sequência, quem vê a senha 184 às 9 da noite sabe quanto a loja vendeu. Na sorteada, o número sai embaralhado e ninguém consegue contar.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await filmar(palco, p);
        const bloco = secao(p, "Numeração dos pedidos");
        const sequencia = p.getByRole("button", { name: /Em sequência/ });
        const sorteada = p.getByRole("button", { name: /Sorteada/ });
        await palco.rolarAte(sorteada, { bloco: "end" });
        await palco.camera(bloco, { zoomMax: 1.4, margem: 20 });
        await palco.destacar(sequencia, { folga: 6 });
        await palco.mover(sequencia.getByText("1 · 2 · 3 · 4 · 5"), { ms: 700 });
        await ctx.ate(0.55);
        await palco.destacar(sorteada, { folga: 6 });
        await palco.mover(sorteada.getByText("347 · 812 · 129 · 560"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Ao clicar em Sorteada, a tela avisa: o número muda em tudo, no quadro, na cozinha, na comanda, na TV e nas mensagens ao cliente.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await palco.clicar(p.getByRole("button", { name: /Sorteada/ }));
        const aviso = p.getByRole("alertdialog");
        await aviso.waitFor({ state: "visible", timeout: 10_000 });
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(aviso, { bloco: "end" });
        await palco.camera(aviso, { zoomMax: 1.5, margem: 24 });
        await palco.mover(aviso.getByText("tudo", { exact: true }), { ms: 700 });
        await ctx.ate(0.5);
        await palco.mover(aviso.locator("li").first(), { ms: 900 });
      },
    },
    {
      fala: "Vale a partir do próximo pedido. Avise a equipe e clique em Sim, mudar a numeração.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        const aviso = p.getByRole("alertdialog");
        await palco.mover(aviso.getByText("próximo pedido", { exact: true }), { ms: 700 });
        await ctx.ate(0.62);
        await palco.cameraAberta({ ms: 400 });
        await palco.clicar(aviso.getByRole("button", { name: "Sim, mudar a numeração" }));
        await p.getByText("Numeração sorteada ligada").waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(1);
        await palco.destacar(p.getByRole("button", { name: /Sorteada/ }), { folga: 6 });
        await dormir(600);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para terminar",
      fala: "Pronto: sua TV já chama as senhas. Para mudar qualquer opção, é só voltar em Painel de senhas, aqui no menu.",
      acao: async (palco, ctx) => {
        const p = abas.painel;
        await palco.rolarPagina(0);
        const menu = p.getByRole("link", { name: /Painel de senhas/ }).first();
        await ctx.ate(0.45);
        await palco.destacar(menu, { folga: 4 });
        await palco.mover(menu, { ms: 900 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
