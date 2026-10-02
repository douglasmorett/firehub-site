// Produz um tutorial do começo ao fim: semeia a loja fictícia, gera a voz,
// grava a tela seguindo o roteiro e monta o vídeo.
//
//   node tutoriais/produzir.mjs pedidos              vídeo completo
//   node tutoriais/produzir.mjs pedidos --rascunho   sem voz (rápido e de graça), para acertar os movimentos
//   node tutoriais/produzir.mjs pedidos --so-montar  remonta com a gravação que já existe (mudou só a câmera/legenda)
//
// Se a tela mudou e um botão do roteiro não existe mais, a gravação PARA e diz
// em qual cena — é o aviso de que aquele tutorial ficou velho.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { abrirNavegador, entrar, Palco, BASE, dormir, definirTela, TELA } from "./motor/palco.mjs";
import { narrar } from "./motor/narrar.mjs";
import { montar } from "./motor/montar.mjs";
import { banco, semear, LOJA } from "./ambiente/semente.mjs";

const id = process.argv[2];
const rascunho = process.argv.includes("--rascunho");
const soMontar = process.argv.includes("--so-montar");
if (!id) {
  console.error("Uso: node tutoriais/produzir.mjs <roteiro> [--rascunho|--so-montar]");
  process.exit(2);
}
const roteiro = (await import(pathToFileURL(path.join(process.cwd(), "tutoriais", "roteiros", `${id}.mjs`)).href)).default;
definirTela(roteiro.tela);
const pasta = path.join(process.cwd(), "tutoriais", "saida", id);
fs.mkdirSync(pasta, { recursive: true });

const escapar = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A plaquinha do capítulo, desenhada pelo próprio navegador (fonte e cantos certos) com fundo transparente. */
async function desenharLetreiro(navegador, numero, titulo, destino) {
  const contexto = await navegador.newContext({ viewport: { width: 900, height: 120 }, deviceScaleFactor: 1 });
  const pagina = await contexto.newPage();
  await pagina.setContent(`<body style="margin:0;background:transparent"><div id="l" style="display:inline-flex;align-items:center;gap:10px;padding:9px 16px 9px 10px;border-radius:12px;background:rgba(17,24,39,.93);color:#fff;font:600 17px 'Segoe UI',system-ui,sans-serif;white-space:nowrap">
    <span style="display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:7px;background:#EA580C;font-size:13px;font-weight:800">${numero}</span>${escapar(titulo)}</div></body>`);
  await pagina.locator("#l").screenshot({ path: destino, omitBackground: true });
  await contexto.close();
}

if (!soMontar) {
  // ── 1. voz ──
  const vozes = [];
  for (const [i, cena] of roteiro.cenas.entries()) {
    if (!cena.fala) { vozes.push(null); continue; }
    if (rascunho) {
      vozes.push({ arquivo: null, ms: Math.round((cena.fala.split(/\s+/).length / 2.6) * 1000) });
      continue;
    }
    const v = await narrar(cena.fala, { pronuncia: roteiro.pronuncia });
    console.log(`voz ${String(i + 1).padStart(2)}: ${(v.ms / 1000).toFixed(1)} s ${v.novo ? `(nova · ${v.conferencia})` : "(guardada)"}`);
    vozes.push(v);
  }

  // ── 2. loja fictícia do zero ──
  const prisma = banco();
  const base = await semear(prisma);
  // Cada tela pede os seus dados (mesas abertas, produto com opção, caixa com movimento):
  // o roteiro acrescenta por cima da loja-base, sem mexer na semente dos outros.
  if (roteiro.preparar) await roteiro.preparar(prisma, base);

  // ── 3. gravação ──
  const navegador = await abrirNavegador();
  try {
    const letreiros = [];
    let numero = 0;
    for (const cena of roteiro.cenas) {
      if (!cena.capitulo) continue;
      numero++;
      const arquivo = `letreiro-${numero}.png`;
      await desenharLetreiro(navegador, numero, cena.capitulo, path.join(pasta, arquivo));
      letreiros.push({ cena, arquivo });
    }

    const estado = await entrar(navegador, LOJA);
    const palco = await Palco.abrir(navegador, { estado, pastaDosQuadros: path.join(pasta, "quadros") });
    const erros = [];
    palco.pagina.on("pageerror", (e) => erros.push(String(e).slice(0, 200)));
    palco.pagina.on("dialog", (d) => { erros.push(`janela do navegador: ${d.message().slice(0, 120)}`); d.dismiss().catch(() => {}); });
    // "Rede parada" nunca chega numa tela que consulta pedidos o tempo todo: a
    // prova de que a tela carregou é um elemento dela, que o roteiro informa.
    await palco.pagina.goto(`${BASE}/${roteiro.rota}`, { waitUntil: "load", timeout: 180_000 });
    await palco.pagina.locator(roteiro.prontaQuando).first().waitFor({ state: "visible", timeout: 120_000 });
    await dormir(2500);
    const contexto = { prisma, vozes, BASE };
    if (roteiro.antesDeGravar) await roteiro.antesDeGravar(palco, contexto);

    await palco.gravar();
    const cenas = [];
    for (const [i, cena] of roteiro.cenas.entries()) {
      const inicio = palco.agora();
      const voz = vozes[i];
      const ms = voz?.ms ?? 0;
      const ctx = {
        ...contexto, ms, inicio,
        /** Espera até uma fração da fala desta cena (0 a 1) — é como o gesto encontra a palavra. */
        ate: async (fracao) => { const falta = inicio + ms * fracao - palco.agora(); if (falta > 0) await dormir(falta); },
      };
      try {
        if (cena.acao) await cena.acao(palco, ctx);
      } catch (e) {
        await palco.pagina.screenshot({ path: path.join(pasta, "falha.png") }).catch(() => {});
        throw new Error(`Cena ${i + 1}${cena.capitulo ? ` (${cena.capitulo})` : ""} — "${(cena.fala || "").slice(0, 50)}…": ${e.message}\n(foto em ${path.join(pasta, "falha.png")})`);
      }
      const falta = inicio + ms + (cena.pausa ?? 450) - palco.agora();
      if (falta > 0) await dormir(falta);
      cenas.push({ inicio, fim: palco.agora(), fala: cena.fala || null, audio: voz?.arquivo || null, ms, capitulo: cena.capitulo || null });
    }
    const fita = await palco.pararDeGravar();
    fs.writeFileSync(path.join(pasta, "gravacao.json"), JSON.stringify({
      ...fita, cenas, tela: TELA,
      camera: palco.pedidosDeCamera || [],
      sons: palco.sons || [],
      letreiros: letreiros.map((l) => ({ arquivo: l.arquivo, t: cenas[roteiro.cenas.indexOf(l.cena)].inicio + 350 })),
    }), "utf8");
    console.log(`gravado: ${(fita.fim - fita.inicio) / 1000} s, ${fita.quadros.length} quadros`);
    if (erros.length) console.log("avisos da página durante a gravação:", [...new Set(erros)]);
  } finally {
    await navegador.close();
    await prisma.$disconnect();
  }
}

// ── 4. montagem ──
const { destino, ficha, bytes } = await montar(pasta, { id: roteiro.id, titulo: roteiro.titulo });
console.log(`\n${destino}\n${Math.floor(ficha.duracao / 60)}min${String(ficha.duracao % 60).padStart(2, "0")}s · ${(bytes / 1_048_576).toFixed(1)} MB · ${ficha.capitulos.length} capítulos`);
