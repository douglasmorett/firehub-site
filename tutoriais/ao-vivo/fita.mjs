// A fita das gravações ao vivo: grava a área da tela, marca o começo de cada
// cena (com a voz já pronta) e os pedidos de câmera, e no fim entrega tudo ao
// montador de sempre (motor/montar.mjs) — mesmas legendas, capítulos, placas e
// capa dos outros tutoriais.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { gravarTela, dormir } from "./mesa.mjs";
import { AREA } from "./janelas.mjs";
import { montar } from "../motor/montar.mjs";

export class Fita {
  constructor(pasta, nome) {
    this.pasta = pasta;
    this.nome = nome;
    this.arquivo = path.join(pasta, `captura-${nome}.mkv`);
    this.cenas = [];
    this.pedidosDeCamera = [];
  }
  async comecar() {
    fs.mkdirSync(this.pasta, { recursive: true });
    this.gravacao = gravarTela(AREA, this.arquivo);
    await dormir(600);
  }
  agora() { return this.gravacao.agora(); }
  /** Aproxima a câmera de um retângulo da tela (coordenadas do Windows, dentro da AREA). */
  camera(alvo, { zoomMax = 1.6, margem = 36, ms = 750 } = {}) {
    this.pedidosDeCamera.push({ t: this.agora(), alvo: { x: alvo.x - AREA.x, y: alvo.y - AREA.y, w: alvo.w, h: alvo.h }, zoomMax, margem, ms });
  }
  cameraAberta(ms = 600) { this.pedidosDeCamera.push({ t: this.agora(), alvo: null, ms }); }
  /** Uma cena: a voz começa agora; `acao(ctx)` faz os gestos, com ctx.ate(fração) para cair na palavra. */
  async cena(def, voz, acao, { pausa = 450, esperarDepois } = {}) {
    const inicio = this.agora();
    const ms = voz?.ms ?? 0;
    const ctx = { ms, inicio, ate: async (f) => { const falta = inicio + ms * f - this.agora(); if (falta > 0) await dormir(falta); } };
    await acao(ctx);
    const falta = inicio + ms + pausa - this.agora();
    if (falta > 0) await dormir(falta);
    if (esperarDepois) await esperarDepois();
    this.cenas.push({ inicio, fim: this.agora(), fala: def.fala, audio: voz?.arquivo || null, ms, capitulo: def.capitulo || null });
  }
  async parar() {
    await dormir(400);
    const fim = this.agora();
    await this.gravacao.parar();
    const dados = { nome: this.nome, arquivo: this.arquivo, fim, cenas: this.cenas, camera: this.pedidosDeCamera };
    fs.writeFileSync(path.join(this.pasta, `fita-${this.nome}.json`), JSON.stringify(dados, null, 2), "utf8");
    return dados;
  }
}

const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export async function desenharLetreiro(navegador, numero, titulo, destino) {
  const contexto = await navegador.newContext({ viewport: { width: 900, height: 120 }, deviceScaleFactor: 1 });
  const pagina = await contexto.newPage();
  await pagina.setContent(`<body style="margin:0;background:transparent"><div id="l" style="display:inline-flex;align-items:center;gap:10px;padding:9px 16px 9px 10px;border-radius:12px;background:rgba(17,24,39,.93);color:#fff;font:600 17px 'Segoe UI',system-ui,sans-serif;white-space:nowrap">
    <span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:7px;background:#EA580C;font-size:13px;font-weight:800">${numero}</span>${escapar(titulo)}</div></body>`);
  await pagina.locator("#l").screenshot({ path: destino, omitBackground: true });
  await contexto.close();
}

/**
 * Junta as partes gravadas (na ordem) num vídeo só. Cada parte vira quadros
 * na pasta `quadros`, com o relógio contínuo; as cenas e a câmera de cada
 * parte andam junto. Depois é o montador de sempre.
 */
export async function montarAoVivo(pasta, partes, { id, titulo }) {
  const quadrosDir = path.join(pasta, "quadros");
  fs.rmSync(quadrosDir, { recursive: true, force: true });
  fs.mkdirSync(quadrosDir, { recursive: true });
  const quadros = [], cenas = [], camera = [];
  let deslocamento = 0;
  for (const parte of partes) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", parte.arquivo, "-vf", "fps=30", "-q:v", "2", path.join(quadrosDir, `${parte.nome}_%06d.jpg`)]);
    const nomes = fs.readdirSync(quadrosDir).filter((n) => n.startsWith(`${parte.nome}_`)).sort();
    nomes.forEach((nome, i) => quadros.push({ nome, quando: deslocamento + (i * 1000) / 30 }));
    for (const c of parte.cenas) cenas.push({ ...c, inicio: c.inicio + deslocamento, fim: c.fim + deslocamento });
    for (const k of parte.camera) camera.push({ ...k, t: k.t + deslocamento });
    deslocamento += Math.min(parte.fim, (nomes.length * 1000) / 30);
  }
  const navegador = await chromium.launch();
  const letreiros = [];
  let numero = 0;
  for (const c of cenas) {
    if (!c.capitulo) continue;
    numero++;
    const arquivo = `letreiro-${numero}.png`;
    await desenharLetreiro(navegador, numero, c.capitulo, path.join(pasta, arquivo));
    letreiros.push({ arquivo, t: c.inicio + 350 });
  }
  await navegador.close();
  fs.writeFileSync(path.join(pasta, "gravacao.json"), JSON.stringify({
    inicio: 0, fim: deslocamento, quadros, cenas, tela: { width: AREA.w, height: AREA.h }, camera, sons: [], letreiros,
  }), "utf8");
  return montar(pasta, { id, titulo });
}
