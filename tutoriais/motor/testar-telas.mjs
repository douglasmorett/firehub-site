// Prova que cada tela abre o SEU vídeo pelo botão Tutorial, inclusive as telas que cobrem a
// barra do topo (tela cheia da cozinha, Roteirização) e as seções de Minha loja pela âncora.
//
// Uso:  eval "$(node tutoriais/ambiente/ambiente.mjs variaveis 1)" && node tutoriais/motor/testar-telas.mjs
import { chromium } from "playwright";
import { LOJA } from "../ambiente/semente.mjs";

const B = process.env.TUTORIAL_BASE || "http://localhost:3131";
const CASOS = [
  ["store", "Um passeio pelo painel"],
  ["store/pedidos-clientes", "Como usar a tela de Pedidos"],
  ["store/kds", "Como usar a tela da cozinha"],
  ["store/mesas", "Como usar as Mesas"],
  ["store/venda-presencial", "Como vender no balcão", ["Como abrir e fechar o caixa"]],
  ["store/caixa/historico", "Como abrir e fechar o caixa"],
  ["store/cardapio", "Cardápio: cadastrar e editar um produto", ["Cardápio: preço promocional e preço por canal"]],
  ["store/fiscal", null],
  ["store/minha-loja#entrega", "Taxa de entrega"],
  ["store/minha-loja#pagamento", "Formas de pagamento"],
  ["store/estoque", null],
  ["store/funcionarios", "Fiado"],
  ["store/roteirizacao", "Roteirização"],
];

let falhas = 0;
const confere = (nome, ok, det) => { if (!ok) falhas++; console.log(`${ok ? "OK    " : "FALHOU"} ${nome}${ok ? "" : " → " + JSON.stringify(det)}`); };

const navegador = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await navegador.newContext({ viewport: { width: 1366, height: 768 } });
const p = await ctx.newPage();
await p.goto(`${B}/login`, { waitUntil: "load", timeout: 180_000 });
await p.fill("input[type=email], input[name=email]", LOJA.email);
await p.fill("input[type=password]", LOJA.senha);
await p.locator("button[type=submit]").first().click();
await p.waitForURL(/\/store/, { timeout: 120_000 });

for (const [rota, titulo, outros = []] of CASOS) {
  await p.goto(`${B}/${rota}`, { waitUntil: "load", timeout: 180_000 });
  await p.waitForTimeout(rota.includes("roteirizacao") ? 6000 : 3500);
  // Como o lojista: um primeiro clique num canto vazio libera o som e tira a faixa "som bloqueado",
  // que na tela de Pedidos cobre a barra do topo até alguém clicar.
  await p.mouse.click(1355, 300);
  await p.waitForTimeout(400);
  // O botão que se vê: entre os que existem, o que não está coberto por outra camada.
  const botoes = p.getByRole("button", { name: /^Tutorial/ });
  const n = await botoes.count();
  let clicado = false;
  for (let i = n - 1; i >= 0 && !clicado; i--) {
    const b = botoes.nth(i);
    const c = await b.boundingBox().catch(() => null);
    if (!c) continue;
    const noTopo = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") || "", [c.x + c.width / 2, c.y + c.height / 2]);
    if (!/^Tutorial/.test(noTopo)) continue;
    await b.click();
    clicado = true;
  }
  if (!titulo) {
    confere(`${rota}: abre um vídeo`, clicado, { botoes: n });
    if (clicado) await p.keyboard.press("Escape");
    continue;
  }
  const janela = p.getByRole("dialog");
  await janela.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const nome = await janela.first().getAttribute("aria-label").catch(() => null);
  confere(`${rota}: abre "${titulo}"`, clicado && (nome || "").includes(titulo), { botoes: n, abriu: nome });
  for (const outro of outros) {
    confere(`${rota}: oferece também "${outro}"`, (await janela.getByRole("button", { name: new RegExp(outro.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).count()) > 0);
  }
  const tocando = await p.evaluate(() => new Promise((ok) => setTimeout(() => {
    const v = document.querySelector(".fh-tutorial-video");
    ok(v ? { tempo: v.currentTime, erro: v.error?.message || null } : null);
  }, 2500)));
  confere(`${rota}: vídeo toca`, tocando && tocando.tempo > 0.5 && !tocando.erro, tocando);
  await p.keyboard.press("Escape");
}

// a tela cheia da cozinha abre pelo link "Abrir Tela" do KDS
await p.goto(`${B}/store/kds`, { waitUntil: "load", timeout: 180_000 });
await p.waitForTimeout(2500);
const href = await p.locator('a[href*="/store/kds/tela"]').first().getAttribute("href").catch(() => null);
if (href) {
  await p.goto(new URL(href, B).href, { waitUntil: "load", timeout: 180_000 });
  await p.waitForTimeout(3500);
  const b = p.getByRole("button", { name: /^Tutorial/ });
  const c = await b.last().boundingBox().catch(() => null);
  confere("tela cheia da cozinha: botão Tutorial visível no cabeçalho", !!c && c.y < 80, c);
} else {
  confere("tela cheia da cozinha: link encontrado (cadastre uma tela de KDS)", false);
}

await navegador.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
