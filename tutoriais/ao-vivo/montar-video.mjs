// Monta "Prazo automático no iFood: instalando e vendo funcionar" com as duas
// partes gravadas ao vivo (captura-a.mkv e captura-b.mkv).
//
// A parte A entra inteira. A parte B é editada: a extensão recarrega a página
// do iFood antes e depois de cada ajuste (é assim que ela confere o que o iFood
// gravou), e cada recarga são uns 7 s de tela branca. A edição corta esses
// trechos, começa cada fala no instante da mudança que ela descreve e, quando a
// fala precisa de mais tempo que as imagens, segura o último quadro. Os
// instantes vêm da tomada de 03/10/2026 16h13 (avisos verdes do iFood em 41,6,
// 69,8, 96,0 e 121,2 s; pedidos na coluna em 48,3 e 73,4 s) — outra tomada
// pede outros números.
//
// O nome da loja no iFood e o mapa (a região dela) saem borrados.
//
//   node tutoriais/ao-vivo/montar-video.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { desenharLetreiro } from "./fita.mjs";
import { AREA } from "./janelas.mjs";
import { ID, TITULO } from "./falas.mjs";
import { montar } from "../motor/montar.mjs";

const PASTA = path.resolve("tutoriais/saida", ID);
const QPS = 30;
const lerFita = (nome) => JSON.parse(fs.readFileSync(path.join(PASTA, `fita-${nome}.json`), "utf8"));

// ── borrão na parte B (coordenadas da área gravada, 1600×900) ──
const BORRAR = [
  { x: 772, y: 90, w: 130, h: 30, raio: 10 },   // "Hakim - Centro" no topo do portal
  { x: 794, y: 320, w: 388, h: 496, raio: 20 }, // o mapa (até a pílula do FireHub)
  { x: 926, y: 816, w: 256, h: 44, raio: 20 },  // o pedaço do mapa à direita da pílula
];
function borrar(origem, destino) {
  if (fs.existsSync(destino) && fs.statSync(destino).mtimeMs > fs.statSync(origem).mtimeMs) return;
  const partes = [`[0:v]split=${BORRAR.length + 1}[base]${BORRAR.map((_, i) => `[c${i}]`).join("")}`];
  BORRAR.forEach((r, i) => {
    const cr = Math.max(1, Math.min(Math.floor(r.raio / 2), Math.floor(Math.min(r.w, r.h) / 4) - 1));
    partes.push(`[c${i}]crop=${r.w}:${r.h}:${r.x}:${r.y},boxblur=lr=${r.raio}:lp=2:cr=${cr}:cp=2[b${i}]`);
  });
  let atual = "[base]";
  BORRAR.forEach((r, i) => { partes.push(`${atual}[b${i}]overlay=${r.x}:${r.y}[o${i}]`); atual = `[o${i}]`; });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", origem, "-filter_complex", partes.join(";"), "-map", atual,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", destino]);
}

// ── a edição da parte B (segundos da gravação) ──
// Trechos que entram, na ordem. O resto é tela branca de recarga ou espera.
const PEDACOS = [[0, 31.65], [39.65, 43.65], [45.0, 49.8], [51.55, 52.6], [58.0, 58.95], [67.15, 72.0], [79.65, 83.0], [91.0, 98.25], [115.0, 123.4], [130.65, 138.4]];
// Onde cada fala começa (segundos da gravação, dentro de um pedaço).
const FALA_EM = { b1: 0.4, b2: 15.3, b3: 23.3, b4: 39.65, b5: 45.0, b6: 67.15, b7: 91.0, b8: 115.0, b9: 130.65, b10: 132.2 };
// Câmera da parte B a partir do pedaço 2 (antes vale a da gravação).
const PAINEL = { x: 1200, y: 330, w: 330, h: 500 };
const COLUNA = { x: 305, y: 312, w: 290, h: 170 };
const camera = (alvo, opcoes = {}) => ({ alvo, zoomMax: 1.6, margem: 20, ms: 700, ...opcoes });
const CAMERA_B = [
  [39.65, camera(PAINEL)],                                                    // 38 → 33 → 28 e o aviso verde
  [43.6, camera({ x: 228, y: 400, w: 288, h: 60 }, { zoomMax: 2.2, margem: 16 })], // (quadro parado) a janelinha: 2 pedidos, 28 min
  [45.0, camera(COLUNA, { zoomMax: 2, margem: 16 })],                         // chegam pedidos: 2 → 4
  [51.55, camera(PAINEL)],
  [67.15, camera(PAINEL)],                                                    // 28 → 38
  [91.0, camera(COLUNA, { zoomMax: 2, margem: 16 })],                         // seis pedidos
  [93.3, camera(PAINEL)],                                                     // 38 → 58
  [115.0, camera({ x: 20, y: 312, w: 670, h: 300 }, { zoomMax: 1.6, margem: 10 })], // cozinha vazia
  [116.6, camera(PAINEL)],                                                    // 58 → 28
  [130.65, { alvo: null, ms: 800 }],                                          // tela inteira
];
const PAUSA = 350; // entre o fim de uma fala e o começo da outra

function quadrosDe(captura, prefixo, dir) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", captura, "-vf", `fps=${QPS}`, "-q:v", "2", path.join(dir, `${prefixo}_%06d.jpg`)]);
  return fs.readdirSync(dir).filter((n) => n.startsWith(`${prefixo}_`)).sort();
}

const dir = path.join(PASTA, "quadros");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const quadros = [], cenas = [], cameraFinal = [];

// Parte A, inteira.
const fitaA = lerFita("a");
const nomesA = quadrosDe(path.join(PASTA, "captura-a.mkv"), "a", dir);
nomesA.forEach((nome, i) => quadros.push({ nome, quando: (i * 1000) / QPS }));
for (const c of fitaA.cenas) cenas.push({ ...c });
for (const k of fitaA.camera) cameraFinal.push({ ...k });
const fimA = Math.min(fitaA.fim, (nomesA.length * 1000) / QPS);

// Parte B, editada.
const fitaB = lerFita("b");
const borrada = path.join(PASTA, "captura-b-borrada.mkv");
borrar(path.join(PASTA, "captura-b.mkv"), borrada);
const nomesB = quadrosDe(borrada, "b", dir);
const falas = fitaB.cenas.map((c, i) => ({ ...c, id: `b${i + 1}` }));
const ancoras = falas.map((f) => FALA_EM[f.id]);
// Monta a linha do tempo: cada pedaço copia quadros; antes da próxima fala,
// se a anterior ainda não acabou, segura o último quadro.
let saida = fimA;            // relógio do vídeo final (ms)
let fimDaFala = 0;           // quando a última fala termina (no relógio final)
const mapa = [];             // { de, ate (s da gravação), em (ms finais) }
let proxima = 0;
for (const [de, ate] of PEDACOS) {
  let t = de;
  while (t < ate) {
    // fala que começa dentro deste pedaço?
    const f = proxima < falas.length && ancoras[proxima] >= t && ancoras[proxima] < ate ? proxima : -1;
    const limite = f >= 0 ? ancoras[f] : ate;
    if (limite > t) {
      mapa.push({ de: t, ate: limite, em: saida });
      for (let i = Math.round(t * QPS); i < Math.round(limite * QPS) && i < nomesB.length; i++) quadros.push({ nome: nomesB[i], quando: saida + (i / QPS - t) * 1000 });
      saida += (limite - t) * 1000;
      t = limite;
    }
    if (f >= 0) {
      if (saida < fimDaFala + PAUSA) saida = fimDaFala + PAUSA; // segura o último quadro
      cenas.push({ inicio: saida, fim: saida + falas[f].ms, fala: falas[f].fala, audio: falas[f].audio, ms: falas[f].ms, capitulo: falas[f].capitulo || null });
      fimDaFala = saida + falas[f].ms;
      mapa.push({ de: t, ate: t, em: saida });
      proxima++;
    }
  }
}
saida = Math.max(saida, fimDaFala + 600);
const emFinal = (s) => {
  let r = null;
  for (const m of mapa) if (s >= m.de && s <= m.ate) r = m.em + (s - m.de) * 1000;
  return r;
};
// Câmera: a da gravação até o fim do 1º pedaço, depois a editada.
for (const k of fitaB.camera) if (k.t / 1000 < PEDACOS[0][1]) cameraFinal.push({ ...k, t: fimA + k.t });
for (const [s, k] of CAMERA_B) { const t = emFinal(s); if (t !== null) cameraFinal.push({ ...k, t }); else console.warn("câmera fora dos pedaços:", s); }
// A última fala aponta o menu: a câmera da gravação (b10) vale ali.
for (const k of fitaB.camera) if (k.t / 1000 >= 132.2) { const t = emFinal(k.t / 1000); if (t !== null) cameraFinal.push({ ...k, t }); }
// Cada cena vai até a próxima (as legendas usam inicio/fim).
cenas.sort((a, b) => a.inicio - b.inicio);
cenas.forEach((c, i) => { c.fim = i + 1 < cenas.length ? cenas[i + 1].inicio : saida; });

const navegador = await chromium.launch();
const letreiros = [];
let numero = 0;
for (const c of cenas) {
  if (!c.capitulo) continue;
  numero++;
  const arquivo = `letreiro-${numero}.png`;
  await desenharLetreiro(navegador, numero, c.capitulo, path.join(PASTA, arquivo));
  letreiros.push({ arquivo, t: c.inicio + 350 });
}
await navegador.close();
fs.writeFileSync(path.join(PASTA, "gravacao.json"), JSON.stringify({
  inicio: 0, fim: saida, quadros, cenas, tela: { width: AREA.w, height: AREA.h }, camera: cameraFinal, sons: [], letreiros, capaEm: 2000,
}), "utf8");
console.log(`parte A ${(fimA / 1000).toFixed(1)} s + parte B editada → ${(saida / 1000).toFixed(1)} s`);
for (const c of cenas) console.log(`  ${(c.inicio / 1000).toFixed(1).padStart(6)} s  ${c.fala.slice(0, 60)}`);
await montar(PASTA, { id: ID, titulo: TITULO });
console.log("pronto:", path.join(PASTA, "video.mp4"));
