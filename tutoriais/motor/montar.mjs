// A montagem: quadros capturados + narração → o vídeo final e seus acompanhantes.
//
// Sai da pasta do tutorial:
//   video.mp4      H.264 + AAC, 1366×768, 30 qps, começa a tocar antes de baixar inteiro
//   capa.jpg       a imagem parada que o player mostra antes do play
//   legendas.vtt   o texto do roteiro no tempo certo (loja barulhenta assiste sem som)
//   tutorial.json  título, duração e capítulos — é o que o painel lê
//
// ── A câmera é feita aqui, não na gravação ─────────────────────────────────
// A tela é capturada inteira, com o dobro de pontos. A aproximação ("olhe este
// cartão") é um recorte que desliza sobre esses quadros. Assim a página nunca
// é distorcida para caber no vídeo, e mudar o enquadramento não exige regravar.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import sharp from "sharp";

export const SAIDA = { largura: 1366, altura: 768, qps: 30 };
const suave = (t) => t * t * (3 - 2 * t);

/** Converte a lista de pedidos de câmera em estados { zoom, cx, cy } com hora de início e fim. */
function trilhaDaCamera(pedidos, L, A) {
  const inteiro = { zoom: 1, cx: L / 2, cy: A / 2 };
  const trilha = [];
  const estadoEm = (t) => {
    let e = inteiro;
    for (const k of trilha) {
      if (t < k.t) break;
      const f = k.ms <= 0 ? 1 : Math.min(1, (t - k.t) / k.ms);
      const s = suave(f);
      e = { zoom: k.de.zoom + (k.para.zoom - k.de.zoom) * s, cx: k.de.cx + (k.para.cx - k.de.cx) * s, cy: k.de.cy + (k.para.cy - k.de.cy) * s };
    }
    return e;
  };
  for (const p of [...pedidos].sort((a, b) => a.t - b.t)) {
    let para = inteiro;
    if (p.alvo) {
      const margem = p.margem ?? 36;
      const zoom = Math.max(1, Math.min(p.zoomMax ?? 1.6, L / (p.alvo.w + margem * 2), A / (p.alvo.h + margem * 2)));
      const meiaL = L / zoom / 2, meiaA = A / zoom / 2;
      para = {
        zoom,
        cx: Math.min(L - meiaL, Math.max(meiaL, p.alvo.x + p.alvo.w / 2)),
        cy: Math.min(A - meiaA, Math.max(meiaA, p.alvo.y + p.alvo.h / 2)),
      };
    }
    trilha.push({ t: p.t, ms: p.ms ?? 750, de: estadoEm(p.t), para });
  }
  return estadoEm;
}

const hora = (ms) => {
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60, r = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
};

/** Quebra a fala em blocos de legenda de até ~84 caracteres, sem cortar no meio de frase curta. */
function blocosDeLegenda(fala) {
  const frases = fala.replace(/\s+/g, " ").trim().split(/(?<=[.!?:;])\s+/);
  const blocos = [];
  for (const frase of frases) {
    if (frase.length <= 84) { blocos.push(frase); continue; }
    let linha = "";
    for (const pedaco of frase.split(/(?<=,)\s+/)) {
      if (linha && (linha + " " + pedaco).length > 84) { blocos.push(linha); linha = pedaco; }
      else linha = linha ? `${linha} ${pedaco}` : pedaco;
    }
    if (linha) blocos.push(linha);
  }
  return blocos;
}

function escreverLegendas(cenas, destino) {
  let vtt = "WEBVTT\n\n";
  for (const c of cenas) {
    if (!c.fala || !c.ms) continue;
    const blocos = blocosDeLegenda(c.fala);
    const total = blocos.reduce((n, b) => n + b.length, 0);
    let t = c.inicio;
    for (const b of blocos) {
      const dura = (c.ms * b.length) / total;
      vtt += `${hora(t)} --> ${hora(t + dura)}\n${b}\n\n`;
      t += dura;
    }
  }
  fs.writeFileSync(destino, vtt, "utf8");
}

// O mesmo aviso sonoro da tela de pedidos (880 Hz → 1100 Hz, três vezes).
const SOM_DE_PEDIDO_NOVO =
  "aevalsrc='0.22*(sin(2*PI*880*mod(t,0.7))*exp(-15*mod(t,0.7))*lt(mod(t,0.7),0.3)+sin(2*PI*1100*(mod(t,0.7)-0.15))*exp(-13*(mod(t,0.7)-0.15))*between(mod(t,0.7),0.15,0.5))':d=2.1:s=48000";

export async function montar(pasta, { id, titulo }) {
  const g = JSON.parse(fs.readFileSync(path.join(pasta, "gravacao.json"), "utf8"));
  // Gravação de celular (o app do motoboy) sai em pé, no tamanho do aparelho com o dobro de pontos:
  // L e A são o tamanho da tela gravada (as contas da câmera), OL e OA o do vídeo.
  const L = g.tela?.width ?? SAIDA.largura, A = g.tela?.height ?? SAIDA.altura, { qps } = SAIDA;
  const fator = g.tela?.celular ? 2 : 1;
  const OL = Math.round(L * fator / 2) * 2, OA = Math.round(A * fator / 2) * 2;
  const duracao = g.fim - g.inicio;
  const totalDeQuadros = Math.ceil((duracao / 1000) * qps);
  const quadros = g.quadros.map((q) => ({ ...q, t: q.quando - g.inicio })).sort((a, b) => a.t - b.t);
  const primeiro = await sharp(path.join(pasta, "quadros", quadros[0].nome)).metadata();
  const escala = primeiro.width / L; // 2 quando a captura veio com o dobro de pontos
  const camera = trilhaDaCamera(g.camera || [], L, A);

  // ── entradas do ffmpeg ──
  const entradas = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${OL}x${OA}`, "-r", String(qps), "-i", "pipe:0"];
  const filtros = [];
  let n = 1;
  let video = "[0:v]";
  for (const [i, letreiro] of (g.letreiros || []).entries()) {
    entradas.push("-loop", "1", "-framerate", String(qps), "-t", "3.4", "-i", path.join(pasta, letreiro.arquivo));
    filtros.push(`[${n}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=3.0:d=0.4:alpha=1,setpts=PTS+${(letreiro.t / 1000).toFixed(3)}/TB[l${i}]`);
    filtros.push(`${video}[l${i}]overlay=x=28:y=H-h-28:eof_action=pass[v${i}]`);
    video = `[v${i}]`;
    n++;
  }
  filtros.push(`${video}format=yuv420p[vfinal]`);

  const vozes = [];
  for (const [i, c] of g.cenas.entries()) {
    if (!c.audio) continue;
    entradas.push("-i", c.audio);
    filtros.push(`[${n}:a]adelay=${Math.round(c.inicio)}:all=1[a${i}]`);
    vozes.push(`[a${i}]`);
    n++;
  }
  for (const [i, s] of (g.sons || []).entries()) {
    entradas.push("-f", "lavfi", "-i", SOM_DE_PEDIDO_NOVO);
    filtros.push(`[${n}:a]adelay=${Math.round(s.t)}:all=1[s${i}]`);
    vozes.push(`[s${i}]`);
    n++;
  }
  if (!vozes.length) {
    // Rascunho sem voz: trilha muda, para o arquivo ter o mesmo formato do vídeo final.
    entradas.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono");
    filtros.push(`[${n}:a]anull[afinal]`);
  } else {
    filtros.push(`${vozes.join("")}amix=inputs=${vozes.length}:normalize=0:dropout_transition=0,apad[afinal]`);
  }

  const roteiroDoFiltro = path.join(pasta, "filtro.txt");
  fs.writeFileSync(roteiroDoFiltro, filtros.join(";\n"), "utf8");
  const destino = path.join(pasta, "video.mp4");
  const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error", ...entradas, "-/filter_complex", roteiroDoFiltro, // o filtro vem de arquivo (ffmpeg 7 em diante)
    "-map", "[vfinal]", "-map", "[afinal]",
    // Tela de sistema comprime bem: CRF 26 mantém a letra nítida e o arquivo abaixo de ~10 MB por 3 min.
    "-c:v", "libx264", "-preset", "slow", "-crf", process.env.TUTORIAL_CRF || "26", "-profile:v", "high", "-g", String(qps * 4),
    "-c:a", "aac", "-b:a", "80k", "-ar", "48000", "-ac", "1",
    "-t", (duracao / 1000).toFixed(3), "-movflags", "+faststart", destino,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  ffmpeg.stdin.on("error", () => {}); // se o ffmpeg cair, o erro que interessa é o código de saída dele
  const terminou = new Promise((ok, falha) => {
    ffmpeg.on("close", (codigo) => (codigo === 0 ? ok() : falha(new Error(`ffmpeg saiu com ${codigo}`))));
    ffmpeg.on("error", falha);
  });

  // ── quadro a quadro ──
  let fonte = 0, ultimaChave = "", ultimo = null;
  for (let i = 0; i < totalDeQuadros; i++) {
    const t = (i / qps) * 1000;
    while (fonte + 1 < quadros.length && quadros[fonte + 1].t <= t) fonte++;
    const c = camera(t);
    const larg = Math.round((L / c.zoom) * escala), alt = Math.round((A / c.zoom) * escala);
    const esq = Math.max(0, Math.min(primeiro.width - larg, Math.round((c.cx - L / c.zoom / 2) * escala)));
    const topo = Math.max(0, Math.min(primeiro.height - alt, Math.round((c.cy - A / c.zoom / 2) * escala)));
    const chave = `${fonte}|${esq}|${topo}|${larg}`;
    if (chave !== ultimaChave) {
      ultimo = await sharp(path.join(pasta, "quadros", quadros[fonte].nome))
        .extract({ left: esq, top: topo, width: larg, height: alt })
        .resize(OL, OA, { kernel: "lanczos3", fit: "fill" })
        .removeAlpha().raw().toBuffer();
      ultimaChave = chave;
    }
    if (!ffmpeg.stdin.write(ultimo)) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
    if (i % 600 === 0) process.stdout.write(`   montando ${Math.round((i / totalDeQuadros) * 100)}%\r`);
  }
  ffmpeg.stdin.end();
  await terminou;

  // ── acompanhantes ──
  const capaEm = Math.min(duracao / 1000 - 0.5, g.capaEm != null ? g.capaEm / 1000 : 1.6);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", capaEm.toFixed(2), "-i", destino, "-frames:v", "1", "-q:v", "3", path.join(pasta, "capa.jpg")]);
  escreverLegendas(g.cenas, path.join(pasta, "legendas.vtt"));
  const capitulos = g.cenas.filter((c) => c.capitulo).map((c) => ({ em: Math.round(c.inicio / 100) / 10, titulo: c.capitulo }));
  const ficha = { id, titulo, duracao: Math.round(duracao / 1000), capitulos, ...(g.tela?.celular ? { emPe: true } : {}), geradoEm: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(path.join(pasta, "tutorial.json"), JSON.stringify(ficha, null, 2), "utf8");
  return { destino, ficha, bytes: fs.statSync(destino).size };
}
