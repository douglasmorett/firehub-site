/**
 * As rotas automáticas no relatório do acerto de entregadores
 * (lib/relatorios/acerto-de-entregadores.ts, `rotasAutomaticasDoPeriodo`) —
 * a conta pura, com dados inventados:
 *
 *   [1] rotas, entregas e entregas por rota (cancelado não é entrega);
 *   [2] da chamada ao 1º pedido puxado, em minutos (o cancelado puxado conta);
 *   [3] rota sem chamada, sem puxar ou puxada ANTES da chamada fica fora da média;
 *   [4] rota sem pedido nenhum (LEFT JOIN) conta como rota com 0 entregas;
 *   [5] nada no período: zeros e nulos, sem dividir por zero.
 *
 *   npx tsx scripts/teste-rotas-automaticas-no-relatorio.ts
 */
export {};

import { rotasAutomaticasDoPeriodo, type PedidoDaRotaAutomatica } from "../src/lib/relatorios/acerto-de-entregadores";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

const h = (hhmm: string) => new Date(`2026-10-22T${hhmm}:00-03:00`);
const linha = (rotaId: string, chamadaEm: Date | null, status: string | null, puxado: Date | null): PedidoDaRotaAutomatica => ({ rotaId, chamadaEm, status, motoboyPuxadoEm: puxado });

console.log("\n[1][2] três rotas chamadas e puxadas");
{
  const r = rotasAutomaticasDoPeriodo([
    // Rota A: chamada 19:00, puxada 19:04 (o 1º puxado) — 3 entregas.
    linha("A", h("19:00"), "ENTREGUE", h("19:05")),
    linha("A", h("19:00"), "ENTREGUE", h("19:04")),
    linha("A", h("19:00"), "SAIU_ENTREGA", h("19:06")),
    // Rota B: chamada 20:10, o cancelado foi o 1º puxado (20:12) — 1 entrega.
    linha("B", h("20:10"), "CANCELADO", h("20:12")),
    linha("B", h("20:10"), "ENTREGUE", h("20:13")),
    // Rota C: chamada 21:00, puxada 21:08 — 2 entregas.
    linha("C", "2026-10-23T00:00:00.000Z" as any, "ENTREGUE", "2026-10-23T00:08:00.000Z" as any),
    linha("C", "2026-10-23T00:00:00.000Z" as any, "ENTREGUE", null),
  ]);
  conferir("3 rotas", r.rotas === 3, r);
  conferir("6 entregas (o cancelado fica fora)", r.entregas === 6, r);
  conferir("2 entregas por rota", r.entregasPorRota === 2, r);
  // (4 + 2 + 8) / 3 = 4,67 → 4,7
  conferir("chamada → puxar: 4,7 min (4, 2 e 8)", r.chamadaAtePuxarMin === 4.7, r);
  conferir("3 rotas na média", r.rotasComTempo === 3, r);
}

console.log("\n[3] fora da média do tempo");
{
  const r = rotasAutomaticasDoPeriodo([
    linha("semChamada", null, "ENTREGUE", h("19:04")), // despachada antes de chamar
    linha("semPuxar", h("19:00"), "ENTREGUE", null), // a loja despachou pela Roteirização
    linha("antes", h("19:10"), "ENTREGUE", h("19:05")), // escaneada antes da chamada
    linha("conta", h("19:00"), "ENTREGUE", h("19:10")),
  ]);
  conferir("4 rotas, 4 entregas", r.rotas === 4 && r.entregas === 4, r);
  conferir("só a rota 'conta' entra no tempo: 10 min", r.chamadaAtePuxarMin === 10 && r.rotasComTempo === 1, r);
}

console.log("\n[4] rota sem pedido");
{
  const r = rotasAutomaticasDoPeriodo([linha("vazia", h("19:00"), null, null), linha("X", null, "ENTREGUE", null), linha("X", null, "cancelado", null)]);
  conferir("2 rotas, 1 entrega (cancelado em minúscula também é cancelado)", r.rotas === 2 && r.entregas === 1, r);
  conferir("0,5 entrega por rota", r.entregasPorRota === 0.5, r);
  conferir("sem tempo", r.chamadaAtePuxarMin === null && r.rotasComTempo === 0, r);
}

console.log("\n[5] período vazio");
{
  const r = rotasAutomaticasDoPeriodo([]);
  conferir("zeros e nulos", r.rotas === 0 && r.entregas === 0 && r.entregasPorRota === null && r.chamadaAtePuxarMin === null && r.rotasComTempo === 0, r);
}

console.log(`\n${ok} ok, ${falhou} falharam`);
if (falhou > 0) process.exit(1);
