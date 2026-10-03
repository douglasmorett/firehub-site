// Parte A: a instalação pela Chrome Web Store, num Chrome de verdade com perfil
// limpo. Começa na tela Extensão iFood da loja de teste (porta 3000), clica em
// "Abrir na Chrome Web Store", instala e mostra o ícone de fogo e o alfinete.
//
//   node tutoriais/ao-vivo/gravar-a.mjs     (a loja de teste tem de estar no ar: servidor.mjs subir)
import fs from "node:fs";
import path from "node:path";
import { abrirNavegador, pidDoPerfil, pontoDe } from "./janelas.mjs";
import { Maos, dormir, centro } from "./mesa.mjs";
import { Fita } from "./fita.mjs";
import { CENAS_A, PRONUNCIA, ID } from "./falas.mjs";
import { narrar } from "../motor/narrar.mjs";

const PASTA = path.resolve("tutoriais/saida", ID);
const PERFIL = "C:/Users/Micro/tutoriais-teste/perfil-instalar";
fs.rmSync(PERFIL, { recursive: true, force: true });
// Sem o balão "Salvar senha?" do Chrome por cima da página (o login da loja de
// teste é preenchido antes de gravar).
fs.mkdirSync(path.join(PERFIL, "Default"), { recursive: true });
fs.writeFileSync(path.join(PERFIL, "Default", "Preferences"), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }));

const vozes = [];
for (const c of CENAS_A) vozes.push(await narrar(c.fala, { pronuncia: PRONUNCIA }));

const contexto = await abrirNavegador(PERFIL, { chrome: true });
const painel = contexto.pages()[0] || await contexto.newPage();
await painel.goto("http://localhost:3000/login", { waitUntil: "load" });
await painel.fill("input[type=email], input[name=email]", "demo@tutorial.local");
await painel.fill("input[type=password]", "tutorial123");
await painel.locator("button[type=submit]").first().click();
await painel.waitForURL(/\/store/, { timeout: 120_000 });
const nao = painel.getByRole("button", { name: "Já vi, não mostrar mais" });
if (await nao.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) await nao.click();
await painel.goto("http://localhost:3000/store/extensao-ifood", { waitUntil: "load" });
await painel.addStyleTag({ content: ".fh-tutorial-faixa{display:none!important}" });
const abrirLoja = painel.getByRole("link", { name: /Abrir na Chrome Web Store/ });
await abrirLoja.waitFor({ state: "visible", timeout: 30_000 });
await abrirLoja.evaluate((el) => el.scrollIntoView({ block: "center" }));
await dormir(1500);

const pid = pidDoPerfil("perfil-instalar");
const maos = new Maos();
// Um clique num canto vazio da página tira o foco (e a seleção azul) da barra de endereço.
const vazio = await pontoDe(painel, painel.getByText("Configure uma vez", { exact: false }).first());
await maos.clicar(vazio.x + 260, vazio.y - 40, 200);
await maos.mover(800, 520, 300);
await dormir(500);
const fita = new Fita(PASTA, "a");
await fita.comecar();
let loja;
let icone, quebraCabeca;
try {
  await fita.cena(CENAS_A[0], vozes[0], async (ctx) => {
    await ctx.ate(0.5);
    const pt = await pontoDe(painel, abrirLoja);
    fita.camera(pt.caixa, { zoomMax: 1.7, margem: 120 });
    await maos.mover(pt.x, pt.y, 900);
    await ctx.ate(0.9);
    const nova = contexto.waitForEvent("page");
    await maos.clicar();
    loja = await nova;
    await loja.waitForLoadState("load");
    fita.cameraAberta();
  });

  await fita.cena(CENAS_A[1], vozes[1], async (ctx) => {
    const usar = loja.getByRole("button", { name: "Usar no Chrome" }).first();
    await usar.waitFor({ state: "visible", timeout: 30_000 });
    await dormir(800);
    await ctx.ate(0.3);
    const pt = await pontoDe(loja, usar);
    await maos.clicar(pt.x, pt.y, 800);
    const adicionar = await maos.esperarAchar("Adicionar extensão", { pid, tipo: "Button" });
    fita.camera({ x: adicionar.x - 420, y: adicionar.y - 170, w: 640, h: 240 }, { zoomMax: 1.8, margem: 30 });
    await ctx.ate(0.75);
    const c = centro(adicionar);
    await maos.clicar(c.x, c.y, 700);
  });

  await fita.cena(CENAS_A[2], vozes[2], async (ctx) => {
    await maos.esperarAchar("foi adicionada ao Chrome", { pid });
    icone = await maos.esperarAchar("FireHub — Prazo Automático de Entrega", { pid, tipo: "Button", exato: true });
    quebraCabeca = await maos.achar("Extensões", { pid, tipo: "Button", exato: true });
    fita.camera({ x: icone.x - 330, y: 30, w: 520, h: 250 }, { zoomMax: 2.2, margem: 20 });
    await ctx.ate(0.35);
    let c = centro(icone);
    await maos.mover(c.x, c.y, 700);
    await ctx.ate(0.75);
    c = centro(quebraCabeca);
    await maos.mover(c.x, c.y, 500);
  });

  await fita.cena(CENAS_A[3], vozes[3], async (ctx) => {
    await ctx.ate(0.25);
    const c = centro(quebraCabeca);
    await maos.clicar(c.x, c.y, 300);
    const alfinete = await maos.esperarAchar("fixar", { pid, tipo: "Button" });
    fita.camera({ x: alfinete.x - 330, y: alfinete.y - 120, w: 420, h: 260 }, { zoomMax: 2.0, margem: 20 });
    await ctx.ate(0.55);
    const a = centro(alfinete);
    await maos.mover(a.x, a.y, 700);
    await ctx.ate(0.95);
    await maos.tecla("ESC");
    fita.cameraAberta();
  });
} finally {
  const dados = await fita.parar();
  console.log(`parte A: ${(dados.fim / 1000).toFixed(1)} s, ${dados.cenas.length} cenas`);
  maos.fechar();
  await contexto.close();
}
