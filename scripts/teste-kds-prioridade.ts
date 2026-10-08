/**
 * Quem fura a fila da cozinha: `kdsConfig.prioridade` (lib/kds-telas.ts).
 *
 *   npx tsx scripts/teste-kds-prioridade.ts
 *
 * Pizzaria 17, 08/10/2026: o garçom lança a mesa e ela fica atrás de um monte
 * de delivery. A loja marca "Mesa" e a mesa passa na frente — sem passar por
 * cima do item faltante nem da rota criada, que já eram prioridade.
 */
import { furaAFila, lerKdsConfig, ordenarPelaPrioridade, tipoNaFila } from "../src/lib/kds-telas";

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

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
