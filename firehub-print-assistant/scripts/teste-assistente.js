#!/usr/bin/env node
/**
 * Harness do Assistente: sobe `node server.js` com APPDATA isolado e exercita
 * o que nao da para testar de longe — trava de instancia dupla, pendente com
 * impressora inexistente, estouro de prazo (sem marcador => pendente) e, com
 * `--real NOME`, uma comanda de teste numa impressora de verdade (uma tira de
 * papel: e a unica prova de que a DLL de impressao entrega bytes ao spooler).
 *
 *   node scripts/teste-assistente.js              # sem imprimir nada
 *   node scripts/teste-assistente.js --real POS-80
 *
 * Nunca usa a fila da nuvem: o APPDATA isolado nao tem franchiseeId. Escrito
 * em 06/09/2026 junto com a 1.2.7; rode antes de gerar instalador.
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER = path.join(__dirname, "..", "server.js");
const APPDATA = path.join(os.tmpdir(), "firehub-assistente-teste", "appdata");
const REAL = (() => { const i = process.argv.indexOf("--real"); return i >= 0 ? process.argv[i + 1] : ""; })();
fs.rmSync(APPDATA, { recursive: true, force: true });
fs.mkdirSync(APPDATA, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const ok = (nome, cond, detalhe = "") => { resultados.push({ nome, ok: !!cond }); console.log(`${cond ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

function subir(envExtra = {}) {
  const log = [];
  const p = spawn(process.execPath, [SERVER], { cwd: path.dirname(SERVER), env: { ...process.env, APPDATA, ...envExtra }, windowsHide: true });
  p.stdout.on("data", (d) => log.push(String(d)));
  p.stderr.on("data", (d) => log.push(String(d)));
  p.on("exit", (code) => { p.saiuCom = code; });
  return { p, log: () => log.join("") };
}
async function esperarStatus(porta, ms = 20000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/status`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return await r.json();
    } catch {}
    await sleep(300);
  }
  return null;
}
async function portaLivre(porta) {
  try { await fetch(`http://127.0.0.1:${porta}/status`, { signal: AbortSignal.timeout(800) }); return false; } catch { return true; }
}
const pedido = (id) => ({
  id, dailyOrderNumber: "999", customerName: "Teste Harness", customerPhone: "(22) 99999-0000",
  deliveryType: "RETIRADA", paymentMethod: "Pix (Online)", isPrepaid: true,
  items: [{ name: "Item do harness", qty: 1, price: 1 }], totalAmount: 1, createdAt: new Date().toISOString(),
});
async function imprimir(porta, printer, id) {
  const r = await fetch(`http://127.0.0.1:${porta}/print`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printer, order: pedido(id), storeName: "HARNESS", copies: 1, paperWidth: "80mm" }),
    signal: AbortSignal.timeout(60000),
  });
  return { http: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  for (const porta of [7899, 7900]) {
    if (!(await portaLivre(porta))) { console.error(`Porta ${porta} ocupada: feche o Assistente instalado antes de rodar o harness.`); process.exit(2); }
  }

  // 1. instancia A sobe e responde
  const A = subir();
  const sA = await esperarStatus(7899);
  ok("A subiu na 7899", sA && sA.ok, sA ? `pid ${sA.pid} porta ${sA.porta} v${sA.version} impressoras=${sA.printers.length}` : "sem resposta");
  ok("/status traz pid/porta/iniciadoEm", sA && sA.pid === A.p.pid && sA.porta === 7899 && typeof sA.iniciadoEm === "string");

  let dll = null;
  for (let i = 0; i < 60 && !dll; i++) { await sleep(500); dll = fs.readdirSync(path.join(APPDATA, "FireHub")).find((f) => /^RawPrint-[0-9a-f]{8}\.dll$/.test(f)); }
  ok("DLL RawPrint compilada no APPDATA", !!dll, dll || A.log().split("\n").filter((l) => l.includes("DLL")).join(" | "));

  // 2. instancia B e duplicata: sobe na 7900 e sai sozinha
  const B = subir();
  await sleep(7000);
  ok("B saiu sozinha (duplicata)", B.p.saiuCom !== undefined, `exit=${B.p.saiuCom}`);
  ok("B avisou no log por que saiu", /sai para nao imprimir em dobro/.test(B.log()));
  ok("7900 ficou livre", await portaLivre(7900));
  ok("A continua de pe", (await esperarStatus(7899, 3000))?.pid === A.p.pid);

  // 3. impressora inexistente: falha rapida, vira pendente, segunda vez = aguardando
  const t0 = Date.now();
  const r1 = await imprimir(7899, "NAO_EXISTE_FIREHUB", "harness_pend_1");
  const dt = Date.now() - t0;
  ok("impressora inexistente falha (HTTP 500)", r1.http === 500, `${dt} ms`);
  ok("falha veio rapida (< 4 s)", dt < 4000, `${dt} ms`);
  const s2 = await esperarStatus(7899, 3000);
  ok("virou pendente no /status", s2 && s2.pendentes.length === 1 && s2.pendentes[0].impressora === "NAO_EXISTE_FIREHUB");
  const r2 = await imprimir(7899, "NAO_EXISTE_FIREHUB", "harness_pend_1");
  ok("mesmo pedido de novo responde aguardando", r2.body && r2.body.ok === false && r2.body.aguardando === true);
  ok("pendentes.json gravado", fs.existsSync(path.join(APPDATA, "FireHub", "pendentes.json")));

  // 4. comanda real (opcional)
  if (REAL) {
    const t1 = Date.now();
    const r3 = await imprimir(7899, REAL, `harness_real_${Date.now()}`);
    const dt3 = Date.now() - t1;
    ok(`comanda real em ${REAL} saiu (ok:true)`, r3.http === 200 && r3.body.ok === true, `${dt3} ms: ${JSON.stringify(r3.body).slice(0, 120)}`);
    ok("impressao pela DLL foi rapida (< 3 s)", dt3 < 3000, `${dt3} ms`);
    const s3 = await esperarStatus(7899, 3000);
    ok("ultimaImpressaoEm preenchido", s3 && typeof s3.ultimaImpressaoEm === "string");
  }

  // 5. estouro de prazo: sem marcador => pendente
  A.p.kill();
  await sleep(1500);
  const C = subir({ FIREHUB_PRAZO_IMPRESSAO_MS: "150" });
  const sC = await esperarStatus(7899);
  ok("C subiu (prazo de 150 ms)", sC && sC.ok);
  const r4 = await imprimir(7899, "NAO_EXISTE_FIREHUB", "harness_timeout_1");
  ok("estouro vira erro de prazo", r4.http === 500 && /nao respondeu em/.test(r4.body.error || ""));
  const s4 = await esperarStatus(7899, 3000);
  ok("estouro vira pendente (nao some)", s4 && s4.pendentes.length >= 1);
  C.p.kill();

  // 6. o script sozinho: com DLL (rapido) e sem DLL (compila em linha)
  const ps1 = path.join(os.tmpdir(), "firehub-print", "rawprint.ps1");
  const bin = path.join(os.tmpdir(), "firehub-assistente-teste", "teste.bin");
  fs.writeFileSync(bin, Buffer.from([27, 64, 72, 105, 10]));
  const dllPath = path.join(APPDATA, "FireHub", dll || "x.dll");
  for (const [rotulo, extra] of [["com DLL", `-DllPath "${dllPath}"`], ["sem DLL (inline)", ""]]) {
    const t = Date.now();
    let saida = "";
    try { saida = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}" -PrinterName "NAO_EXISTE_FIREHUB" -FilePath "${bin}" ${extra}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { saida = String(e.stderr || e.message); }
    ok(`script ${rotulo}: falha com Win32 e sem marcador`, /Win32/.test(saida) && !fs.existsSync(bin + ".ok"), `${Date.now() - t} ms`);
  }

  await sleep(500);
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificacoes OK`);
  if (falhas.length) { console.log("FALHAS:", falhas.map((f) => f.nome).join("; ")); console.log("\n--- log A ---\n" + A.log().slice(-3000)); }
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS QUEBROU:", e); process.exit(2); });
