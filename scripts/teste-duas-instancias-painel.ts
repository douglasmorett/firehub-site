/**
 * DUAS INSTÂNCIAS DO SERVIDOR NO MESMO BANCO — painel, fila e impressão.
 * Prova, com dois processos Node de verdade (cada um com o seu pool, a sua
 * memória e o seu laço de lib/laco-entre-instancias.ts), como A e B atrás do
 * balanceador:
 *
 *  (1) NOVIDADE: B guardou "fila vazia" na memória; o pedido gravado em A tira
 *      a fila de B do "nada" em ≤ 2 s (antes: até o prazo de 15 s). Controle:
 *      com o laço de B parado, B segue "vazia" — é o laço que traz a marca.
 *      E a instância não relê a própria marca (com um servidor só, nada muda).
 *  (2) SINAIS: o painel aberto visto por A chega ao cron de B (≤ 6 s: vai
 *      ao banco a cada 5 s, e o cron roda de minuto em minuto); a
 *      decisão "apagou" de B deixa de pausar a loja de quem está com o painel
 *      aberto no outro servidor.
 *  (3) UMA COMANDA SÓ: dois Assistentes da mesma versão enxergando a mesma
 *      impressora, cada instância vendo um deles primeiro (o defeito: cada
 *      uma escolhia um dono diferente e saíam dois papéis). Com o banco, os
 *      dois servidores escolhem o mesmo — pela rota de verdade da fila, com o
 *      Assistente consultando só um servidor e depois alternando.
 *
 * Só em Postgres LOCAL descartável, com o schema:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55502/painel npx prisma db push --skip-generate
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55502/painel NEXTAUTH_SECRET=x npx tsx scripts/teste-duas-instancias-painel.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";

const URL_DO_BANCO = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_DO_BANCO)) {
  console.error("Recuso: DATABASE_URL não é um Postgres local (127.0.0.1/localhost). Este teste grava lojas e pedidos.");
  process.exit(2);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── O PROCESSO FILHO: um "servidor" com a rota da fila de verdade ───────────

async function instancia(porta: number) {
  const { prisma } = await import("../src/lib/prisma");
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const laco = await import("../src/lib/laco-entre-instancias");
  const sinais = await import("../src/lib/sinais-da-loja");
  const dono = await import("../src/lib/dono-da-impressora");
  const { ultimaNovidade } = await import("../src/lib/novidade-da-loja");
  await laco.iniciarLacoEntreInstancias();

  // Conta as idas ao banco da fila (a pré-consulta que roda com a fila vazia).
  let preConsultas = 0;
  const queryRaw = prisma.$queryRaw.bind(prisma);
  (prisma as any).$queryRaw = (...a: any[]) => {
    const s = a[0];
    if (/FROM "PrintRequest"/.test(s?.text || s?.sql || "")) preConsultas++;
    return (queryRaw as any)(...a);
  };

  const rotas: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
    "/fila": async (q) => {
      const url = new URL("https://firehubfood.com.br/api/store/print-queue");
      url.searchParams.set("franchiseeId", q.get("loja")!);
      url.searchParams.set("v", q.get("v") || "1.2.36");
      url.searchParams.set("pendentes", "0");
      url.searchParams.set("abertoHaSeg", "7200");
      url.searchParams.set("porta", "7899");
      if (q.get("imps")) url.searchParams.set("impressoras", q.get("imps")!);
      const res = await GET(new NextRequest(url.toString(), { headers: { "x-forwarded-for": q.get("ip") || "10.9.9.9" } }));
      const corpo = (await res.json()) as { jobs?: any[] };
      return { pedidos: (corpo.jobs || []).map((j) => String(j?.order?.id ?? j?.id)), preConsultas };
    },
    "/pedido": async (q) => {
      const p = await prisma.customerOrder.create({
        data: {
          franchiseeId: q.get("loja")!, customerName: "Cliente", customerPhone: "22999999999", totalAmount: 30, status: "NOVO", deliveryType: "DELIVERY",
          items: { create: [{ productName: "X-Burger", quantity: 1, price: 30 }] },
        } as any,
        select: { id: true },
      });
      return { id: p.id, marca: ultimaNovidade([q.get("loja")!]) };
    },
    "/impresso": async (q) => {
      await prisma.customerOrder.update({ where: { id: q.get("id")! }, data: { printedAt: new Date() } });
      return {};
    },
    "/painel": async (q) => {
      sinais.marcarPainelAberto([q.get("loja")]);
      return {};
    },
    "/sinais": async () => Object.fromEntries(await laco.sinaisDasOutrasInstancias()),
    "/cron-ve": async (q) => {
      // O que o cron da loja sem conexão desta instância monta para a loja.
      const loja = q.get("loja")!;
      const agora = Date.now();
      const deFora = (await laco.sinaisDasOutrasInstancias()).get(loja);
      const maisRecente = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
      return { agora, painelNaMemoria: maisRecente(sinais.painelVistoEm(loja), sinais.sinalDeOutraInstancia(deFora?.painelHaMs, agora)), soDaqui: sinais.painelVistoEm(loja) };
    },
    "/dono": async (q) => {
      const loja = q.get("loja")!;
      const imp = q.get("imp")!;
      return { soMemoria: dono.donoDaImpressora(loja, imp), comBanco: dono.donoDaImpressora(loja, imp, Date.now(), await laco.assistentesNoBanco(loja)) };
    },
    "/ultima": async (q) => ({ marca: ultimaNovidade([q.get("loja")!]) }),
    "/sair": async () => { setTimeout(() => process.exit(0), 50); return {}; },
    "/parar-laco": async () => { laco.pararLacoEntreInstancias(); return {}; },
    "/ligar-laco": async () => { await laco.iniciarLacoEntreInstancias(); return {}; },
  };

  createServer(async (req, res) => {
    const u = new URL(req.url || "/", "http://x");
    try {
      const f = rotas[u.pathname];
      const corpo = f ? await f(u.searchParams) : { erro: "rota" };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(corpo));
    } catch (e: any) {
      res.writeHead(500).end(JSON.stringify({ erro: String(e?.message || e) }));
    }
  }).listen(porta, "127.0.0.1", () => console.log(`PRONTO ${porta}`));
}

// ── O TESTE ─────────────────────────────────────────────────────────────────

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

function subir(nome: string, porta: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", "scripts/teste-duas-instancias-painel.ts", "instancia", String(porta)], {
      shell: true,
      env: { ...process.env, INSTANCIA: nome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    const vigia = setTimeout(() => reject(new Error(`instância ${nome} não subiu:\n${saida.slice(-2000)}`)), 120_000);
    p.stdout!.on("data", (c) => {
      saida += c;
      if (saida.includes(`PRONTO ${porta}`)) { clearTimeout(vigia); resolve(p); }
    });
    p.stderr!.on("data", (c) => { saida += c; });
  });
}

const pedir = async (porta: number, caminho: string, q: Record<string, string> = {}) => {
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}?${new URLSearchParams(q)}`);
  const j: any = await r.json();
  if (j?.erro) throw new Error(`${caminho}: ${j.erro}`);
  return j;
};

async function principal() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  console.log(`Postgres local: ${URL_DO_BANCO.replace(/:[^:@/]+@/, ":***@")}`);

  const sufixo = Date.now().toString(36);
  const LOJA = `loja_duas_${sufixo}`;
  const LOJA_SINAL = `loja_sinal_${sufixo}`;
  const LOJA_COMANDA = `loja_comanda_${sufixo}`;
  const impressora = { autoprint: true, printers: [{ id: "1", name: "ELGIN i8", label: "Cozinha", copies: 1, modulos: ["salao", "delivery", "balcao"], categories: [], paperWidth: "80mm" }] };
  for (const id of [LOJA, LOJA_SINAL, LOJA_COMANDA]) {
    await db.user.create({ data: { id, email: `${id}@teste.invalid`, name: id, password: "x", storeName: id, slug: id, printerConfig: impressora } as any });
  }

  const A = 56101, B = 56102;
  const filhos = await Promise.all([subir("a", A), subir("b", B)]);
  try {
    // ── (1) novidade ──────────────────────────────────────────────────────
    console.log("\n(1) pedido gravado em A tira a fila de B do \"nada\"");
    let r = await pedir(B, "/fila", { loja: LOJA });
    const consultasAntes = r.preConsultas;
    for (let i = 0; i < 3; i++) r = await pedir(B, "/fila", { loja: LOJA });
    conferir("B: fila vazia guardada na memória (3 consultas sem ir ao banco)", [r.pedidos, r.preConsultas], [[], consultasAntes]);

    let { id, marca } = await pedir(A, "/pedido", { loja: LOJA });
    let t0 = Date.now();
    let viu = -1;
    while (Date.now() - t0 < 5_000) {
      r = await pedir(B, "/fila", { loja: LOJA });
      if (r.pedidos.includes(id)) { viu = Date.now() - t0; break; }
      await espera(50);
    }
    console.log(`        o pedido de A apareceu na fila de B em ${viu} ms (prazo da memória: 15 s)`);
    conferir("apareceu em B em até 2 s", viu >= 0 && viu <= 2_000, true);
    await pedir(A, "/impresso", { id });

    // A não relê a própria marca do banco: com um servidor só, nada muda (a
    // marca de A segue a da gravação até a repetição de 2 s). Numa loja que
    // ninguém mais grava.
    ({ marca } = await pedir(A, "/pedido", { loja: LOJA_SINAL }));
    await espera(1_600);
    conferir("A não reaplica a própria marca (só as das outras instâncias)", (await pedir(A, "/ultima", { loja: LOJA_SINAL })).marca, marca);

    console.log("    controle: com o laço de B parado, a marca não chega");
    await pedir(B, "/parar-laco");
    await espera(2_500); // deixa vencer o que a marca do impresso invalidou
    r = await pedir(B, "/fila", { loja: LOJA });
    ({ id } = await pedir(A, "/pedido", { loja: LOJA }));
    t0 = Date.now();
    let viuSemLaco = false;
    while (Date.now() - t0 < 3_000) {
      r = await pedir(B, "/fila", { loja: LOJA });
      if (r.pedidos.includes(id)) { viuSemLaco = true; break; }
      await espera(100);
    }
    conferir("sem o laço: 3 s depois B ainda responde \"nada\" pela memória", viuSemLaco, false);
    await pedir(B, "/ligar-laco");
    t0 = Date.now();
    viu = -1;
    while (Date.now() - t0 < 5_000) {
      r = await pedir(B, "/fila", { loja: LOJA });
      if (r.pedidos.includes(id)) { viu = Date.now() - t0; break; }
      await espera(50);
    }
    console.log(`        laço religado: apareceu em ${viu} ms`);
    conferir("laço religado: aparece em até 2 s", viu >= 0 && viu <= 2_000, true);
    await pedir(A, "/impresso", { id });

    // ── (2) sinais ────────────────────────────────────────────────────────
    console.log("\n(2) painel aberto visto por A chega ao cron de B");
    await pedir(A, "/painel", { loja: LOJA_SINAL });
    t0 = Date.now();
    let s: any = null;
    while (Date.now() - t0 < 8_000) {
      s = (await pedir(B, "/sinais"))[LOJA_SINAL];
      if (s?.painelHaMs != null) break;
      await espera(100);
    }
    const levou = Date.now() - t0;
    console.log(`        B viu o painel de A em ${levou} ms (linha de ${Math.round(s?.painelHaMs ?? -1)} ms)`);
    conferir("B vê o painel de A em até 6 s", s?.painelHaMs != null && levou <= 6_000, true);
    conferir("A não lê a própria linha (com um servidor só, o cron decide como antes)", (await pedir(A, "/sinais"))[LOJA_SINAL] ?? null, null);
    const ve = await pedir(B, "/cron-ve", { loja: LOJA_SINAL });
    const { lojaApagada } = await import("../src/lib/loja-sem-conexao");
    const MIN = 60_000;
    const situacao = { turno: "t", emPausa: false, storeOpen: true, protecaoLigada: true };
    const sinal = (painel: number | null) => ({ agora: ve.agora, bootEm: ve.agora - 60 * MIN, assistenteNoBanco: ve.agora - 3 * MIN, assistenteNaMemoria: ve.agora - 3 * MIN, painelNaMemoria: painel });
    conferir("cron de B só com a própria memória: \"apagou\" (pausaria o iFood)", [ve.soDaqui, lojaApagada(sinal(ve.soDaqui), situacao)], [null, true]);
    conferir("cron de B com o sinal de A: não apaga", lojaApagada(sinal(ve.painelNaMemoria), situacao), false);

    // ── (3) uma comanda só ────────────────────────────────────────────────
    console.log("\n(3) dois Assistentes, duas instâncias, uma comanda");
    const X = { loja: LOJA_COMANDA, ip: "10.2.2.1", imps: "ELGIN i8" };
    const Y = { loja: LOJA_COMANDA, ip: "10.2.2.2", imps: "ELGIN i8" };
    await pedir(A, "/fila", X); // o caixa (X) só fala com A, e chegou primeiro
    await espera(1_500);
    await pedir(B, "/fila", Y); // a cozinha (Y) só fala com B
    await espera(1_500);
    const dA = await pedir(A, "/dono", { loja: LOJA_COMANDA, imp: "ELGIN i8" });
    const dB = await pedir(B, "/dono", { loja: LOJA_COMANDA, imp: "ELGIN i8" });
    conferir("só pela memória, cada instância escolhia um dono (o defeito)", [dA.soMemoria?.startsWith("10.2.2.1"), dB.soMemoria?.startsWith("10.2.2.2")], [true, true]);
    conferir("com o banco, as duas escolhem o mesmo: o que o cluster viu primeiro (X)", [dA.comBanco, dB.comBanco].map((k: string) => k?.split("#")[0]), ["10.2.2.1", "10.2.2.1"]);

    const quemRecebeu = async (id: string, alterna: boolean) => {
      const receberam = new Set<string>();
      const fim = Date.now() + 4_000;
      for (let i = 0; Date.now() < fim; i++) {
        const [ax, ay] = alterna && i % 2 ? [B, A] : [A, B];
        if ((await pedir(ax, "/fila", X)).pedidos.includes(id)) receberam.add("X");
        if ((await pedir(ay, "/fila", Y)).pedidos.includes(id)) receberam.add("Y");
        await espera(250);
      }
      return [...receberam].sort();
    };
    ({ id } = await pedir(A, "/pedido", { loja: LOJA_COMANDA }));
    conferir("cada Assistente preso a um servidor: a comanda sai só para X", await quemRecebeu(id, false), ["X"]);
    await pedir(A, "/impresso", { id });
    ({ id } = await pedir(B, "/pedido", { loja: LOJA_COMANDA }));
    conferir("alternando os servidores (sem cookie): só para X", await quemRecebeu(id, true), ["X"]);
    await pedir(B, "/impresso", { id });
  } finally {
    for (const porta of [A, B]) await pedir(porta, "/sair").catch(() => undefined);
    await espera(300);
    for (const f of filhos) {
      if (process.platform === "win32" && f.pid) spawn("taskkill", ["/pid", String(f.pid), "/T", "/F"], { stdio: "ignore" });
      else f.kill();
    }
    await db.customerOrderItem.deleteMany({ where: { order: { franchiseeId: { in: [LOJA, LOJA_SINAL, LOJA_COMANDA] } } } as any }).catch(() => undefined);
    await db.customerOrder.deleteMany({ where: { franchiseeId: { in: [LOJA, LOJA_SINAL, LOJA_COMANDA] } } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [LOJA, LOJA_SINAL, LOJA_COMANDA] } } }).catch(() => undefined);
    await db.$disconnect();
  }

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

const [modo, porta] = process.argv.slice(2);
if (modo === "instancia") {
  instancia(Number(porta)).catch((e) => { console.error(e); process.exit(1); });
} else {
  principal().catch((e) => { console.error(e); process.exit(1); });
}
