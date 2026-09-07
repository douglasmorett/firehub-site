#!/usr/bin/env node
/**
 * Harness da fila da nuvem: um servidor HTTP local finge ser o FireHub (GET
 * print-queue + POST ack) e o Assistente, com APPDATA isolado e
 * FIREHUB_FILA_BASE apontando para ca, consome a fila. Verifica:
 *   - a consulta leva v/pendentes/porta/impressoras (User.printQueueEstado);
 *   - job "so bebidas" sem bebida => skipped (ok) => confirmado (ack);
 *   - job em impressora inexistente => pendente => SEM ack, pendentes=1;
 *   - job ja no cache local de "ja impresso" => duplicated (ok) => ack.
 * Nao imprime nada: nenhum destino chega a mandar bytes para impressora real.
 *
 *   node scripts/teste-fila.js
 */
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER = path.join(__dirname, "..", "server.js");
const APPDATA = path.join(os.tmpdir(), "firehub-assistente-teste", "appdata-fila");
fs.rmSync(APPDATA, { recursive: true, force: true });
fs.mkdirSync(path.join(APPDATA, "FireHub"), { recursive: true });
fs.writeFileSync(path.join(APPDATA, "FireHub", "config.json"), JSON.stringify({ franchiseeId: "loja_teste_fila", domain: "firehubfood.com.br", printer: "", printers: [] }));
// J3 ja "impresso" nesta maquina: entra no cache de 48 h antes de o Assistente subir.
fs.writeFileSync(path.join(APPDATA, "FireHub", "printed-cache.json"), JSON.stringify([["pos-80::id_ped_j3", Date.now()]]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const ok = (nome, cond, detalhe = "") => { resultados.push({ nome, ok: !!cond }); console.log(`${cond ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

const item = (name) => ({ name, qty: 1, price: 5 });
const pedido = (id, num) => ({ id, dailyOrderNumber: String(num), customerName: "Fila Teste", deliveryType: "RETIRADA", paymentMethod: "Pix", items: [item("Pastel de carne")], totalAmount: 5, createdAt: new Date().toISOString() });
const jobs = [
  { id: "job_ped_j1", order: pedido("ped_j1", 1), storeName: "FILA", paperWidth: "80mm",
    destinos: [{ printer: "POS-80", copies: 1, paperWidth: "80mm", somenteBebidas: true, items: [item("Pastel de carne")] }] },
  { id: "job_ped_j2", order: pedido("ped_j2", 2), storeName: "FILA", paperWidth: "80mm",
    destinos: [{ printer: "NAO_EXISTE_FIREHUB", copies: 1, paperWidth: "80mm", somenteBebidas: false, items: [item("Pastel de carne")] }] },
  { id: "job_ped_j3", order: pedido("ped_j3", 3), storeName: "FILA", paperWidth: "80mm",
    destinos: [{ printer: "POS-80", copies: 1, paperWidth: "80mm", somenteBebidas: false, items: [item("Pastel de carne")] }] },
];

const consultas = [];
const acks = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname === "/api/store/print-queue") {
    consultas.push(Object.fromEntries(u.searchParams.entries()));
    const confirmados = new Set(acks.flatMap((a) => a.ids));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jobs: jobs.filter((j) => !confirmados.has(j.id)) }));
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/store/print-queue/ack") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => { try { acks.push(JSON.parse(body)); } catch {} res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true })); });
    return;
  }
  res.statusCode = 404; res.end("{}");
});

(async () => {
  try { await fetch("http://127.0.0.1:7899/status", { signal: AbortSignal.timeout(800) }); console.error("Porta 7899 ocupada: feche o Assistente instalado antes de rodar o harness."); process.exit(2); } catch {}
  await new Promise((r) => mock.listen(9911, "127.0.0.1", r));
  const log = [];
  const p = spawn(process.execPath, [SERVER], { cwd: path.dirname(SERVER), env: { ...process.env, APPDATA, FIREHUB_FILA_BASE: "http://127.0.0.1:9911" }, windowsHide: true });
  p.stdout.on("data", (d) => log.push(String(d)));
  p.stderr.on("data", (d) => log.push(String(d)));

  // ~14 s: quatro rodadas de 3 s, tempo para J2 falhar e o ack ir na rodada seguinte.
  await sleep(14000);

  ok("o Assistente consultou a fila local", consultas.length >= 2, `${consultas.length} consultas`);
  const q = consultas[consultas.length - 1] || {};
  ok("query leva v (versao do package.json)", /^\d+\.\d+\.\d+$/.test(q.v || ""), `v=${q.v}`);
  ok("query leva porta e impressoras", q.porta === "7899" && typeof q.impressoras === "string");
  ok("query informa pendentes=1 (J2 preso)", q.pendentes === "1", `pendentes=${q.pendentes}`);
  const idsConfirmados = new Set(acks.flatMap((a) => a.ids));
  ok("ack chegou com o franchiseeId da loja", acks.length > 0 && acks.every((a) => a.franchiseeId === "loja_teste_fila"), `${acks.length} ack(s)`);
  ok("J1 (so bebidas, sem bebida => skipped) foi confirmado", idsConfirmados.has("job_ped_j1"));
  ok("J3 (ja no cache local => duplicated) foi confirmado", idsConfirmados.has("job_ped_j3"));
  ok("J2 (impressora inexistente => pendente) NAO foi confirmado", !idsConfirmados.has("job_ped_j2"));
  ok("nenhum rawPrint OK no log (nada foi para impressora real)", !/\[Print\] OK ->/.test(log.join("")));
  ok("sem erro de programa no log", !/TypeError|ReferenceError|SyntaxError/.test(log.join("")));

  p.kill();
  mock.close();
  await sleep(300);
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificacoes OK`);
  if (falhas.length) console.log("\n--- log ---\n" + log.join("").slice(-2500));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS QUEBROU:", e); process.exit(2); });
