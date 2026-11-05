// Vários processos do site no mesmo container (PROCESSOS_DO_SITE > 1).
//
// O Node usa UM núcleo por processo: no droplet de 8 vCPU (05/11/2026) um
// server.js só deixava 7 núcleos parados no pico. Aqui o processo principal
// abre N cópias do server.js na mesma porta (node:cluster divide as conexões
// entre elas) e repõe a que cair. O que precisa ser um só entre as cópias já
// mora no banco desde o plano das duas instâncias (lib/vez.ts, robô e painel
// no banco, DDL do boot com trava); o cron-runner continua um só por container
// (scripts/entrypoint.sh).
//
// Memória: sem teto, cada cópia ganharia ~1/4 da RAM de heap; fica 2048 MB
// por cópia (o mesmo teto de antes), a não ser que NODE_OPTIONS já traga um.
const cluster = require("node:cluster");
const path = require("node:path");

const processos = Math.max(1, parseInt(process.env.PROCESSOS_DO_SITE || "1", 10) || 1);

if (cluster.isPrimary) {
  const temTeto = /--max-old-space-size/.test(`${process.env.NODE_OPTIONS || ""} ${process.execArgv.join(" ")}`);
  cluster.setupPrimary({
    exec: path.join(__dirname, "..", "server.js"),
    execArgv: temTeto ? process.execArgv : [...process.execArgv, "--max-old-space-size=2048"],
  });

  const numeroDe = new Map(); // worker.id -> 1..N
  const abrir = (numero) => {
    const w = cluster.fork({ PROCESSO_DO_SITE: String(numero) });
    numeroDe.set(w.id, numero);
  };
  for (let i = 1; i <= processos; i++) abrir(i);
  console.log(`[varios-processos] ${processos} processos do site`);

  // A vez do Nominatim (1 chamada por segundo POR IP): as cópias pedem e esta
  // fila solta uma a cada 1,1 s para o container inteiro
  // (src/lib/geocodificacao-servidor.ts).
  let proximaVezDoNominatim = 0;
  cluster.on("message", (w, m) => {
    if (m?.tipo !== "vez-do-nominatim") return;
    const agora = Date.now();
    const quando = Math.max(agora, proximaVezDoNominatim);
    proximaVezDoNominatim = quando + 1100;
    setTimeout(() => {
      if (!w.isDead()) w.send(m);
    }, quando - agora);
  });

  let desligando = false;
  cluster.on("exit", (w, code, sinal) => {
    const numero = numeroDe.get(w.id);
    numeroDe.delete(w.id);
    if (desligando) {
      if (numeroDe.size === 0) process.exit(0);
      return;
    }
    console.error(`[varios-processos] processo ${numero} saiu (código ${code}, sinal ${sinal}); abrindo outro em 1 s`);
    setTimeout(() => abrir(numero), 1000);
  });

  // O tini (-g) já entrega o SIGTERM a todos do grupo; aqui só não repõe e
  // espera as cópias fecharem as conexões (src/instrumentation.ts).
  for (const sinal of ["SIGTERM", "SIGINT"]) {
    process.on(sinal, () => {
      desligando = true;
      for (const w of Object.values(cluster.workers || {})) w?.process.kill(sinal);
      setTimeout(() => process.exit(0), 40_000).unref();
    });
  }
}
