/**
 * O cron-runner só dispara no LÍDER (scripts/cron-runner.js) — contra um
 * servidor FALSO local que faz o papel do Next: responde a liderança como o
 * teste mandar e conta as chamadas de cada job. Nada vai ao banco.
 *
 *   npx tsx scripts/teste-cron-runner.ts
 *
 * O que trava:
 *  - não líder não dispara job nenhum — fica pendente; o health-check roda em
 *    todas as instâncias;
 *  - líder dispara; a resposta da liderança vale ~30 s (uma pergunta só para
 *    várias rodadas, e perguntas simultâneas viram uma);
 *  - virou líder: os pendentes rodam logo (como o container novo no boot);
 *  - a pergunta falhou (503, servidor fora): segue líder SÓ enquanto a vez que
 *    já tinha vale (validade − margem), depois para.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Servidor falso ───────────────────────────────────────────────────────────
const estado = { lider: false, status: 200, validadeMs: 90_000 };
const chamadas: Record<string, number> = {};
const servidor = http.createServer((req, res) => {
  const caminho = (req.url || "").split("?")[0];
  chamadas[caminho] = (chamadas[caminho] || 0) + 1;
  if (caminho === "/api/cron/lideranca") {
    res.writeHead(estado.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(estado.status === 200 ? { lider: estado.lider, validadeMs: estado.validadeMs } : { lider: false, erro: "banco fora" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end('{"ok":true}');
});

async function main() {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  const porta = (servidor.address() as AddressInfo).port;
  process.env.CRON_BASE_URL = `http://127.0.0.1:${porta}`;
  const require = createRequire(import.meta.url);
  const R = require("./cron-runner.js");
  const job = (nome: string) => R.jobs.find((j: any) => j.name === nome);
  const zerarChamadas = () => { for (const k of Object.keys(chamadas)) delete chamadas[k]; };
  const forcarPergunta = () => { R.lideranca.perguntadaEm = 0; };

  console.log("\nnão líder");
  estado.lider = false;
  await R.tick(job("keeta-poll"));
  await R.tick(job("ifood-poll"));
  conferir("não dispara job nenhum", [chamadas["/api/cron/keeta-poll"] ?? 0, chamadas["/api/cron/ifood-poll"] ?? 0], [0, 0]);
  conferir("… e eles ficam pendentes", [job("keeta-poll").pendente, job("ifood-poll").pendente], [true, true]);
  conferir("perguntou a liderança uma vez só (cache de 30 s)", chamadas["/api/cron/lideranca"], 1);
  await R.tick(job("health-check"));
  conferir("o health-check roda mesmo assim (mede o próprio processo)", chamadas["/api/cron/health-check"], 1);
  conferir("… sem perguntar a liderança de novo", chamadas["/api/cron/lideranca"], 1);

  console.log("\nvirou líder");
  zerarChamadas();
  estado.lider = true;
  forcarPergunta();
  await Promise.all([R.souLider(), R.souLider(), R.souLider()]);
  conferir("três perguntas ao mesmo tempo viram UMA", chamadas["/api/cron/lideranca"], 1);
  conferir("vale até a validade menos a margem", Math.abs(R.lideranca.ate - (Date.now() + 90_000 - R.MARGEM_DA_VEZ_MS)) < 2_000, true);
  // os pendentes saem em até 10 s (escalonados como no boot)
  await espera(10_500);
  conferir("os pendentes rodam logo (keeta e ifood, uma vez cada)", [chamadas["/api/cron/keeta-poll"], chamadas["/api/cron/ifood-poll"]], [1, 1]);
  conferir("… e não ficam mais pendentes", [job("keeta-poll").pendente, job("ifood-poll").pendente], [false, false]);
  zerarChamadas();
  await R.tick(job("wabiz-poll"));
  await R.tick(job("wabiz-poll"));
  conferir("líder dispara, sem perguntar de novo dentro dos 30 s", [chamadas["/api/cron/wabiz-poll"], chamadas["/api/cron/lideranca"] ?? 0], [2, 0]);

  console.log("\na pergunta falha (banco fora)");
  zerarChamadas();
  estado.status = 503;
  forcarPergunta();
  await R.tick(job("wabiz-poll"));
  conferir("503 com a vez ainda valendo: segue líder e dispara", chamadas["/api/cron/wabiz-poll"], 1);
  R.lideranca.ate = Date.now() - 1; // a vez que tinha venceu
  forcarPergunta();
  await R.tick(job("wabiz-poll"));
  conferir("503 e a vez venceu: para de disparar", [chamadas["/api/cron/wabiz-poll"], job("wabiz-poll").pendente], [1, true]);
  servidor.close();
  await espera(50);
  forcarPergunta();
  zerarChamadas();
  await R.tick(job("wabiz-poll"));
  conferir("servidor fora (conexão recusada): não dispara", chamadas["/api/cron/wabiz-poll"] ?? 0, 0);

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
