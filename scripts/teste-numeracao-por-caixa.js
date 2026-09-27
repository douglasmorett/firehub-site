/**
 * A NUMERAÇÃO SÓ RECOMEÇA QUANDO O CAIXA FECHA — NUNCA PELO RELÓGIO.
 *
 * Regra do dono (27/09/2026): "zera só quando fecha o caixa. Horário nenhum é
 * para zerar. Se o cliente nunca fechar o caixa, continua contando sem parar."
 * Antes, sem caixa aberto a contagem voltava ao 1 à meia-noite (o Frangoso,
 * 19/09), e o caixa novo do mesmo dia continuava do maior número do dia.
 *
 * O que este harness cobra:
 *   • o período é o que vem depois do ÚLTIMO FECHAMENTO de caixa;
 *   • meia-noite, caixa aberto ou não: nada disso muda a chave;
 *   • loja que nunca fechou caixa conta desde sempre;
 *   • erro ao ler o caixa não pode parar a numeração.
 *
 * E o filtro por HORA do relatório de motoboy (turno que atravessa a noite).
 *
 *   node scripts/teste-numeracao-por-caixa.js
 */
const path = require("path");
// order-number.ts importa o cliente do Prisma, que recusa subir sem a URL.
// Nada aqui toca no banco — `chaveDoContador` recebe um cliente de mentira —,
// mas o módulo precisa carregar. URL de faz de conta, nunca conectada.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/nao-existe";
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const { chaveDoContador } = jiti(path.resolve(__dirname, "..", "src", "lib", "order-number.ts"));
const { getInstantUTC } = jiti(path.resolve(__dirname, "..", "src", "lib", "timezone.ts"));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

/** Um Prisma de mentira: responde o último caixa FECHADO. */
const dbCom = (fechado) => ({ cashSession: { findFirst: async (q) => (q?.where?.status === "CLOSED" ? fechado : null) } });
const dbQueQuebra = { cashSession: { findFirst: async () => { throw new Error("sem tabela"); } } };

(async () => {
  const fechouOntem = { id: "cs_1", closedAt: new Date("2026-09-19T02:00:00Z") }; // 23:00 do dia 18

  console.log("\n== o período começa no último fechamento de caixa ==");
  const k1 = await chaveDoContador(dbCom(fechouOntem), "loja1", new Date("2026-09-19T04:00:00Z"));
  conferir("a chave é o fechamento", k1.dateKey, "fechamento:cs_1");
  conferir("a semente olha desde o fechamento", k1.desde.toISOString(), fechouOntem.closedAt.toISOString());

  console.log("\n== meia-noite não zera ==");
  const antes = await chaveDoContador(dbCom(fechouOntem), "loja1", new Date("2026-09-20T02:59:00Z")); // 23:59
  const depois = await chaveDoContador(dbCom(fechouOntem), "loja1", new Date("2026-09-20T03:01:00Z")); // 00:01
  conferir("23:59 e 00:01 caem no mesmo contador", antes.dateKey, depois.dateKey);
  const semanaDepois = await chaveDoContador(dbCom(fechouOntem), "loja1", new Date("2026-09-26T20:00:00Z"));
  conferir("uma semana sem fechar o caixa: o mesmo contador", semanaDepois.dateKey, "fechamento:cs_1");

  console.log("\n== fechou o caixa: o contador é outro (volta ao 1) ==");
  const fechouHoje = { id: "cs_2", closedAt: new Date("2026-09-19T18:00:00Z") }; // 15:00 do dia 19
  const k3 = await chaveDoContador(dbCom(fechouHoje), "loja1", new Date("2026-09-19T21:00:00Z"));
  conferir("a chave muda no fechamento, mesmo no mesmo dia", k3.dateKey, "fechamento:cs_2");
  conferir("e a semente só olha o que veio depois dele", k3.desde.toISOString(), fechouHoje.closedAt.toISOString());

  console.log("\n== loja que nunca fechou caixa conta desde sempre ==");
  const k2 = await chaveDoContador(dbCom(null), "loja1", new Date("2026-09-19T04:00:00Z"));
  conferir("a chave é única", k2.dateKey, "sempre");
  conferir("a semente olha tudo", k2.desde.toISOString(), new Date(0).toISOString());

  console.log("\n== ler o caixa falhou: a numeração não pode parar ==");
  const k4 = await chaveDoContador(dbQueQuebra, "loja1", new Date("2026-09-19T04:00:00Z"));
  conferir("segue sem olhar o relógio", k4.dateKey, "sempre");

  console.log("\n== relatório de motoboy: o turno que vira a noite ==");
  const tz = "America/Sao_Paulo";
  conferir("18:00 do dia 1 vira 21:00 UTC", getInstantUTC("2026-09-01T18:00", tz).toISOString(), "2026-09-01T21:00:00.000Z");
  conferir("02:00 do dia 2 vira 05:00 UTC", getInstantUTC("2026-09-02T02:00", tz).toISOString(), "2026-09-02T05:00:00.000Z");
  conferir("aceita espaço no lugar do T", getInstantUTC("2026-09-01 18:00", tz).toISOString(), "2026-09-01T21:00:00.000Z");
  conferir("sem hora devolve null (quem chama decide o dia inteiro)", getInstantUTC("2026-09-01", tz), null);
  conferir("lixo devolve null", getInstantUTC("qualquer coisa", tz), null);
  conferir("vazio devolve null", getInstantUTC("", tz), null);
  // O turno de 18h do dia 1 às 2h do dia 2 tem 8 horas — e não 2 dias.
  const h = (getInstantUTC("2026-09-02T02:00", tz) - getInstantUTC("2026-09-01T18:00", tz)) / 3600000;
  conferir("o turno 18h→02h mede 8 horas", h, 8);

  console.log(`\n${ok} ok, ${falhou} falharam\n`);
  process.exit(falhou > 0 ? 1 : 0);
})();
