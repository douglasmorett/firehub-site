import { acharPedidoNoAcerto } from "../src/lib/achar-pedido-no-acerto";
let falhas = 0;
const ok = (nome: string, cond: boolean) => { if (!cond) falhas++; console.log(`${cond ? "✅" : "❌"} ${nome}`); };
const rel = [
  { motoboy: { name: "Ian" }, orders: [
    { id: "a", dailyOrderNumber: 64, ifoodReference: "9028", customerName: "Caio Barbara", createdAt: "2026-10-12T15:33:00Z", totalAmount: 91.09 },
    { id: "b", dailyOrderNumber: 164, customerName: "Maria", createdAt: "2026-10-12T20:00:00Z" },
  ] },
  { motoboy: { name: "Pablo" }, orders: [
    { id: "c", dailyOrderNumber: 64, ifoodReference: "5769", customerName: "André Reis", createdAt: "2026-10-13T15:35:00Z" },
    { id: "d", dailyOrderNumber: 48, openDeliveryReference: "518005", customerName: "Bárbara Garabini", createdAt: "2026-10-12T16:00:00Z" },
  ] },
];
const r64 = acharPedidoNoAcerto(rel, "64");
ok("64 acha os dois #64 (um por dia) e não o 164", r64.length === 2 && !r64.some(x => x.pedido.id === "b"));
ok("o mais recente primeiro, com o entregador", r64[0].entregador === "Pablo" && r64[1].entregador === "Ian");
ok("#9028 (iFood) acha o Caio com o Ian", (() => { const r = acharPedidoNoAcerto(rel, "#9028"); return r.length === 1 && r[0].entregador === "Ian"; })());
ok("nº do 99 acha", acharPedidoNoAcerto(rel, "518005")[0]?.pedido.id === "d");
ok("nome sem acento acha os dois Barbara", acharPedidoNoAcerto(rel, "barbara").length === 2);
ok("vazio não lista nada", acharPedidoNoAcerto(rel, "  ").length === 0);
if (falhas) process.exit(1);
console.log("tudo certo");
