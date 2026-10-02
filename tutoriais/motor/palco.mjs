// O palco da gravação: um navegador sem janela, um cursor desenhado e a
// captura dos quadros.
//
// ── Por que o cursor é desenhado ────────────────────────────────────────────
// Navegador automatizado não tem ponteiro: o clique acontece e nada aparece na
// imagem. Aqui uma seta acompanha cada movimento do mouse e uma onda marca o
// clique, que é o que deixa o lojista ver ONDE se clica.
//
// ── Por que capturar quadro a quadro ────────────────────────────────────────
// O gravador embutido do Playwright sai com taxa fixa e letra borrada. A
// captura pelo protocolo do Chrome (screencast) entrega cada quadro com o
// horário exato em que foi pintado: a letra fica nítida e a narração encaixa
// no ponto certo, porque fala e imagem usam o mesmo relógio.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fusoDaNoite } from "../ambiente/relogio.mjs";

export const BASE = process.env.TUTORIAL_BASE || "http://localhost:3121";
/** 1366×768 é a tela mais comum no computador de balcão. */
export const TELA = { width: 1366, height: 768 };
/** Captura com o dobro de pontos: é o que deixa a aproximação da câmera nítida. */
export const DENSIDADE = 2;

const CHROME = process.env.TUTORIAL_CHROME
  || "C:/Users/Micro/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";

export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function abrirNavegador() {
  return chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  });
}

/** Entra no painel uma vez e devolve a sessão, para a gravação já começar na tela. */
export async function entrar(navegador, { email, senha }) {
  const contexto = await navegador.newContext({ viewport: TELA });
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180_000 });
  await pagina.locator("input[type=password]").waitFor({ state: "visible", timeout: 120_000 });
  await pagina.fill('input[type=email], input[name=email]', email);
  await pagina.fill('input[type=password]', senha);
  await pagina.locator('button[type=submit]').first().click();
  await pagina.waitForURL(/\/store/, { timeout: 120_000 });
  const estado = await contexto.storageState();
  await contexto.close();
  return estado;
}

// Roda dentro da página, antes de qualquer script dela.
function desenharCursor() {
  const montar = () => {
    if (document.getElementById("tutorial-cursor")) return;
    const estilo = document.createElement("style");
    estilo.textContent = `
      #tutorial-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
      .tutorial-onda{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;z-index:2147483646;
        pointer-events:none;background:rgba(234,88,12,.35);border:2px solid rgba(234,88,12,.9);
        animation:tutorial-onda .55s ease-out forwards}
      @keyframes tutorial-onda{to{transform:scale(4.2);opacity:0}}
      #tutorial-foco{position:fixed;z-index:2147483645;pointer-events:none;border-radius:12px;opacity:0;
        box-shadow:0 0 0 3px rgba(234,88,12,.95),0 0 0 9999px rgba(15,23,42,.42);
        transition:left .35s ease,top .35s ease,width .35s ease,height .35s ease,opacity .25s ease}
      #tutorial-foco.aceso{opacity:1}
      nextjs-portal{display:none !important}
    `;
    document.documentElement.appendChild(estilo);
    const seta = document.createElement("div");
    seta.id = "tutorial-cursor";
    seta.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 20 L9 15.5 L12.2 22.5 L15 21.2 L11.8 14.4 L18.5 14.2 Z" fill="#111827" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(seta);
    const foco = document.createElement("div");
    foco.id = "tutorial-foco";
    document.documentElement.appendChild(foco);
    window.addEventListener("mousemove", (e) => {
      seta.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`;
    }, true);
    // Durante um arrastar-e-soltar o navegador não manda mousemove; quem dá a posição é o dragover.
    window.addEventListener("dragover", (e) => {
      seta.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`;
    }, true);
    window.addEventListener("mousedown", (e) => {
      const onda = document.createElement("div");
      onda.className = "tutorial-onda";
      onda.style.left = `${e.clientX}px`;
      onda.style.top = `${e.clientY}px`;
      document.documentElement.appendChild(onda);
      setTimeout(() => onda.remove(), 600);
    }, true);
  };
  if (document.documentElement) montar();
  document.addEventListener("DOMContentLoaded", montar);

  // Links que a tela monta com o endereço de onde o painel está aberto (cardápio,
  // app do motoboy, link do garçom) sairiam como "localhost:3131" — endereço que
  // nenhum lojista vê. Na imagem entra o endereço do site de verdade; o que a
  // página guarda e copia não muda.
  const SITE = "https://firehubfood.com.br";
  const LOCAL = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g;
  const SEM_PROTOCOLO = /(^|[^/\w])(localhost|127\.0\.0\.1)(:\d+)?(?=\/)/g;
  const limpar = (t) => t.replace(LOCAL, SITE).replace(SEM_PROTOCOLO, "$1firehubfood.com.br");
  const varrer = (raiz) => {
    if (!raiz) return;
    const andarilho = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = andarilho.nextNode(); n; n = andarilho.nextNode()) {
      if (n.nodeValue && n.nodeValue.includes("localhost") || (n.nodeValue || "").includes("127.0.0.1")) {
        const novo = limpar(n.nodeValue);
        if (novo !== n.nodeValue) n.nodeValue = novo;
      }
    }
    for (const campo of document.querySelectorAll("input, textarea")) {
      if (campo.value && /localhost|127\.0\.0\.1/.test(campo.value)) campo.value = limpar(campo.value);
    }
  };
  setInterval(() => varrer(document.body), 150);
}

const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Palco {
  constructor(pagina, pastaDosQuadros) {
    this.pagina = pagina;
    this.pasta = pastaDosQuadros;
    this.x = TELA.width / 2;
    this.y = TELA.height / 2;
    this.quadros = [];
    this.inicio = null;
  }

  static async abrir(navegador, { estado, pastaDosQuadros }) {
    const contexto = await navegador.newContext({
      viewport: TELA, deviceScaleFactor: DENSIDADE, storageState: estado,
      permissions: ["notifications"], locale: "pt-BR", timezoneId: fusoDaNoite(),
    });
    await contexto.addInitScript(desenharCursor);
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(30_000);
    return new Palco(pagina, pastaDosQuadros);
  }

  // ── captura ──────────────────────────────────────────────────────────────
  async gravar() {
    fs.rmSync(this.pasta, { recursive: true, force: true });
    fs.mkdirSync(this.pasta, { recursive: true });
    this.cdp = await this.pagina.context().newCDPSession(this.pagina);
    this.cdp.on("Page.screencastFrame", (q) => {
      const nome = `${String(this.quadros.length + 1).padStart(6, "0")}.jpg`;
      fs.writeFileSync(path.join(this.pasta, nome), Buffer.from(q.data, "base64"));
      this.quadros.push({ nome, quando: q.metadata.timestamp * 1000 });
      this.cdp.send("Page.screencastFrameAck", { sessionId: q.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: TELA.width * DENSIDADE, maxHeight: TELA.height * DENSIDADE, everyNthFrame: 2 });
    // Um movimento mínimo força o primeiro quadro: tela parada não pinta nada.
    await this.pagina.mouse.move(this.x, this.y);
    await dormir(250);
    this.inicio = Date.now();
    return this.inicio;
  }

  /** Milissegundos desde o começo do vídeo. */
  agora() {
    return Date.now() - this.inicio;
  }

  async pararDeGravar() {
    await dormir(200);
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    return { inicio: this.inicio, fim: Date.now(), quadros: this.quadros };
  }

  // ── gestos ───────────────────────────────────────────────────────────────
  async centroDe(alvo) {
    if (typeof alvo.x === "number") return alvo;
    const c = await alvo.boundingBox();
    if (!c) throw new Error("Elemento do roteiro não está na tela — a tela mudou? Ajuste o roteiro e regrave.");
    const ponto = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
    // Nada de rolar escondido: a rolagem tem que aparecer no vídeo (rolarAte), senão a tela "pula".
    if (ponto.x < 0 || ponto.y < 0 || ponto.x > TELA.width || ponto.y > TELA.height) {
      throw new Error(`O alvo está fora da área visível (${Math.round(ponto.x)}, ${Math.round(ponto.y)}) — chame rolarAte antes.`);
    }
    return ponto;
  }

  /** Leva a seta até o alvo num movimento de mão, não de teletransporte. */
  async mover(alvo, { ms } = {}) {
    const destino = await this.centroDe(alvo);
    const distancia = Math.hypot(destino.x - this.x, destino.y - this.y);
    const duracao = ms ?? Math.min(1100, Math.max(380, distancia * 1.5));
    // Pelo relógio, não por número de passos: com a captura ligada e a máquina ocupada cada
    // passo custa 40–60 ms em vez de 16, e um gesto de 700 ms levava 2 s e estourava a fala.
    const de = { x: this.x, y: this.y };
    const comeco = Date.now();
    for (;;) {
      const f = Math.min(1, (Date.now() - comeco) / duracao);
      const k = suave(f);
      await this.pagina.mouse.move(de.x + (destino.x - de.x) * k, de.y + (destino.y - de.y) * k);
      if (f >= 1) break;
      await dormir(12);
    }
    this.x = destino.x;
    this.y = destino.y;
  }

  async clicar(alvo, opcoes = {}) {
    await this.mover(alvo, opcoes);
    await dormir(180);
    await this.pagina.mouse.down();
    await dormir(70);
    await this.pagina.mouse.up();
    await dormir(250);
  }

  /** Escurece o resto e contorna o alvo: "é disto que estou falando". */
  async destacar(alvo, { folga = 6 } = {}) {
    const caixas = [];
    for (const a of Array.isArray(alvo) ? alvo : [alvo]) {
      const c = await a.boundingBox();
      if (c) caixas.push(c);
    }
    if (!caixas.length) throw new Error("Elemento a destacar não está na tela — a tela mudou?");
    const x1 = Math.min(...caixas.map((c) => c.x)) - folga;
    const y1 = Math.min(...caixas.map((c) => c.y)) - folga;
    const x2 = Math.max(...caixas.map((c) => c.x + c.width)) + folga;
    const y2 = Math.max(...caixas.map((c) => c.y + c.height)) + folga;
    await this.pagina.evaluate(([x, y, l, a]) => {
      const f = document.getElementById("tutorial-foco");
      if (!f) return;
      f.style.left = `${x}px`; f.style.top = `${y}px`; f.style.width = `${l}px`; f.style.height = `${a}px`;
      f.classList.add("aceso");
    }, [x1, y1, x2 - x1, y2 - y1]);
    await dormir(380);
  }

  async apagarDestaque() {
    await this.pagina.evaluate(() => document.getElementById("tutorial-foco")?.classList.remove("aceso"));
    await dormir(280);
  }

  esperar(ms) {
    return dormir(ms);
  }

  /** Leva a seta e mostra a onda do clique SEM clicar — para lista nativa (select), que não aparece na captura. */
  async apontar(alvo, opcoes = {}) {
    await this.mover(alvo, opcoes);
    await dormir(150);
    await this.pagina.evaluate(([x, y]) => {
      const onda = document.createElement("div");
      onda.className = "tutorial-onda";
      onda.style.left = `${x}px`;
      onda.style.top = `${y}px`;
      document.documentElement.appendChild(onda);
      setTimeout(() => onda.remove(), 600);
    }, [this.x, this.y]);
    await dormir(300);
  }

  /**
   * Rola devagar a caixa de rolagem MAIS PRÓXIMA do alvo (a coluna, a janela
   * aberta) até ele aparecer — e só ela: scrollIntoView rola todos os ancestrais
   * de uma vez e a tela inteira escorregava junto. Se não há caixa de rolagem
   * por perto, quem rola é a página.
   */
  async rolarAte(alvo, { bloco = "center" } = {}) {
    await alvo.evaluate((el, b) => {
      let rolo = el.parentElement;
      while (rolo && rolo !== document.body && rolo !== document.documentElement) {
        const estilo = getComputedStyle(rolo);
        if (/(auto|scroll)/.test(estilo.overflowY) && rolo.scrollHeight > rolo.clientHeight + 4) break;
        rolo = rolo.parentElement;
      }
      if (!rolo || rolo === document.body || rolo === document.documentElement) {
        // Nenhuma caixa de rolagem por perto: quem rola é a própria página (Fiscal, Impressoras, Minha loja).
        const r = el.getBoundingClientRect();
        const passo = b === "end" ? r.bottom - innerHeight + 24
          : b === "start" ? r.top - 90
          : r.top + r.height / 2 - innerHeight / 2;
        window.scrollBy({ top: passo, behavior: "smooth" });
        return;
      }
      const r = el.getBoundingClientRect(), c = rolo.getBoundingClientRect();
      const passo = b === "end" ? r.bottom - c.bottom + 14
        : b === "start" ? r.top - c.top - 14
        : r.top + r.height / 2 - (c.top + c.height / 2);
      rolo.scrollTo({ top: rolo.scrollTop + passo, behavior: "smooth" });
    }, bloco);
    await this.esperarRolagemParar(alvo);
  }

  /**
   * Espera o alvo parar de se mexer na tela. Tempo fixo não serve: com a máquina
   * ocupada a rolagem suave passa de 750 ms, e o destaque seguinte media o alvo
   * no meio do caminho e contornava o vizinho.
   */
  async esperarRolagemParar(alvo, { maximo = 3000 } = {}) {
    const limite = Date.now() + maximo;
    let antes = null, parado = 0;
    await dormir(120);
    while (Date.now() < limite) {
      const c = alvo ? await alvo.boundingBox().catch(() => null) : await this.pagina.evaluate(() => ({ y: window.scrollY }));
      const agora = c ? Math.round(c.y) : null;
      parado = agora !== null && agora === antes ? parado + 1 : 0;
      if (parado >= 3) return;
      antes = agora;
      await dormir(70);
    }
  }

  async rolarPagina(y) {
    await this.pagina.evaluate((alvoY) => window.scrollTo({ top: alvoY, behavior: "smooth" }), y);
    await this.esperarRolagemParar(null);
  }

  /** Digita como gente: letra por letra. */
  async digitar(alvo, texto) {
    await this.clicar(alvo);
    // Uma letra a cada ~90 ms pelo relógio: tecla por tecla, com a máquina ocupada, custava 0,5 s por letra.
    const comeco = Date.now();
    for (const [i, letra] of [...texto].entries()) {
      await this.pagina.keyboard.insertText(letra);
      const falta = comeco + (i + 1) * 90 - Date.now();
      if (falta > 0) await dormir(falta);
    }
    await dormir(300);
  }

  /** Segura no ponto de origem e arrasta até o destino (arrastar e soltar de verdade). */
  async arrastar(origem, destino) {
    const de = await this.centroDe(origem);
    const para = await this.centroDe(destino);
    await this.mover(de);
    await dormir(200);
    await this.pagina.mouse.down();
    await dormir(150);
    const comeco = Date.now(), duracao = 1100;
    for (;;) {
      const f = Math.min(1, (Date.now() - comeco) / duracao);
      const k = suave(f);
      await this.pagina.mouse.move(de.x + (para.x - de.x) * k, de.y + (para.y - de.y) * k);
      if (f >= 1) break;
      await dormir(14);
    }
    this.x = para.x;
    this.y = para.y;
    await dormir(350);
    await this.pagina.mouse.up();
    await dormir(400);
  }

  // ── câmera e som: só anotam a hora; quem aplica é a montagem ────────────
  async retangulo(alvo) {
    const caixas = [];
    for (const a of Array.isArray(alvo) ? alvo : [alvo]) {
      const c = typeof a.x === "number" ? a : await a.boundingBox();
      if (c) caixas.push(c);
    }
    if (!caixas.length) throw new Error("Elemento para a câmera não está na tela — a tela mudou?");
    const x = Math.min(...caixas.map((c) => c.x)), y = Math.min(...caixas.map((c) => c.y));
    const x2 = Math.max(...caixas.map((c) => c.x + c.width)), y2 = Math.max(...caixas.map((c) => c.y + c.height));
    return { x, y, w: x2 - x, h: y2 - y };
  }

  /** Aproxima a câmera do alvo (um elemento, vários, ou um retângulo). */
  async camera(alvo, { zoomMax = 1.6, margem = 36, ms = 750 } = {}) {
    this.pedidosDeCamera ??= [];
    this.pedidosDeCamera.push({ t: this.agora(), alvo: await this.retangulo(alvo), zoomMax, margem, ms });
    await dormir(ms);
  }

  /** Volta a mostrar a tela inteira. */
  async cameraAberta({ ms = 750 } = {}) {
    this.pedidosDeCamera ??= [];
    this.pedidosDeCamera.push({ t: this.agora(), alvo: null, ms });
    await dormir(ms);
  }

  som(tipo = "pedido-novo") {
    this.sons ??= [];
    this.sons.push({ t: this.agora(), tipo });
  }
}
