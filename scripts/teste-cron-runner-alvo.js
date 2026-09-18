/**
 * O cron-runner tem que falar com o Next em IPv4 — e não pode mais silenciar
 * erro de conexão.
 *
 * Em 18/09/2026 os 17 jobs estavam agendados e NENHUM rodava: 439 fotos de
 * cardápio importado nunca internalizadas em nove dias e 587 pedidos sem
 * distância desde 15/09 (a rota faz 150 por ciclo, de 10 em 10 min — o acúmulo
 * é impossível com o cron vivo). Os pedidos seguiam entrando porque iFood,
 * 99Food e Brendi também têm webhook, o que escondeu o estrago.
 *
 * O Next escuta em 0.0.0.0 (só IPv4) e "localhost" no Node 18+ pode resolver
 * para ::1 primeiro. O ECONNREFUSED que vinha disso era engolido de propósito.
 *
 * Este harness lê o próprio arquivo — não sobe servidor, não depende de rede.
 *
 *   node scripts/teste-cron-runner-alvo.js
 */
const fs = require("fs");
const path = require("path");
const fonte = fs.readFileSync(path.join(__dirname, "cron-runner.js"), "utf8");

let ok = 0, falhou = 0;
const conferir = (nome, cond) => {
  if (cond) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}`); }
};

console.log("\n== o alvo das chamadas ==");
conferir("BASE_URL padrão é 127.0.0.1, não localhost", /CRON_BASE_URL \|\| 'http:\/\/127\.0\.0\.1:3000'/.test(fonte));
conferir("CRON_BASE_URL com localhost é normalizado", /replace\('\/\/localhost', '\/\/127\.0\.0\.1'\)/.test(fonte));
conferir("a sonda de prontidão também usa 127.0.0.1", /hostname: '127\.0\.0\.1'/.test(fonte));
conferir("nenhum hostname 'localhost' sobrou", !/hostname: 'localhost'/.test(fonte));
conferir("família IPv4 explícita nas requisições", (fonte.match(/family: 4/g) || []).length >= 2);

console.log("\n== erro de conexão não pode ser invisível ==");
conferir("não existe mais o early-return que silenciava ECONNREFUSED", !/if \(err\.code !== 'ECONNREFUSED'\) \{\s*console\.warn/.test(fonte));
conferir("conta falhas seguidas por job", /falhasSeguidas\[job\.name\]/.test(fonte));
conferir("a PRIMEIRA falha sempre sai no log", /n === 1 \|\| n % 10 === 0/.test(fonte));
conferir("o log diz para onde tentou falar", /\$\{BASE_URL\}/.test(fonte));
conferir("sucesso zera o contador", /falhasSeguidas\[job\.name\] = 0/.test(fonte));

console.log("\n== JOB DE CRON MORA EM /api/cron/* ==");
// O proxy (src/proxy.ts) exige sessão NextAuth em todo /api/admin/*, e o cron
// chega com Bearer e sem cookie: leva 401 ANTES da rota. Foi o que manteve a
// internalização de imagens parada por nove dias sem um erro sequer — os
// outros 16 jobs sempre rodaram, porque todos já viviam em /api/cron/.
const caminhos = [...fonte.matchAll(/^\s+path: '([^']+)'/gm)].map((m) => m[1]);
conferir(`os ${caminhos.length} jobs apontam todos para /api/cron/`, caminhos.length >= 17 && caminhos.every((p) => p.startsWith("/api/cron/")));
conferir("nenhum job em /api/admin/ (o proxy derruba antes da rota)", !caminhos.some((p) => p.startsWith("/api/admin/")));
conferir("internalizar-imagens aponta para /api/cron/internalizar-imagens", caminhos.includes("/api/cron/internalizar-imagens"));

console.log("\n== o que não pode ter mudado ==");
conferir("internalizar-imagens continua agendado", /name: 'internalizar-imagens'/.test(fonte));
conferir("os 17 jobs continuam lá", (fonte.match(/^\s+name: '/gm) || []).length >= 17);
conferir("o timeout de 55s continua", /timeout: 55_000/.test(fonte));

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
