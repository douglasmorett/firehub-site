#!/usr/bin/env node
/**
 * Harness do TETO ZERO (1.2.25, regra do dono em 24/09/2026): "abriu o
 * Assistente, nao imprime nada; so o que entrar depois. Se quiser imprimir
 * manualmente, pede."
 *
 * Sobe o Assistente de verdade (APPDATA isolado, fila apontando para um
 * servidor local) com 3 comandas presas no disco — como as 37 da BALCAO da
 * Ragnar — e verifica:
 *   - as presas da rodada anterior sao descartadas ao abrir (arquivo zerado,
 *     /status sem lista, fila informa pendentes=0);
 *   - a consulta a fila leva `abertoHaSeg` (o servidor corta por ele);
 *   - pedido AUTOMATICO do navegador criado antes da abertura nao sai;
 *   - o mesmo pedido com force (botao Imprimir) tenta sair;
 *   - pedido automatico criado DEPOIS da abertura tenta sair;
 *   - a checagem de versao leva a loja e a versao, e `pedido=1` so a mao.
 * Nao imprime nada: as tentativas vao para uma impressora que nao existe.
 *
 *   node scripts/teste-teto-zero.js
 */
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER = path.join(__dirname, "..", "server.js");
const APPDATA = path.join(os.tmpdir(), "firehub-assistente-teste", "appdata-teto-zero");
fs.rmSync(APPDATA, { recursive: true, force: true });
fs.mkdirSync(path.join(APPDATA, "FireHub"), { recursive: true });
fs.writeFileSync(path.join(APPDATA, "FireHub", "config.json"), JSON.stringify({ franchiseeId: "loja_teto_zero", domain: "firehubfood.com.br", printer: "", printers: [] }));

// Tres comandas presas da rodada anterior, no formato que o Assistente grava.
const presa = (n) => [`balcao::ped_velho_${n}`, {
  job: { printer: "BALCAO", order: { id: `ped_velho_${n}`, dailyOrderNumber: String(n), items: [{ name: "Pizza", qty: 1, price: 10 }], createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() } },
  falhas: 90, desde: Date.now() - 3 * 3600_000, naoAntesDe: 0, ultimoErro: "Falha ao enviar dados para impressora 'BALCAO' (Win32 1905)",
}];
fs.writeFileSync(path.join(APPDATA, "FireHub", "pendentes.json"), JSON.stringify([presa(1), presa(3), presa(4)]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const ok = (nome, cond, detalhe = "") => { resultados.push({ nome, ok: !!cond }); console.log(`${cond ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`); };

const consultas = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET" && u.pathname === "/api/store/print-queue") {
    consultas.push(Object.fromEntries(u.searchParams.entries()));
    res.end(JSON.stringify({ jobs: [] }));
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/store/print-queue/ack") { res.end("{}"); return; }
  res.statusCode = 404; res.end("{}");
});

const imprimir = async (order, force) => {
  const r = await fetch("http://127.0.0.1:7899/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printer: "NAO_EXISTE_FIREHUB", order, storeName: "TETO", force }),
    signal: AbortSignal.timeout(30_000),
  });
  return r.json().catch(() => ({}));
};
const pedido = (id, criadoEm) => ({ id, dailyOrderNumber: id.slice(-2), customerName: "Teto Zero", deliveryType: "RETIRADA", paymentMethod: "Pix", items: [{ name: "Pastel", qty: 1, price: 5 }], totalAmount: 5, createdAt: new Date(criadoEm).toISOString() });

(async () => {
  try { await fetch("http://127.0.0.1:7899/status", { signal: AbortSignal.timeout(800) }); console.error("Porta 7899 ocupada: feche o Assistente instalado antes de rodar o harness."); process.exit(2); } catch {}
  await new Promise((r) => mock.listen(9912, "127.0.0.1", r));
  const log = [];
  const p = spawn(process.execPath, [SERVER], { cwd: path.dirname(SERVER), env: { ...process.env, APPDATA, FIREHUB_FILA_BASE: "http://127.0.0.1:9912" }, windowsHide: true });
  p.stdout.on("data", (d) => log.push(String(d)));
  p.stderr.on("data", (d) => log.push(String(d)));

  // Tres rodadas da fila: tempo para o relogio do "servidor" ser aprendido.
  await sleep(10000);

  // 1. As presas da rodada anterior.
  const noDisco = JSON.parse(fs.readFileSync(path.join(APPDATA, "FireHub", "pendentes.json"), "utf8"));
  ok("pendentes.json zerado ao abrir", Array.isArray(noDisco) && noDisco.length === 0, `${noDisco.length} no disco`);
  const status = await (await fetch("http://127.0.0.1:7899/status")).json();
  ok("/status sem lista de presas (o painel limpa)", Array.isArray(status.pendentes) && status.pendentes.length === 0, `${(status.pendentes || []).length} na lista`);
  ok("o log conta o que foi descartado", /3 comanda\(s\) presa\(s\) da rodada anterior descartada/.test(log.join("")));

  // 2. A consulta a fila.
  const q = consultas[consultas.length - 1] || {};
  ok("a fila foi consultada", consultas.length >= 1, `${consultas.length} consultas`);
  ok("consulta leva abertoHaSeg (idade, nao hora)", /^\d+$/.test(q.abertoHaSeg || "") && Number(q.abertoHaSeg) <= 60, `abertoHaSeg=${q.abertoHaSeg}`);
  ok("consulta informa pendentes=0", q.pendentes === "0", `pendentes=${q.pendentes}`);

  // 3. Pela porta do navegador.
  const velho = await imprimir(pedido("ped_nav_antigo", Date.now() - 10 * 60_000), false);
  ok("automatico criado ANTES de abrir: nao sai (ok + antesDaAbertura)", velho.ok === true && velho.antesDaAbertura === true, JSON.stringify(velho).slice(0, 120));
  const manual = await imprimir(pedido("ped_nav_manual", Date.now() - 10 * 60_000), true);
  ok("o mesmo com force (botao Imprimir): tenta sair", manual.antesDaAbertura !== true, JSON.stringify(manual).slice(0, 120));
  const novo = await imprimir(pedido("ped_nav_novo", Date.now()), false);
  ok("automatico criado DEPOIS de abrir: tenta sair", novo.antesDaAbertura !== true, JSON.stringify(novo).slice(0, 120));
  const semData = await imprimir({ ...pedido("ped_sem_data", Date.now()), createdAt: undefined }, false);
  ok("sem data: nao barra (tenta sair)", semData.antesDaAbertura !== true);

  ok("sem erro de programa no log", !/TypeError|ReferenceError|SyntaxError/.test(log.join("")));
  p.kill();
  mock.close();
  await sleep(300);

  // 4. A URL da checagem de versao (funcao pura, recortada do server.js).
  // Mesmo recorte do teste-auto-update.js: pelas chaves, que o server.js tem
  // fim de linha do Windows e um "\n}\n" nao o acha.
  const fonte = fs.readFileSync(SERVER, "utf8");
  const ini = fonte.indexOf("function urlDaChecagemDeVersao(");
  let nivel = 0, i = fonte.indexOf("{", ini);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  const urlDaChecagemDeVersao = new Function(`${fonte.slice(ini, i + 1)}; return urlDaChecagemDeVersao;`)();
  const automatica = urlDaChecagemDeVersao("firehubfood.com.br", "loja_x", "1.2.25", false);
  ok("checagem de versao leva a loja e a versao", /franchiseeId=loja_x/.test(automatica) && /v=1\.2\.25/.test(automatica) && !/pedido=1/.test(automatica), automatica);
  ok("so o pedido a mao leva pedido=1", /pedido=1/.test(urlDaChecagemDeVersao("firehubfood.com.br", "loja_x", "1.2.25", true)));
  ok("sem loja configurada, ainda pergunta (o servidor reconhece pelo endereco)", /\/api\/assistente\/versao\?v=/.test(urlDaChecagemDeVersao(undefined, "", "1.2.25", false)));

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificacoes OK`);
  if (falhas.length) console.log("\n--- log ---\n" + log.join("").slice(-2500));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS QUEBROU:", e); process.exit(2); });
