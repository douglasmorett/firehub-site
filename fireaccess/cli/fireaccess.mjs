#!/usr/bin/env node
// FireAccess — CLI do atendente (Claude). Cada ação devolve a tela de depois, salva em %TEMP%.
//
//   FIREACCESS_URL=https://...   FIREACCESS_TOKEN=...
//   node fireaccess.mjs sessoes
//   node fireaccess.mjs tela     <codigo>
//   node fireaccess.mjs clicar   <codigo> <x> <y> [direito|duplo]
//   node fireaccess.mjs mover    <codigo> <x> <y>
//   node fireaccess.mjs arrastar <codigo> <x1> <y1> <x2> <y2>
//   node fireaccess.mjs digitar  <codigo> "<texto>"
//   node fireaccess.mjs tecla    <codigo> <combo>        (ex.: enter, ctrl+v, win+r, alt+f4)
//   node fireaccess.mjs rolar    <codigo> <quanto> [x y] (negativo desce)
//   node fireaccess.mjs encerrar <codigo>
//
// x/y são da imagem salva pelo último "tela" (largura até 1366).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.FIREACCESS_URL || "http://localhost:8790").replace(/\/$/, "");
const TOKEN = process.env.FIREACCESS_TOKEN;
if (!TOKEN) { console.error("Defina FIREACCESS_TOKEN."); process.exit(1); }

async function api(caminho, corpo) {
  const r = await fetch(BASE + caminho, {
    method: corpo ? "POST" : "GET",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

function salvar(codigo, r) {
  if (!r.jpeg) return;
  const arquivo = path.join(os.tmpdir(), `fireaccess-${codigo}-${Date.now()}.jpg`);
  fs.writeFileSync(arquivo, Buffer.from(r.jpeg, "base64"));
  console.log(`tela ${r.largura}x${r.altura}: ${arquivo}`);
}

const [acao, codigo, ...resto] = process.argv.slice(2);
const n = (v) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`número inválido: ${v}`); return x; };

try {
  if (acao === "sessoes") {
    const lista = await api("/sessoes");
    if (!lista.length) console.log("nenhuma sessão aberta");
    for (const s of lista) console.log(`${s.codigo}  ${s.permitido ? "PERMITIDA" : "esperando Permitir"}  ${s.maquina?.nome || "?"} (${s.maquina?.usuario || "?"})  desde ${s.desde}`);
  } else if (acao === "encerrar") {
    await api(`/sessoes/${codigo}/encerrar`, {});
    console.log("sessão encerrada");
  } else {
    if (!/^\d{6}$/.test(codigo || "")) throw new Error("informe o código de 6 dígitos");
    let comando;
    switch (acao) {
      case "tela": comando = { tipo: "tela" }; break;
      case "clicar": comando = { tipo: "clicar", x: n(resto[0]), y: n(resto[1]), botao: resto[2] === "direito" ? "direito" : "esquerdo", duplo: resto[2] === "duplo" }; break;
      case "mover": comando = { tipo: "mover", x: n(resto[0]), y: n(resto[1]) }; break;
      case "arrastar": comando = { tipo: "arrastar", x1: n(resto[0]), y1: n(resto[1]), x2: n(resto[2]), y2: n(resto[3]) }; break;
      case "digitar": comando = { tipo: "digitar", texto: resto.join(" ") }; break;
      case "tecla": comando = { tipo: "tecla", combo: resto[0] }; break;
      case "rolar": comando = { tipo: "rolar", quanto: n(resto[0]), ...(resto[1] != null ? { x: n(resto[1]), y: n(resto[2]) } : {}) }; break;
      default: throw new Error("ação desconhecida (veja o topo do arquivo)");
    }
    const r = await api(`/sessoes/${codigo}/comando`, comando);
    if (r.ok) console.log("ok");
    salvar(codigo, r);
  }
} catch (e) {
  console.error("erro:", e.message);
  process.exit(1);
}
