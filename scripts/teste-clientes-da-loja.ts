/**
 * Trava a aba Clientes (lib/clientes-da-loja.ts e lib/clientes-da-loja-regras.ts)
 * nos defeitos da auditoria de 11/10/2026:
 *
 * - o mesmo cliente em duas linhas por causa do 9º dígito (o robô grava o
 *   número da conversa, sem o 9; o site, com ele) — Ragnar, 79 linhas para 71
 *   clientes; "Erik Bastos, nunca pediu" ao lado de "Erik Bastos, 3 pedidos";
 * - "primeiro pedido" contando cancelado ("Pediram em 30 dias: 71 · 94 pela
 *   primeira vez" na Pizzaria 17);
 * - rascunho do robô e pedido esperando pagamento contando como pedido e
 *   gasto, e 'CANCELLED' fora da lista de cancelados;
 * - o cliente do 99Food sumindo pelo ramal pendurado no telefone;
 * - "hoje/ontem" em janelas de 24 h e o nome do arquivo com a data UTC.
 *
 *   npx tsx scripts/teste-clientes-da-loja.ts
 *
 * A parte 2 roda a CONSULTA de verdade (o mesmo SQL que vai para o Neon) num
 * Postgres em memória (PGlite). Sem o pacote, ela é pulada e o teste avisa.
 * PGLITE=<caminho do dist/index.js> escolhe outro lugar.
 */
import { existsSync } from "fs";
import { pathToFileURL } from "url";
import {
  chaveDoCliente, contaComoPedido, dataNaLoja, diasAtras, haQuanto, nomeDoArquivoDeClientes, numerosDoCliente, semRamal, telefoneDoCliente,
} from "../src/lib/clientes-da-loja-regras";
import { sqlDaBaseDeClientes, sqlDosPedidosDoCliente, sqlDoResumoDeClientes } from "../src/lib/clientes-da-loja";
import { Prisma } from "@prisma/client";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n1) A chave do cliente: DDD + 8 últimos dígitos");
confere("robô (sem o 9) e site (com o 9) do Erik: a mesma chave",
  [chaveDoCliente("+55 (91) 8106-0960"), chaveDoCliente("91981060960"), chaveDoCliente("5591981060960")], ["9181060960", "9181060960", "9181060960"]);
confere("mesmo final em outro DDD é OUTRA pessoa", chaveDoCliente("(11) 98106-0960") === chaveDoCliente("(91) 98106-0960"), false);
confere("máscara e 55 não mudam nada", [chaveDoCliente("(22) 99276-1161"), chaveDoCliente("5522992761161")], ["2292761161", "2292761161"]);
confere("99Food: o ramal sai, o número do cliente fica",
  [semRamal("+55 22999642452 (ramal 23163674)"), telefoneDoCliente("+55 22999642452 (ramal 23163674)"), chaveDoCliente("+55 22999642452 (ramal 23163674)")],
  ["+55 22999642452", "22999642452", "2299642452"]);
confere("0800 do iFood, carimbo do balcão e vazio: não são cliente",
  [chaveDoCliente("0800 705 1020 ID: 32511427"), chaveDoCliente("00000000000"), chaveDoCliente(""), chaveDoCliente(null)], [null, null, null, null]);

console.log("\n2) O que conta como pedido (a régua dos relatórios)");
confere("entregue e novo contam; cancelado (3 grafias), rascunho do robô e esperando pagamento, não",
  ["ENTREGUE", "NOVO", "CANCELADO", "CANCELLED", "CANCELED", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"].map(contaComoPedido),
  [true, true, false, false, false, false, false]);

console.log("\n2b) Os números da ficha (o Erik da Ragnar)");
const pedidosDoErik = [
  { status: "ENTREGUE", totalAmount: 64.9, createdAt: "2026-10-10T23:47:37Z" },
  { status: "ENTREGUE", totalAmount: 71.9, createdAt: "2026-09-27T22:18:35Z" },
  { status: "ENTREGUE", totalAmount: 76.9, createdAt: "2026-09-26T00:04:20Z" },
  { status: "CANCELADO", totalAmount: 65.9, createdAt: "2026-09-25T23:52:44Z" },
  { status: "CRIANDO_IA", totalAmount: 30, createdAt: "2026-10-11T10:00:00Z" },
];
confere("3 pedidos, R$ 213,70, ticket R$ 71,23; primeiro = 26/09 (não o cancelado de 25/09); 1 cancelado, 1 não concluído",
  numerosDoCliente(pedidosDoErik),
  { pedidos: 3, gasto: 213.7, ticketMedio: 71.23, primeiro: "2026-09-26T00:04:20.000Z", ultimo: "2026-10-10T23:47:37.000Z", cancelados: 1, naoConcluidos: 1 });
confere("quem só tem cancelado e rascunho: 0 pedido e sem primeiro pedido",
  numerosDoCliente([{ status: "CANCELLED", totalAmount: 10, createdAt: "2026-10-01T10:00:00Z" }, { status: "AGUARDANDO_PAGAMENTO", totalAmount: 5, createdAt: "2026-10-02T10:00:00Z" }]),
  { pedidos: 0, gasto: 0, ticketMedio: 0, primeiro: null, ultimo: null, cancelados: 1, naoConcluidos: 1 });

console.log("\n3) Hoje, ontem e o arquivo — pelo dia da LOJA");
// Pedido de 10/10 às 22h (Brasília) visto em 11/10 às 10h: 12 horas depois.
confere("pedido de ontem às 22h visto hoje às 10h é 'ontem' (era 'hoje' pela janela de 24 h)",
  haQuanto("2026-10-11T01:00:00Z", new Date("2026-10-11T13:00:00Z"), "America/Sao_Paulo"), "ontem");
confere("pedido de 08/10 às 23h30 visto em 10/10 às 9h é 'há 2 dias' (era 'ontem')",
  haQuanto("2026-10-09T02:30:00Z", new Date("2026-10-10T12:00:00Z"), "America/Sao_Paulo"), "há 2 dias");
confere("pedido de hoje à 1h visto hoje às 23h: 'hoje'",
  haQuanto("2026-10-11T04:00:00Z", new Date("2026-10-12T02:00:00Z"), "America/Sao_Paulo"), "hoje");
confere("o fuso é o da loja: 23h30 de Manaus ainda é ontem lá, já é hoje em Brasília",
  [diasAtras("2026-10-11T03:30:00Z", new Date("2026-10-11T15:00:00Z"), "America/Manaus"), diasAtras("2026-10-11T03:30:00Z", new Date("2026-10-11T15:00:00Z"), "America/Sao_Paulo")],
  [1, 0]);
confere("nunca pediu", haQuanto(null, new Date(), "America/Sao_Paulo"), "nunca pediu");
confere("arquivo exportado às 22h30 de 10/10 (Brasília) é de 10/10, não de 11/10 (UTC)",
  nomeDoArquivoDeClientes(new Date("2026-10-11T01:30:00Z"), "America/Sao_Paulo"), "clientes-2026-10-10.csv");
confere("a data da planilha também é a da loja", dataNaLoja("2026-10-11T01:30:00Z", "America/Sao_Paulo"), "10/10/2026");

// ── 4) A CONSULTA, num Postgres de verdade ──────────────────────────────────
async function abrirPGlite(): Promise<any | null> {
  const candidatos = [process.env.PGLITE, "C:/Users/Micro/crm-teste/node_modules/@electric-sql/pglite/dist/index.js"].filter(Boolean) as string[];
  for (const c of candidatos) {
    if (!existsSync(c)) continue;
    const { PGlite } = await import(pathToFileURL(c).href);
    return new PGlite();
  }
  try { const { PGlite } = await import("@electric-sql/" + "pglite"); return new PGlite(); } catch { return null; }
}

async function parteSql() {
const db = await abrirPGlite();
if (!db) {
  console.log("\n4) ⚠️  PGlite não encontrado: a parte da consulta SQL foi PULADA (rode com PGLITE=<dist/index.js>).");
} else {
  console.log("\n4) A consulta da lista, num Postgres em memória (PGlite)");
  await db.exec(`
    CREATE TABLE "CustomerOrder" ("id" text, "franchiseeId" text, "customerPhone" text, "customerName" text, "status" text,
      "totalAmount" double precision, "createdAt" timestamp(3), "tableSessionId" text, "ifoodOrderId" text, "reposicao" jsonb);
    CREATE TABLE "StoreCustomer" ("phone" text, "name" text, "lojaDeOrigemId" text, "createdAt" timestamp(3));
    CREATE TABLE "CashbackAjuste" ("lojaId" text, "telefone" text, "nome" text, "createdAt" timestamp(3));
    CREATE TABLE "ClienteDaLoja" ("lojaId" text, "chave" text, "nome" text);
  `);
  const L = "loja";
  const pedidos: [string, string, string, string, number, string, string | null, string | null][] = [
    // id, telefone, nome, status, total, quando (UTC), mesa, iFood
    ["e1", "+55 (91) 8106-0960", "Erik Bastos", "CANCELADO", 65.9, "2026-09-25 23:52:44", null, null],   // robô, sem o 9
    ["e2", "91981060960", "Erik Bastos", "ENTREGUE", 76.9, "2026-09-26 00:04:20", null, null],
    ["e3", "91981060960", "Erik Bastos ", "ENTREGUE", 71.9, "2026-09-27 22:18:35", null, null],
    ["e4", "91981060960", "erik bastos", "ENTREGUE", 64.9, "2026-10-10 23:47:37", null, null],
    ["a1", "(22) 99999-0001", "Ana", "CRIANDO_IA", 40, "2026-10-05 20:00:00", null, null],              // só rascunho do robô
    ["b1", "22999990002", "Bia", "ENTREGUE", 30, "2026-08-01 20:00:00", null, null],
    ["b2", "22999990002", "Bia", "CANCELLED", 99, "2026-10-02 20:00:00", null, null],                    // cancelado em inglês
    ["c1", "+55 21991385491 (ramal 38485450)", "Caio", "ENTREGUE", 50, "2026-10-08 20:00:00", null, null], // 99Food
    ["d1", "22999990003", "Dani", "AGUARDANDO_PAGAMENTO", 25, "2026-10-09 20:00:00", null, null],
    ["s1", "(11) 98106-0960", "Erik de SP", "ENTREGUE", 20, "2026-10-01 20:00:00", null, null],          // outro DDD
    ["i1", "0800 705 1020 ID: 32511427", "Cliente iFood", "ENTREGUE", 80, "2026-10-10 20:00:00", null, "ifood-1"],
    ["m1", "00000000000", "Mesa 5", "ENTREGUE", 120, "2026-10-10 21:00:00", "mesa-1", null],
    ["x1", "00000000000", "Balcão", "ENTREGUE", 15, "2026-10-10 21:30:00", null, null],
  ];
  for (const [id, tel, nome, status, total, quando, mesa, ifood] of pedidos) {
    await db.query(`INSERT INTO "CustomerOrder" VALUES ($1, $2, $3, $4, $5, $6, $7::timestamp, $8, $9)`, [id, L, tel, nome, status, total, quando, mesa, ifood]);
  }
  await db.query(`INSERT INTO "CustomerOrder" VALUES ('o1', 'outra', '91981060960', 'Erik', 'ENTREGUE', 500, '2026-10-10 20:00:00', NULL, NULL)`);
  // A troca do pedido e4 (lib/reposicao.ts): R$ 0,00, não é pedido nem gasto do Erik (o dono, 16/10/2026).
  await db.query(`INSERT INTO "CustomerOrder" VALUES ('e5', $1, '91981060960', 'Erik Bastos', 'ACEITO', 0, '2026-10-11 00:30:00', NULL, NULL, '{"pedidoId":"e4","numero":"4","motivo":"TROCA"}')`, [L]);
  await db.query(`INSERT INTO "StoreCustomer" VALUES ('(91) 8106-0960', 'Erik (Gama)', $1, '2026-09-01 12:00:00')`, [L]);
  await db.query(`INSERT INTO "CashbackAjuste" VALUES ($1, '91981060960', 'Erik B.', '2026-10-03 12:00:00')`, [L]);

  const rodar = async (sql: Prisma.Sql) => (await db.query((sql as any).text, (sql as any).values)).rows as any[];
  const agora = new Date("2026-10-11T15:00:00Z");
  const limite = new Date(agora.getTime() - 30 * 86_400_000);
  const linhas = await rodar(Prisma.sql`${sqlDaBaseDeClientes(L, ["81060960"], [12.5])}
    SELECT c.chave, c.tel, c.nome, c.pedidos, c.gasto, c.primeiro::text AS primeiro, c.ultimo::text AS ultimo, c.importado, c.saldo
    FROM clientes c ORDER BY c.chave`);
  const linha = (chave: string) => linhas.find((l) => l.chave === chave);
  confere("6 clientes: Erik (um só), Erik de SP, Ana, Bia, Caio (99) e Dani; fora iFood, mesa, balcão e a outra loja",
    linhas.map((l) => l.chave), ["1181060960", "2191385491", "2299990001", "2299990002", "2299990003", "9181060960"]);
  const erik = linha("9181060960");
  confere("Erik numa linha só: telefone com o 9, 3 pedidos, R$ 213,70 (o cancelado do robô não conta)",
    [erik?.tel, erik?.pedidos, Math.round(erik?.gasto * 100) / 100], ["91981060960", 3, 213.7]);
  confere("primeiro pedido do Erik = o primeiro que CONTA (26/09), não o cancelado de 25/09",
    String(erik?.primeiro).slice(0, 10), "2026-09-26");
  confere("a reposição (troca de R$ 0,00 em 11/10) não é pedido do Erik: o último continua o de 10/10",
    String(erik?.ultimo).slice(0, 10), "2026-10-10");
  confere("o cadastro importado (sem o 9) e o lançamento de saldo juntam na mesma linha", [erik?.importado, erik?.saldo], [true, 12.5]);
  confere("Ana (só rascunho do robô) e Dani (esperando pagamento): 0 pedido, R$ 0, sem primeiro pedido",
    [linha("2299990001")?.pedidos, linha("2299990001")?.gasto, linha("2299990001")?.primeiro, linha("2299990003")?.pedidos, linha("2299990003")?.primeiro],
    [0, 0, null, 0, null]);
  confere("Bia: o 'CANCELLED' (em inglês) não conta — 1 pedido, R$ 30, último em 01/08",
    [linha("2299990002")?.pedidos, linha("2299990002")?.gasto, String(linha("2299990002")?.ultimo).slice(0, 10)], [1, 30, "2026-08-01"]);
  confere("Caio do 99Food entra pelo número sem o ramal", [linha("2191385491")?.tel, linha("2191385491")?.pedidos], ["21991385491", 1]);
  confere("a ficha do Erik acha os pedidos dele (com e sem o 9) e a reposição no histórico, não o do Erik de SP nem o da outra loja",
    (await rodar(sqlDosPedidosDoCliente(L, chaveDoCliente("91981060960")!))).map((r) => r.id), ["e5", "e4", "e3", "e2", "e1"]);
  confere("a ficha do Caio (99Food) acha o pedido pelo número sem o ramal",
    (await rodar(sqlDosPedidosDoCliente(L, chaveDoCliente("21991385491")!))).map((r) => r.id), ["c1"]);
  // O "Editar cadastro" (lib/cadastro-do-cliente.ts): o nome corrigido vence.
  await db.query(`INSERT INTO "ClienteDaLoja" VALUES ($1, '9181060960', 'Erik (corrigido)'), ($1, '2299990002', '  '), ('outra', '2191385491', 'Caio da outra loja')`, [L]);
  const corrigidas = await rodar(Prisma.sql`${sqlDaBaseDeClientes(L, ["81060960"], [12.5], true)}
    SELECT c.chave, c.nome, c.pedidos, c.saldo FROM clientes c ORDER BY c.chave`);
  confere("com a edição: Erik com o nome corrigido; nome em branco não apaga a Bia; a correção de outra loja não vale aqui",
    corrigidas.map((l) => l.nome), ["Erik de SP", "Caio", "Ana", "Bia", "Dani", "Erik (corrigido)"]);
  confere("a edição não duplica linha nem mexe em pedidos e saldo",
    [corrigidas.length, corrigidas.find((l) => l.chave === "9181060960")?.pedidos, corrigidas.find((l) => l.chave === "9181060960")?.saldo], [6, 3, 12.5]);
  const [resumo] = await rodar(sqlDoResumoDeClientes(L, [], [], limite));
  confere("resumo: 6 clientes, 4 pediram, 3 em 30 dias, 1 sumido, 3 pela primeira vez (nunca mais estreantes que ativos)",
    resumo, { clientes: 6, pediram: 4, ativos30: 3, sumidos: 1, novos30: 3 });
}
}

parteSql().then(() => {
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}).catch((e) => {
  console.error("❌ a parte SQL quebrou:", e?.message || e);
  process.exit(1);
});
