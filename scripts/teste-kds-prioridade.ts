/**
 * Quem fura a fila da cozinha: `kdsConfig.prioridade` (lib/kds-telas.ts).
 *
 *   npx tsx scripts/teste-kds-prioridade.ts
 *
 * Pizzaria 17, 08/10/2026: o garçom lança a mesa e ela fica atrás de um monte
 * de delivery. A loja marca "Mesa" e a mesa passa na frente — sem passar por
 * cima do item faltante nem da rota criada, que já eram prioridade.
 */
import { filtroDosTiposPrioritarios, furaAFila, lerKdsConfig, ordenarPelaPrioridade, tipoNaFila } from "../src/lib/kds-telas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

type P = { id: string; deliveryType: string; source: string; createdAt: string; isRoutePriority?: boolean; prioridadeNaCozinha?: boolean };
const p = (id: string, deliveryType: string, source: string, hora: string, extra: Partial<P> = {}): P => ({
  id, deliveryType, source, createdAt: `2026-10-08T${hora}:00.000Z`, ...extra,
});
const ids = (l: P[]) => l.map((x) => x.id);

// ── tipo de cada pedido ──
confere("mesa", tipoNaFila({ deliveryType: "MESA", source: "PRESENCIAL" }), "MESA");
confere("delivery do iFood", tipoNaFila({ deliveryType: "DELIVERY", source: "IFOOD" }), "DELIVERY");
confere("delivery lançado no balcão continua delivery", tipoNaFila({ deliveryType: "DELIVERY", source: "PRESENCIAL" }), "DELIVERY");
confere("balcão para levar", tipoNaFila({ deliveryType: "RETIRADA", source: "PRESENCIAL" }), "BALCAO");
confere("totem", tipoNaFila({ deliveryType: "TAKEOUT", source: "TOTEM" }), "BALCAO");
confere("retirada do site", tipoNaFila({ deliveryType: "PICKUP", source: "ONLINE" }), "RETIRADA");
confere("retirada do robô", tipoNaFila({ deliveryType: "RETIRADA", source: "WHATSAPP_IA" }), "RETIRADA");

// ── leitura da configuração ──
confere("ausente = ninguém na frente", lerKdsConfig(null).prioridade, []);
confere("lixo e repetido saem, ordem fixa", lerKdsConfig({ prioridade: ["delivery", "MESA", "mesa", "x", 3] }).prioridade, ["MESA", "DELIVERY"]);
confere("não apaga soNaFinalizacao", lerKdsConfig({ soNaFinalizacao: ["Bebidas"], prioridade: ["MESA"] }).soNaFinalizacao, ["Bebidas"]);

// ── a fila da Pizzaria 17 ──
const fila = [
  p("d1", "DELIVERY", "IFOOD", "22:00"),
  p("d2", "DELIVERY", "ONLINE", "22:05"),
  p("m1", "MESA", "PRESENCIAL", "22:10"),
  p("d3", "DELIVERY", "IFOOD", "22:12"),
  p("m2", "MESA", "PRESENCIAL", "22:15"),
];
confere("sem prioridade: ordem de chegada (a lista volta igual)", ids(ordenarPelaPrioridade(fila, lerKdsConfig(null))), ["d1", "d2", "m1", "d3", "m2"]);
confere("mesa marcada: mesas na frente, cada grupo pela chegada", ids(ordenarPelaPrioridade(fila, lerKdsConfig({ prioridade: ["MESA"] }))), ["m1", "m2", "d1", "d2", "d3"]);
confere("não altera a lista de entrada", ids(fila), ["d1", "d2", "m1", "d3", "m2"]);

// ── as prioridades que já existiam continuam por cima ──
const comRota = [
  p("m1", "MESA", "PRESENCIAL", "22:10"),
  p("r1", "DELIVERY", "IFOOD", "22:20", { isRoutePriority: true }),
  p("x1", "DELIVERY", "IFOOD", "22:30", { prioridadeNaCozinha: true }),
  p("d1", "DELIVERY", "IFOOD", "22:00"),
];
confere("reposição > rota > mesa > resto", ids(ordenarPelaPrioridade(comRota, lerKdsConfig({ prioridade: ["MESA"] }))), ["x1", "r1", "m1", "d1"]);

// ── mais de um tipo marcado ──
const mistura = [
  p("d1", "DELIVERY", "IFOOD", "22:00"),
  p("b1", "RETIRADA", "PRESENCIAL", "22:03"),
  p("m1", "MESA", "PRESENCIAL", "22:06"),
  p("s1", "PICKUP", "ONLINE", "22:01"),
];
confere("mesa e balcão marcados: os dois pela chegada, depois o resto", ids(ordenarPelaPrioridade(mistura, lerKdsConfig({ prioridade: ["MESA", "BALCAO"] }))), ["b1", "m1", "d1", "s1"]);

// ── o selo do card ──
confere("selo na mesa quando mesa é prioridade", furaAFila({ deliveryType: "MESA", source: "PRESENCIAL" }, lerKdsConfig({ prioridade: ["MESA"] })), true);
confere("sem selo no delivery", furaAFila({ deliveryType: "DELIVERY", source: "IFOOD" }, lerKdsConfig({ prioridade: ["MESA"] })), false);
confere("sem configuração, sem selo", furaAFila({ deliveryType: "MESA", source: "PRESENCIAL" }, null), false);

// ── a busca extra dos prioritários (a janela de 100 do KDS) ──
confere("sem tipo marcado, nada a buscar", filtroDosTiposPrioritarios([]), null);
confere("sem configuração, nada a buscar", filtroDosTiposPrioritarios(null), null);
confere("mesa: pelo tipo MESA", filtroDosTiposPrioritarios(["MESA"]), { OR: [{ deliveryType: "MESA" }] });
confere("delivery: pelo tipo DELIVERY", filtroDosTiposPrioritarios(["DELIVERY"]), { OR: [{ deliveryType: "DELIVERY" }] });
confere("balcão e retirada juntos: o que não é mesa nem delivery (inclui sem tipo), uma vez só",
  filtroDosTiposPrioritarios(["BALCAO", "RETIRADA"]),
  { OR: [{ deliveryType: { notIn: ["MESA", "DELIVERY"] } }, { deliveryType: null }] });
confere("Ragnar: mesa, balcão e retirada",
  filtroDosTiposPrioritarios(["MESA", "BALCAO", "RETIRADA"]),
  { OR: [{ deliveryType: "MESA" }, { deliveryType: { notIn: ["MESA", "DELIVERY"] } }, { deliveryType: null }] });
// A mesa nova (fora dos 100 mais antigos) entra na lista e passa à frente.
const cem = Array.from({ length: 100 }, (_, i) => p(`d${i}`, "DELIVERY", "IFOOD", `20:${String(i % 60).padStart(2, "0")}`));
const mesaNova = p("mesaNova", "MESA", "PRESENCIAL", "23:30");
confere("a mesa nova, trazida pela busca extra, fura os 100 mais antigos",
  ids(ordenarPelaPrioridade([...cem, mesaNova], lerKdsConfig({ prioridade: ["MESA"] }))).slice(0, 2), ["mesaNova", "d0"]);

// ── a fila pelo NÚMERO do pedido (Garagem Burger, 18/11/2026) ──
// #37 do site gravado às 17:57:38 e #36 do robô às 17:58:10: o 36 vem antes.
type N = P & { franchiseeId: string; dailyOrderNumber?: number | null; items?: { prontoEm?: string | null }[] };
const n = (id: string, numero: number | null, hora: string, extra: Partial<N> = {}): N => ({
  id, deliveryType: "DELIVERY", source: "ONLINE", createdAt: `2026-11-18T${hora}.000Z`, franchiseeId: "g", dailyOrderNumber: numero, ...extra,
});
const fechou = new Date("2026-11-18T05:00:00.000Z").getTime();
const garagem = { g: { sorteada: false, desde: fechou } };
const filaG = [n("p37", 37, "17:57:38"), n("p36", 36, "17:58:10", { source: "WHATSAPP_IA" }), n("p38", 38, "17:59:00")];
confere("sem a numeração da loja: chegada (como antes)", ids(ordenarPelaPrioridade(filaG, lerKdsConfig(null))), ["p37", "p36", "p38"]);
confere("com a numeração: pelo número", ids(ordenarPelaPrioridade(filaG, lerKdsConfig(null), "production", null, garagem)), ["p36", "p37", "p38"]);
confere("numeração sorteada: chegada", ids(ordenarPelaPrioridade(filaG, lerKdsConfig(null), "production", null, { g: { sorteada: true, desde: fechou } })), ["p37", "p36", "p38"]);
confere("loja sem leitura: chegada", ids(ordenarPelaPrioridade(filaG, lerKdsConfig(null), "production", null, {})), ["p37", "p36", "p38"]);
// O caixa fechou às 05:00 e o contador voltou ao 1: o #90 de antes, preso na
// cozinha, continua na frente do #1 de hoje.
const virada = [n("hoje2", 2, "18:10:00"), n("hoje1", 1, "18:00:00"), n("ontem90", 90, "02:00:00")];
confere("contagem anterior ao fechamento vai na frente", ids(ordenarPelaPrioridade(virada, lerKdsConfig(null), "production", null, garagem)), ["ontem90", "hoje1", "hoje2"]);
confere("sem número: depois dos numerados", ids(ordenarPelaPrioridade([n("sem", null, "17:00:00"), ...filaG], lerKdsConfig(null), "production", null, garagem)), ["p36", "p37", "p38", "sem"]);
// As prioridades da loja continuam acima do número.
const comPrioridade = [
  n("p40", 40, "18:00:00"),
  n("rota", 45, "18:05:00", { isRoutePriority: true }),
  n("repos", 50, "18:06:00", { prioridadeNaCozinha: true }),
  n("mesa", 47, "18:07:00", { deliveryType: "MESA", source: "PRESENCIAL" }),
  n("p39", 39, "18:08:00"),
];
confere("reposição, rota e tipo marcado na frente; o resto pelo número",
  ids(ordenarPelaPrioridade(comPrioridade, lerKdsConfig({ prioridade: ["MESA"] }), "production", null, garagem)), ["repos", "rota", "mesa", "p39", "p40"]);
// Finalização separada: vale a chegada NELA (a primeira baixa), não o número.
const fin = [
  n("f9", 9, "18:00:00", { items: [{ prontoEm: "2026-11-18T18:20:00.000Z" }] }),
  n("f8", 8, "18:01:00", { items: [{ prontoEm: "2026-11-18T18:25:00.000Z" }] }),
];
confere("finalização separada: pela chegada na finalização",
  ids(ordenarPelaPrioridade(fin, lerKdsConfig({ prioridadeNaFinalizacao: [] }), "finishing", null, garagem)), ["f9", "f8"]);
confere("finalização comum: pelo número",
  ids(ordenarPelaPrioridade(fin, lerKdsConfig(null), "finishing", null, garagem)), ["f8", "f9"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
