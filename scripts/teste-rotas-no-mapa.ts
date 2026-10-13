/**
 * As LINHAS do mapa da roteirização (lib/rotas-no-mapa.ts), depois da queixa
 * do Lucas (Frangoso, 13/10/2026): "depois que despacha vai para aquele
 * monte de rota, monte de linha… o pedido fica embolado".
 *
 *   - rota despachada não vira linha, a não ser que o lojista peça ("Ver no
 *     mapa"); rota esperando motoboy vira;
 *   - fora da aba ROTAS, nenhuma linha de rota;
 *   - a linha liga só pinos que estão no mapa, nunca ponto de pedido entregue;
 *   - a poda das coordenadas tira quem saiu e devolve o MESMO objeto quando
 *     não há o que tirar (sem redesenho à toa).
 *
 *   npx tsx scripts/teste-rotas-no-mapa.ts
 *
 * Puro: sem banco, sem rede, sem navegador.
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

import { podarCoordenadas, pontosDaLinha, rotaJaDespachada, rotasComLinha } from "../src/lib/rotas-no-mapa";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n[1] Rota despachada ou não");
conferir("'🚀 Despachada' (como a tela guarda) é despachada", rotaJaDespachada({ status: "🚀 Despachada" }));
conferir("'DISPATCHED' (como o servidor manda) é despachada", rotaJaDespachada({ status: "DISPATCHED" }));
conferir("'⏳ Aguardando Despacho' NÃO é despachada", !rotaJaDespachada({ status: "⏳ Aguardando Despacho" }));
conferir("'PENDING' NÃO é despachada", !rotaJaDespachada({ status: "PENDING" }));
conferir("sem status NÃO é despachada", !rotaJaDespachada({}) && !rotaJaDespachada(null));

console.log("\n[2] Quais rotas viram linha");
// A noite da Frangoso: muitas rotas já na rua, uma montada esperando motoboy.
const rotas = [
  { id: "r5", status: "⏳ Aguardando Despacho", orders: [{ id: "p9" }, { id: "p10" }] },
  { id: "r4", status: "🚀 Despachada", orders: [{ id: "p7" }, { id: "p8" }] },
  { id: "r3", status: "🚀 Despachada", orders: [{ id: "p5" }, { id: "p6" }] },
  { id: "r2", status: "🚀 Despachada", orders: [{ id: "p3" }, { id: "p4" }] },
  { id: "r1", status: "🚀 Despachada", orders: [{ id: "p1" }, { id: "p2" }] },
];
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
conferir(
  "aba ROTAS sem foco: só a rota esperando motoboy (era uma linha para CADA rota do dia)",
  igual(ids(rotasComLinha(rotas, { aba: "ROTAS", rotaEmFoco: null })), ["r5"]),
  ids(rotasComLinha(rotas, { aba: "ROTAS", rotaEmFoco: null })),
);
conferir(
  "aba ROTAS com 'Ver no mapa' numa despachada: ela entra, as outras despachadas não",
  igual(ids(rotasComLinha(rotas, { aba: "ROTAS", rotaEmFoco: "r3" })), ["r5", "r3"]),
  ids(rotasComLinha(rotas, { aba: "ROTAS", rotaEmFoco: "r3" })),
);
conferir(
  "foco numa rota esperando motoboy não duplica a linha dela",
  igual(ids(rotasComLinha(rotas, { aba: "ROTAS", rotaEmFoco: "r5" })), ["r5"]),
);
conferir(
  "aba de PEDIDOS PENDENTES: nenhuma linha de rota (nem a em foco)",
  rotasComLinha(rotas, { aba: "PENDING", rotaEmFoco: "r3" }).length === 0,
);
conferir(
  "foco em rota que saiu da lista não inventa linha",
  igual(ids(rotasComLinha(rotas, { aba: "ROTAS", rotaEmFoco: "r-apagada" })), ["r5"]),
);

console.log("\n[3] Por onde a linha passa");
const loja = { lat: -22.85, lng: -42.03 };
// p1 foi entregue há mais de 10 s: saiu do mapa (não está em `noMapa`), mas a
// geocodificação ainda lembraria dele — a linha NÃO pode ir até lá.
const noMapa = { p2: { lat: -22.86, lng: -42.04 }, p3: { lat: -22.87, lng: -42.05 } };
conferir(
  "loja → só os pedidos com pino, na ordem da rota",
  igual(pontosDaLinha({ id: "x", orders: [{ id: "p1" }, { id: "p3" }, { id: "p2" }] }, noMapa, loja), [
    [-22.85, -42.03], [-22.87, -42.05], [-22.86, -42.04],
  ]),
  pontosDaLinha({ id: "x", orders: [{ id: "p1" }, { id: "p3" }, { id: "p2" }] }, noMapa, loja),
);
conferir(
  "rota com todos os pedidos entregues: sem linha (só a loja não é linha)",
  pontosDaLinha({ id: "x", orders: [{ id: "p1" }] }, noMapa, loja).length === 0,
);
conferir(
  "sem o ponto da loja, a linha começa no primeiro pedido",
  igual(pontosDaLinha({ id: "x", orders: [{ id: "p2" }, { id: "p3" }] }, noMapa, null), [
    [-22.86, -42.04], [-22.87, -42.05],
  ]),
);
conferir(
  "sem loja e com um pedido só: sem linha",
  pontosDaLinha({ id: "x", orders: [{ id: "p2" }] }, noMapa, null).length === 0,
);

console.log("\n[4] Poda das coordenadas");
const mapa = { a: { lat: 1, lng: 1 }, b: { lat: 2, lng: 2 }, c: { lat: 3, lng: 3 } };
const podado = podarCoordenadas(mapa, new Set(["a", "c", "z"]));
conferir("tira quem não tem mais pino", igual(Object.keys(podado).sort(), ["a", "c"]), podado);
conferir("não mexe no objeto original", Object.keys(mapa).length === 3);
conferir("nada a tirar → o MESMO objeto (o React não redesenha)", podarCoordenadas(mapa, new Set(["a", "b", "c", "d"])) === mapa);
conferir("mapa vazio → o mesmo objeto", (() => { const v = {}; return podarCoordenadas(v, new Set()) === v; })());

console.log(`\n${ok} ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
