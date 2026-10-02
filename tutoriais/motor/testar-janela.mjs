// Prova do botão "Tutorial" e da janela do vídeo no painel local, com o Chrome de verdade
// (o Chromium do Playwright não toca H.264, e o lojista usa Chrome/Edge).
import fs from "node:fs";
import { chromium } from "playwright";

const B = process.env.TUTORIAL_BASE || "http://localhost:3121";
const F = "tutoriais/saida/_teste";
fs.mkdirSync(F, { recursive: true });
let falhas = 0;
const confere = (nome, ok, det) => { if (!ok) falhas++; console.log(`${ok ? "OK    " : "FALHOU"} ${nome}${ok ? "" : " → " + JSON.stringify(det)}`); };

const navegador = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
for (const [nome, viewport] of [["desktop", { width: 1366, height: 768 }], ["celular", { width: 390, height: 800 }]]) {
  const ctx = await navegador.newContext({ viewport });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(String(e).slice(0, 160)));
  await p.goto(`${B}/login`, { waitUntil: "load", timeout: 180_000 });
  await p.fill("input[type=email], input[name=email]", "demo@tutorial.local");
  await p.fill("input[type=password]", "tutorial123");
  await p.locator("button[type=submit]").first().click();
  await p.waitForURL(/\/store/, { timeout: 120_000 });

  // tela SEM vídeo: o botão não existe
  await p.goto(`${B}/store/estoque`, { waitUntil: "load", timeout: 180_000 });
  await p.waitForTimeout(2500);
  confere(`${nome}: tela sem vídeo não mostra o botão`, (await p.getByRole("button", { name: /^Tutorial/ }).count()) === 0);

  await p.goto(`${B}/store/pedidos-clientes`, { waitUntil: "load", timeout: 180_000 });
  const botao = p.getByRole("button", { name: /^Tutorial/ });
  await botao.waitFor({ state: "visible", timeout: 60_000 });
  const barra = await p.locator("header, nav").first().boundingBox().catch(() => null);
  const cx = await botao.boundingBox();
  confere(`${nome}: botão na barra do topo`, cx && cx.y < 260, cx);
  confere(`${nome}: bolinha de "ainda não viu"`, (await p.locator(".fh-tutorial-novo").count()) === 1);
  await p.screenshot({ path: `${F}/janela-${nome}-0-barra.png`, clip: { x: 0, y: 0, width: viewport.width, height: 130 } });

  await botao.click();
  const janela = p.getByRole("dialog", { name: "Como usar a tela de Pedidos" });
  await janela.waitFor({ state: "visible", timeout: 10_000 });
  await p.waitForTimeout(4000);
  const v = await p.evaluate(() => {
    const el = document.querySelector(".fh-tutorial-video");
    return { tempo: el.currentTime, pausado: el.paused, pronto: el.readyState, dura: el.duration, erro: el.error?.message || null,
      legenda: el.textTracks[0]?.mode, falas: el.textTracks[0]?.cues?.length || 0, larg: el.videoWidth };
  });
  confere(`${nome}: vídeo tocando`, v.tempo > 1 && !v.pausado && !v.erro, v);
  confere(`${nome}: legenda ligada e carregada`, v.legenda === "showing" && v.falas > 10, v);
  confere(`${nome}: capítulos listados`, (await janela.locator(".fh-tutorial-capitulo").count()) >= 8);
  await p.screenshot({ path: `${F}/janela-${nome}-1-aberta.png` });

  // capítulo leva ao ponto
  await janela.getByRole("button", { name: /Cancelar um pedido/ }).click();
  await p.waitForTimeout(1500);
  const t = await p.evaluate(() => document.querySelector(".fh-tutorial-video").currentTime);
  const marcado = await janela.locator('.fh-tutorial-capitulo[aria-current="true"]').innerText();
  confere(`${nome}: capítulo "Cancelar" pula o vídeo e fica marcado`, t > 60 && /Cancelar/.test(marcado), { t, marcado });
  await janela.getByRole("button", { name: "1,5x" }).click();
  confere(`${nome}: velocidade 1,5x`, (await p.evaluate(() => document.querySelector(".fh-tutorial-video").playbackRate)) === 1.5);
  await p.screenshot({ path: `${F}/janela-${nome}-2-capitulo.png` });

  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  confere(`${nome}: Esc fecha`, (await p.getByRole("dialog").count()) === 0);
  confere(`${nome}: bolinha some depois de abrir`, (await p.locator(".fh-tutorial-novo").count()) === 0);
  await p.reload({ waitUntil: "load" });
  await p.getByRole("button", { name: /^Tutorial/ }).waitFor({ state: "visible", timeout: 60_000 });
  await p.waitForTimeout(800);
  confere(`${nome}: bolinha continua sumida depois de recarregar`, (await p.locator(".fh-tutorial-novo").count()) === 0);
  confere(`${nome}: sem erro de página`, erros.length === 0, erros);
  await ctx.close();
}
await navegador.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
