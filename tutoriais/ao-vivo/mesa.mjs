// A "mesa" das gravações ao vivo: mãos no Windows (controle.ps1) e a câmera
// que grava a tela de verdade (ffmpeg gdigrab). Diferente do palco
// (motor/palco.mjs), que fotografa só a PÁGINA: aqui aparece o navegador
// inteiro — a barra de endereço, o quebra-cabeça das extensões, o ícone fixado
// e a janelinha da extensão —, que é o que o vídeo de instalação precisa.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

export class Maos {
  constructor() {
    this.ps = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(aqui, "controle.ps1")], { stdio: ["pipe", "pipe", "inherit"] });
    this.fila = [];
    readline.createInterface({ input: this.ps.stdout }).on("line", (linha) => {
      const espera = this.fila.shift();
      if (!espera) return;
      try { espera.ok(JSON.parse(linha.replace(/^﻿/, ""))); } catch (e) { espera.falha(new Error(`resposta estranha do controle: ${linha}`)); }
    });
  }
  pedir(cmd) {
    return new Promise((ok, falha) => {
      this.fila.push({ ok, falha });
      this.ps.stdin.write(JSON.stringify(cmd) + "\n");
    });
  }
  async mover(x, y, ms = 600) { await this.pedir({ cmd: "mover", x: Math.round(x), y: Math.round(y), ms }); this.x = x; this.y = y; }
  async clicar(x, y, ms) {
    if (x !== undefined) await this.mover(x, y, ms);
    await dormir(150);
    await this.pedir({ cmd: "clicar" });
    await dormir(250);
  }
  async rolar(delta) { await this.pedir({ cmd: "rolar", delta }); }
  async digitar(texto, ms = 85) { await this.pedir({ cmd: "digitar", texto, ms }); }
  async tecla(nome) { await this.pedir({ cmd: "tecla", nome }); }
  /** Retângulo de um elemento do navegador pelo nome (acessibilidade do Windows). */
  async achar(nome, opcoes = {}) {
    const r = await this.pedir({ cmd: "achar", nome, ...opcoes });
    if (!r.ok) throw new Error(r.erro || `não achei ${nome}`);
    return r;
  }
  async esperarAchar(nome, opcoes = {}, ms = 15000) {
    const fim = Date.now() + ms;
    let ultimo;
    while (Date.now() < fim) {
      const r = await this.pedir({ cmd: "achar", nome, ...opcoes });
      if (r.ok) return r;
      ultimo = r.erro;
      await dormir(300);
    }
    throw new Error(ultimo || `não achei ${nome}`);
  }
  async listar(opcoes) { return (await this.pedir({ cmd: "listar", ...opcoes })).itens || []; }
  async direito(x, y, ms) {
    if (x !== undefined) await this.mover(x, y, ms);
    await dormir(150);
    await this.pedir({ cmd: "direito" });
    await dormir(250);
  }
  /** Atalho de teclado pelos códigos do Windows: Ctrl=17, Shift=16, N=78, B=66, 0=48. */
  async atalho(...vks) { await this.pedir({ cmd: "atalho", vks }); }
  async janelas(pid) { return (await this.pedir({ cmd: "janelas", pid })).janelas || []; }
  async posicionar(hwnd, { x, y, w, h }) { await this.pedir({ cmd: "posicionar", hwnd, x, y, w, h }); }
  /** Campos de texto da janela, com o valor (os minutos da tabela do iFood). */
  async cor(x, y) { const r = await this.pedir({ cmd: "cor", x: Math.round(x), y: Math.round(y) }); return { r: r.r, g: r.g, b: r.b }; }
  async valores(hwnd) { return (await this.pedir({ cmd: "valores", hwnd })).campos || []; }
  fechar() { try { this.ps.stdin.end(); this.ps.kill(); } catch {} }
}

export const centro = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Grava um retângulo da tela (coordenadas do Windows) num .mkv, a 30 quadros por segundo. */
export function gravarTela({ x, y, w, h }, arquivo) {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "1",
    "-offset_x", String(x), "-offset_y", String(y), "-video_size", `${w}x${h}`, "-i", "desktop",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", arquivo,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  // O gdigrab leva uns 250 ms para entregar o primeiro quadro: é o zero do vídeo.
  const inicio = Date.now() + 250;
  const terminou = new Promise((ok) => ff.on("close", ok));
  return {
    inicio,
    agora: () => Date.now() - inicio,
    parar: async () => { ff.stdin.write("q"); await terminou; },
  };
}
