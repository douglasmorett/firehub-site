// Tutorial da tela de Impressoras (/store/impressoras).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Nada aqui imprime: o roteiro não clica em "Imprimir teste" nem
// baixa o instalador.
//
// ── O Assistente desta gravação é de mentira ───────────────────────────────
// A tela conversa com o Assistente de Impressão em http://localhost:7899 (e
// vizinhas). No computador da gravação ele não está instalado, e a tela ficaria
// o vídeo inteiro em "Desconectado", com a lista de impressoras vazia. Então o
// navegador da gravação responde no lugar dele (simularAssistente): diz que
// está aberto, na versão atual, e que o Windows tem duas impressoras fictícias.
// É o que deixa a tela mostrar o estado que o lojista vê com o Assistente
// instalado. Nenhum pedido sai da página para programa nenhum.
import { dormir } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

/** As impressoras que o "Windows" da gravação enxerga. */
const IMPRESSORAS = [
  { name: "ELGIN i9", driver: "ELGIN i9", port: "USB002", status: "Normal" },
  { name: "EPSON TM-T20X", driver: "EPSON TM-T20X Receipt5", port: "USB001", status: "Normal" },
];
/** A versão que a tela espera (VERSAO_ASSISTENTE_ATUAL em src/lib/print.ts): com outra, ela pede atualização. */
const VERSAO = "1.2.30";

/**
 * O Assistente consulta a fila de impressão da loja a cada 3 s, e é por essa
 * consulta que o painel sabe que ele está vivo. Sem ela, assim que a loja ganha
 * uma impressora o topo do painel acende a faixa "a impressão automática
 * parou". A gravação marca a consulta como recente (e renova durante o vídeo).
 */
async function preparar(prisma, { loja }) {
  await prisma.user.update({
    where: { id: loja.id },
    data: {
      printQueuePolledAt: new Date(),
      printQueueEstado: { versao: VERSAO, impressoras: IMPRESSORAS.map((i) => i.name), pendentes: 0, em: new Date().toISOString() },
    },
  });
}

async function simularAssistente(pagina, lojaId) {
  const cabecalhos = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-private-network": "true" };
  const json = (corpo) => ({ status: 200, headers: cabecalhos, contentType: "application/json", body: JSON.stringify(corpo) });
  await pagina.route(/^http:\/\/(localhost|127\.0\.0\.1):(7899|7900|7901|7891)\//, async (rota) => {
    const caminho = new URL(rota.request().url()).pathname;
    if (rota.request().method() === "OPTIONS") return rota.fulfill({ status: 204, headers: cabecalhos });
    if (caminho === "/status") {
      return rota.fulfill(json({
        ok: true, app: "FireHub-Thermal-Printer-v2", version: VERSAO, printers: IMPRESSORAS, pendentes: [],
        config: { franchiseeId: lojaId, domain: "localhost" },
      }));
    }
    if (caminho === "/printers") return rota.fulfill(json(IMPRESSORAS));
    return rota.fulfill(json({ ok: true }));
  });
}

// ── gestos desta tela ───────────────────────────────────────────────────────

/**
 * O mover do palco dá um passo a cada 16 ms e ESPERA a página responder a cada
 * um. Com a máquina ocupada (várias gravações ao mesmo tempo) um movimento de
 * 0,7 s levava 2 s, e a seta chegava depois da palavra. Este anda pelo relógio:
 * a seta chega na hora marcada, com menos passos se a página demorar. Troca só
 * o mover DESTE palco; clicar, apontar e digitar passam a usá-lo.
 */
function moverPeloRelogio(palco) {
  const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  palco.mover = async function (alvo, { ms } = {}) {
    const destino = await this.centroDe(alvo);
    const distancia = Math.hypot(destino.x - this.x, destino.y - this.y);
    const duracao = ms ?? Math.min(1100, Math.max(380, distancia * 1.5));
    const de = { x: this.x, y: this.y };
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / duracao);
      const s = suave(k);
      await this.pagina.mouse.move(de.x + (destino.x - de.x) * s, de.y + (destino.y - de.y) * s);
      if (k >= 1) break;
      await dormir(12);
    }
    this.x = destino.x;
    this.y = destino.y;
  };
}

/**
 * Rola a JANELA até o alvo ficar a `topo` pontos do alto da tela (ou até a
 * altura `y`, quando o alvo é um número). O rolarAte do palco rola a caixa de
 * rolagem mais próxima, e nesta tela quem rola é a página. Desliza em tempo
 * certo, proporcional à distância.
 */
async function rolarJanelaAte(palco, alvo, { topo = 100 } = {}) {
  const y = typeof alvo === "number"
    ? alvo
    : await alvo.evaluate((el, t) => Math.max(0, Math.round(window.scrollY + el.getBoundingClientRect().top - t)), topo);
  await palco.pagina.evaluate((alvoY) => new Promise((ok) => {
    const de = window.scrollY;
    const ms = Math.min(1000, Math.max(350, Math.abs(alvoY - de) * 0.9));
    const t0 = performance.now();
    const passo = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      window.scrollTo({ top: de + (alvoY - de) * s, behavior: "instant" });
      if (k < 1) requestAnimationFrame(passo); else ok();
    };
    requestAnimationFrame(passo);
  }), y);
  await dormir(150);
}

/** Troca o texto de um campo que já vem preenchido: clica, seleciona tudo e digita por cima. */
async function digitarPorCima(palco, campo, texto) {
  await palco.clicar(campo);
  await palco.pagina.keyboard.press("Control+A");
  await dormir(150);
  await palco.pagina.keyboard.type(texto, { delay: 85 });
  await dormir(250);
}

const cartaoDaImpressora = (p) => p.getByText("IMPRESSORA 1", { exact: true }).locator("xpath=../..");

/** Mantém "viva" a consulta do Assistente à fila enquanto o vídeo é gravado (ver preparar). */
let batimento = null;

export default {
  id: "impressoras",
  titulo: "Impressoras: o Assistente e o que cada uma imprime",
  rota: "store/impressoras",
  prontaQuando: "text=Impressoras configuradas",
  preparar,

  async antesDeGravar(palco, { prisma }) {
    moverPeloRelogio(palco);
    const loja = await prisma.user.findUnique({ where: { email: LOJA.email }, select: { id: true } });
    await simularAssistente(palco.pagina, loja.id);
    // A tela procura o Assistente quando abre: recarrega para ela achar o da gravação.
    await palco.pagina.reload({ waitUntil: "load", timeout: 120_000 });
    await palco.pagina.getByText("Conectado", { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
    await dormir(2000);
    const comeco = Date.now();
    batimento = setInterval(() => {
      if (Date.now() - comeco > 6 * 60_000) return clearInterval(batimento);
      prisma.user.update({ where: { id: loja.id }, data: { printQueuePolledAt: new Date() } }).catch(() => {});
    }, 20_000);
    batimento.unref();
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Impressoras. É aqui que você liga as impressoras da loja ao FireHub e escolhe o que cada uma imprime.",
      acao: async (palco, ctx) => {
        await dormir(700);
        await palco.mover({ x: 800, y: 380 }, { ms: 1100 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "O Assistente FireHub",
      fala: "Quem fala com as impressoras é o Assistente FireHub, um programa que fica aberto no computador da loja. Para instalar, clique em Baixar Instalador.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const baixar = p.getByRole("link", { name: /Baixar Instalador/ });
        const cartao = baixar.locator("xpath=../../..");
        await palco.camera(cartao, { zoomMax: 1.7, margem: 40 });
        await palco.mover(p.getByText("Assistente FireHub", { exact: true }), { ms: 700 });
        await ctx.ate(0.68);
        await palco.destacar(baixar, { folga: 6 });
        await palco.mover(baixar, { ms: 700 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Com ele aberto, o selo mostra Conectado e quantas impressoras ele achou neste computador.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const selo = p.getByText("Conectado", { exact: true });
        const achadas = p.getByText(/impressora\(s\) detectada\(s\) no computador/);
        await ctx.ate(0.2);
        // O bloco inteiro do estado (nome, selo, impressoras achadas e versão): destacar só as
        // duas primeiras linhas cortava a da versão ao meio.
        await palco.destacar(achadas.locator("xpath=.."), { folga: 8 });
        await palco.mover(selo, { ms: 600 });
        await ctx.ate(0.6);
        await palco.mover(achadas, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Impressão automática",
      fala: "Com a Impressão automática ligada, a comanda sai sozinha quando o pedido é aceito.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = p.getByText("Impressão automática de pedidos").locator("xpath=../../..");
        const kds = p.getByText("Imprimir só quando o KDS finalizar").locator("xpath=../../../..");
        await palco.camera([cartao, kds], { zoomMax: 1.7, margem: 60 });
        await palco.destacar(cartao, { folga: 4 });
        await palco.mover(cartao.getByRole("button"), { ms: 800 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Esta outra opção segura a comanda até a cozinha finalizar o pedido na tela do KDS. Só ligue se a sua cozinha usa essa tela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const kds = p.getByText("Imprimir só quando o KDS finalizar").locator("xpath=../../../..");
        const chave = kds.getByRole("button").first();
        await palco.mover(chave, { ms: 600 });
        await ctx.ate(0.3);
        await palco.clicar(chave, { ms: 200 });
        const aviso = p.getByText("Sua cozinha precisa usar a tela do KDS");
        await aviso.waitFor({ state: "visible", timeout: 5000 });
        await palco.camera(kds, { zoomMax: 1.7, margem: 60, ms: 500 });
        await ctx.ate(0.62);
        await palco.destacar(aviso.locator("xpath=.."), { folga: 4 });
        await ctx.ate(1);
        await dormir(200);
        await palco.apagarDestaque();
        // Volta ao padrão: a loja do vídeo não usa o KDS para imprimir.
        await palco.clicar(chave, { ms: 250 });
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Cadastrar a impressora",
      fala: "Para cadastrar, clique em Adicionar impressora. Escolha a impressora instalada no computador e dê um apelido, como Cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: /Impressoras configuradas/ });
        await rolarJanelaAte(palco, titulo, { topo: 110 });
        await ctx.ate(0.14);
        await palco.clicar(p.getByRole("button", { name: "Adicionar impressora" }));
        const cartao = cartaoDaImpressora(p);
        await cartao.waitFor({ state: "visible", timeout: 5000 });
        const lista = cartao.locator("select").first();
        const apelido = cartao.getByPlaceholder("Apelido (ex: Cozinha, Bar)");
        await palco.camera([titulo, lista], { zoomMax: 1.7, margem: 40 });
        await ctx.ate(0.4);
        await palco.destacar(lista, { folga: 5 });
        await palco.apontar(lista);
        await lista.selectOption("EPSON TM-T20X");
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await digitarPorCima(palco, apelido, "Cozinha");
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      fala: "Marque a largura da bobina e, em Número de cópias, quantas vias saem por pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const bobina = cartao.getByText("LARGURA DA BOBINA (PAPEL)");
        const botoes = [cartao.getByRole("button", { name: /POS 80/ }), cartao.getByRole("button", { name: /Bematech/ }), cartao.getByRole("button", { name: /POS 58/ })];
        const copias = cartao.getByText("NÚMERO DE CÓPIAS").locator("xpath=..");
        await rolarJanelaAte(palco, bobina, { topo: 190 });
        await palco.camera([bobina, copias], { zoomMax: 1.7, margem: 40, ms: 600 });
        await palco.destacar(botoes, { folga: 5 });
        await palco.mover(botoes[0], { ms: 600 });
        await ctx.ate(0.5);
        await palco.destacar(copias, { folga: 1 });
        await palco.mover(copias.getByRole("button", { name: "+" }), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "De onde vem o pedido",
      fala: "Aqui você diz de onde vêm os pedidos desta impressora: Balcão e mesa, Delivery e retirada, ou os dois.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const bloco = cartao.getByText("QUANDO ESTA IMPRESSORA IMPRIME").locator("xpath=..");
        const balcao = bloco.getByRole("button", { name: /Balcão e mesa/ });
        const delivery = bloco.getByRole("button", { name: /Delivery e retirada/ });
        await rolarJanelaAte(palco, bloco, { topo: 250 });
        await palco.camera(bloco, { zoomMax: 1.7, margem: 40, ms: 600 });
        await ctx.ate(0.5);
        await palco.destacar(balcao, { folga: 4 });
        await palco.mover(balcao, { ms: 500 });
        await ctx.ate(0.72);
        await palco.destacar(delivery, { folga: 4 });
        await palco.mover(delivery, { ms: 500 });
        await ctx.ate(0.9);
        await palco.destacar([balcao, delivery], { folga: 4 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No Modelo de comanda, a cozinha pode usar o modelo Cozinha sem valores, que sai sem nenhum preço.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const modelo = cartao.locator("select.input-field");
        const bloco = modelo.locator("xpath=..");
        await rolarJanelaAte(palco, bloco, { topo: 250 });
        await palco.camera(bloco, { zoomMax: 1.7, margem: 40, ms: 600 });
        await ctx.ate(0.3);
        await palco.destacar(modelo, { folga: 5 });
        await palco.apontar(modelo);
        const semValores = await modelo.locator("option").evaluateAll((os) => os.find((o) => o.textContent.includes("Cozinha sem valores"))?.value);
        await modelo.selectOption(semValores);
        await ctx.ate(0.7);
        const confirma = bloco.getByText(/Esta impressora imprime sem valores/);
        await confirma.waitFor({ state: "visible", timeout: 5000 });
        await palco.destacar(confirma, { folga: 1 });
        await palco.mover(confirma, { ms: 500 });
        await ctx.ate(1);
        await dormir(350);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Bebida, motoboy e mesa",
      fala: "Com Pedido só de bebida marcado, a impressora recebe o pedido que é todo bebida, e ele não sai nas outras.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const bebida = cartao.getByRole("button", { name: /Pedido só de bebida/ });
        const conta = cartao.getByRole("button", { name: /Imprimir a conta da mesa/ });
        await rolarJanelaAte(palco, bebida, { topo: 130 });
        await palco.camera([bebida, conta], { zoomMax: 1.5, margem: 30, ms: 600 });
        await palco.destacar(bebida, { folga: 4 });
        await palco.mover(bebida, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Via do entregador imprime, em todo delivery da loja, uma via completa para o motoboy. E Imprimir a conta da mesa escolhe onde sai a conta que o garçom pede.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const via = cartao.getByRole("button", { name: /Via do entregador no delivery/ });
        const conta = cartao.getByRole("button", { name: /Imprimir a conta da mesa/ });
        await palco.destacar(via, { folga: 4 });
        await palco.mover(via, { ms: 600 });
        await ctx.ate(0.56);
        await palco.destacar(conta, { folga: 4 });
        await palco.mover(conta, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Categorias",
      fala: "Por último, as categorias. Marque o que esta impressora recebe: a da cozinha fica com Lanches, Pizzas e Porções. Sem nenhuma marcada, ela recebe todas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const bloco = cartao.getByText("CATEGORIAS QUE ESTA IMPRESSORA RECEBE").locator("xpath=..");
        const categoria = (nome) => bloco.getByRole("button", { name: new RegExp(`${nome}$`) });
        await rolarJanelaAte(palco, bloco, { topo: 300 });
        await palco.camera(bloco, { zoomMax: 1.8, margem: 50, ms: 600 });
        await ctx.ate(0.42);
        await palco.clicar(categoria("Lanches"), { ms: 450 });
        await ctx.ate(0.54);
        await palco.clicar(categoria("Pizzas"), { ms: 350 });
        await ctx.ate(0.66);
        await palco.clicar(categoria("Porções"), { ms: 350 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Testar e salvar",
      fala: "Imprimir teste manda uma comanda de teste para conferir. Terminou, clique em Salvar configurações.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = cartaoDaImpressora(p);
        const teste = cartao.getByRole("button", { name: "Imprimir teste" });
        const salvar = cartao.getByRole("button", { name: "Salvar configurações" });
        await rolarJanelaAte(palco, teste, { topo: 330 });
        await palco.camera([teste.locator("xpath=.."), salvar], { zoomMax: 1.7, margem: 50, ms: 600 });
        await palco.destacar(teste, { folga: 5 });
        await palco.mover(teste, { ms: 600 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(salvar);
        await cartao.getByRole("button", { name: /Salvo/ }).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
        await dormir(500);
      },
    },
    {
      fala: "Lá em cima, o quadro O que imprime onde resume quais impressoras atendem cada tipo de pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const quadro = p.getByRole("heading", { name: /O que imprime onde/ }).locator("xpath=..");
        await palco.cameraAberta({ ms: 400 });
        await rolarJanelaAte(palco, quadro, { topo: 200 });
        await palco.camera(quadro, { zoomMax: 1.7, margem: 40, ms: 600 });
        await palco.destacar(quadro, { folga: 4 });
        const impressoras = quadro.getByText("Cozinha", { exact: false });
        await ctx.ate(0.55);
        await palco.mover(impressoras.first(), { ms: 600 });
        await ctx.ate(0.8);
        await palco.mover(impressoras.last(), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        // Volta ao alto da página: o botão da próxima cena mora lá.
        await palco.cameraAberta({ ms: 400 });
        await rolarJanelaAte(palco, 0);
      },
    },
    {
      capitulo: "O modelo da comanda",
      fala: "Em Personalizar impressão você monta o modelo da comanda: desliga o que não quer, muda a ordem e confere ao lado como sai no papel.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const link = p.getByRole("link", { name: /Personalizar impressão/ });
        await palco.destacar(link, { folga: 6 });
        await palco.mover(link, { ms: 600 });
        await ctx.ate(0.2);
        await palco.apagarDestaque();
        await Promise.all([p.waitForURL(/impressoras\/comanda/, { timeout: 30_000 }), palco.clicar(link, { ms: 200 })]);
        const papel = p.getByText(/^COMO VAI SAIR/);
        await papel.waitFor({ state: "visible", timeout: 30_000 });
        // Página nova: a seta desenhada renasce fora da tela até o mouse se mexer.
        await p.mouse.move(palco.x - 1, palco.y);
        await p.mouse.move(palco.x, palco.y);
        await rolarJanelaAte(palco, p.getByRole("tab", { name: "Blocos" }), { topo: 70 });
        await ctx.ate(0.52);
        await palco.mover(p.locator('input[type="checkbox"]').first(), { ms: 600 });
        await ctx.ate(0.66);
        await palco.mover(p.getByTitle("Descer").first(), { ms: 450 });
        await ctx.ate(0.8);
        await palco.destacar(papel.locator("xpath=.."), { folga: 4 });
        const folha = await papel.locator("xpath=..").boundingBox();
        await palco.mover({ x: folha.x + folha.width / 2, y: 400 }, { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso, cada comanda sai na impressora certa. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        if (batimento) clearInterval(batimento);
        const p = palco.pagina;
        await rolarJanelaAte(palco, 0);
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
