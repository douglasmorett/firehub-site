/**
 * A NUMERAÇÃO NÃO RECOMEÇA À MEIA-NOITE — RECOMEÇA QUANDO O CAIXA FECHA.
 *
 * O Frangoso estava atendendo e, à meia-noite, o painel voltou a contar do 1
 * (19/09/2026). Para quem vira a noite, meia-noite é meio de expediente: o
 * turno acaba quando o caixa fecha.
 *
 * O que este harness cobra:
 *   • com caixa ABERTO, o contador é do TURNO (atravessa a meia-noite);
 *   • sem caixa aberto, nada muda — continua por dia de calendário;
 *   • a semente nunca deixa dois pedidos com o mesmo número no mesmo dia;
 *   • erro ao ler o caixa não pode parar a numeração.
 *
 * E o filtro por HORA do relatório de motoboy, que é o mesmo assunto: turno
 * que atravessa a meia-noite.
 *
 *   node scripts/teste-numeracao-por-caixa.js
 */
const path = require("path");
// order-number.ts importa o cliente do Prisma, que recusa subir sem a URL.
// Nada aqui toca no banco — `chaveDoContador` recebe um cliente de mentira —,
// mas o módulo precisa carregar. URL de faz de conta, nunca conectada.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://teste:teste@127.0.0.1:5432/teste";
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const { chaveDoContador } = jiti(path.resolve(__dirname, "..", "src", "lib", "order-number.ts"));
const { getInstantUTC, getStartOfDayUTC } = jiti(path.resolve(__dirname, "..", "src", "lib", "timezone.ts"));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

/** Um Prisma de mentira: só responde o que `chaveDoContador` pergunta. */
const dbCom = (caixa) => ({ cashSession: { findFirst: async () => caixa } });
const dbQueQuebra = { cashSession: { findFirst: async () => { throw new Error("sem tabela"); } } };

(async () => {
  // 01h da manhã do dia 19, com o caixa aberto às 23h do dia 18.
  const madrugada = new Date("2026-09-19T04:00:00Z"); // 01:00 em São Paulo
  const abertoOntem = { id: "cs_1", openedAt: new Date("2026-09-19T02:00:00Z") }; // 23:00 do dia 18

  console.log("\n== caixa aberto: o contador é do TURNO ==");
  const k1 = await chaveDoContador(dbCom(abertoOntem), "loja1", madrugada);
  conferir("a chave é o turno, não o dia", k1.dateKey, "caixa:cs_1");
  conferir(
    "a semente olha desde a ABERTURA (que foi ontem), não desde a meia-noite",
    k1.desde.toISOString(),
    abertoOntem.openedAt.toISOString(),
  );

  console.log("\n== sem caixa aberto: continua por dia, como sempre foi ==");
  const k2 = await chaveDoContador(dbCom(null), "loja1", madrugada);
  conferir("a chave é a data de São Paulo", k2.dateKey, "2026-09-19");
  conferir("a semente é a meia-noite do dia", k2.desde.toISOString(), getStartOfDayUTC("2026-09-19", "America/Sao_Paulo").toISOString());

  console.log("\n== dois caixas no MESMO dia não podem repetir número ==");
  // Caixa que abriu HOJE às 22h, depois de a loja já ter vendido de manhã.
  const abertoHoje = { id: "cs_2", openedAt: new Date("2026-09-20T01:00:00Z") }; // 22:00 do dia 19
  const noiteDoDia19 = new Date("2026-09-20T01:30:00Z"); // 22:30 do dia 19
  const k3 = await chaveDoContador(dbCom(abertoHoje), "loja1", noiteDoDia19);
  conferir("a chave é o turno novo", k3.dateKey, "caixa:cs_2");
  conferir(
    "mas a semente volta ao INÍCIO DO DIA — senão o #1 da manhã se repetiria à noite",
    k3.desde.toISOString(),
    getStartOfDayUTC("2026-09-19", "America/Sao_Paulo").toISOString(),
  );

  console.log("\n== ler o caixa falhou: a numeração não pode parar ==");
  const k4 = await chaveDoContador(dbQueQuebra, "loja1", madrugada);
  conferir("cai para o comportamento de sempre", k4.dateKey, "2026-09-19");

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
