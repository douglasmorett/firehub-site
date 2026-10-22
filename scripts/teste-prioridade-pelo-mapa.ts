/**
 * "Pedir prioridade no KDS" pela Roteirização, um por um e em lote
 * (api/store/orders/[id]/prioridade, lib/lote-da-roteirizacao.ts).
 *
 *   npx tsx scripts/teste-prioridade-pelo-mapa.ts
 *
 * Pedido do Douglas (21/10/2026): quem despacha vê no mapa que o pedido pode
 * ir junto e manda ele para a frente da cozinha — e, selecionando vários, dá
 * pronto ou pede prioridade para todos com um aviso só.
 */
import { juntarPedidosDaProducao, ordenarPelaPrioridade, type KdsConfig } from "../src/lib/kds-telas";
import { lerRespostaDoLote, podePedirPrioridade, resumoDoLote, tirarDoPalpite } from "../src/lib/lote-da-roteirizacao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const min = (m: number) => new Date(Date.UTC(2026, 9, 21, 22, m)).toISOString();
type P = { id: string; prioridadeNaCozinha: boolean; isRoutePriority: boolean; deliveryType: string; createdAt: string };
const pedido = (id: string, m: number, extra: Partial<P> = {}): P => ({
  id, prioridadeNaCozinha: false, isRoutePriority: false, deliveryType: "DELIVERY", createdAt: min(m), ...extra,
});
const ids = (l: { id: string }[]) => l.map((p) => p.id);

console.log("\n— Ordem da cozinha —");
const fila = [
  pedido("velho", 0),
  pedido("rota", 5, { isRoutePriority: true }),
  pedido("mesa", 8, { deliveryType: "MESA" }),
  pedido("pedidoPelaLoja", 20, { prioridadeNaCozinha: true }),
  pedido("rotaEPrioridade", 25, { prioridadeNaCozinha: true, isRoutePriority: true }),
  pedido("novo", 30),
];
const comMesa: KdsConfig = { soNaFinalizacao: [], prioridade: ["MESA"] };
confere(
  "prioridade da loja > rota > tipo marcado (mesa) > chegada",
  ids(ordenarPelaPrioridade(fila, comMesa)),
  ["rotaEPrioridade", "pedidoPelaLoja", "rota", "mesa", "velho", "novo"],
);
confere(
  "sem tipo marcado a lista fica como a consulta mandou (a ordem é do banco: prioridadeNaCozinha, isRoutePriority, createdAt)",
  ids(ordenarPelaPrioridade(fila, { soNaFinalizacao: [], prioridade: [] })),
  ids(fila),
);
confere(
  "juntando produção e adiantados: o priorizado pela loja passa à frente da rota",
  ids(juntarPedidosDaProducao([pedido("a", 0), pedido("r", 5, { isRoutePriority: true })], [pedido("p", 40, { prioridadeNaCozinha: true })])),
  ["p", "r", "a"],
);
confere(
  "desfez a prioridade: volta para o lugar da chegada",
  ids(ordenarPelaPrioridade([pedido("b", 10), pedido("a", 0, { prioridadeNaCozinha: false })], comMesa)),
  ["a", "b"],
);

console.log("\n— O endpoint recusa pedido que já acabou —");
confere("PREPARANDO aceita", podePedirPrioridade("PREPARANDO"), true);
confere("PRONTO aceita (a tela é que esconde o botão)", podePedirPrioridade("PRONTO"), true);
confere("ENTREGUE recusa", podePedirPrioridade("ENTREGUE"), false);
confere("ENCERRADO recusa", podePedirPrioridade("encerrado"), false);
confere("CANCELADO recusa", podePedirPrioridade("CANCELADO"), false);
confere("CANCELLED (grafia antiga) recusa", podePedirPrioridade("CANCELLED"), false);

console.log("\n— Resposta de cada pedido do lote —");
confere("200 com success", lerRespostaDoLote(true, { success: true }), { ok: true });
confere("200 com precisaConfirmar é falha (a baixa não foi gravada)", lerRespostaDoLote(true, { success: false, precisaConfirmar: true }), { ok: false, motivo: "ainda tem item na produção" });
confere("409 traz o motivo do servidor", lerRespostaDoLote(false, { error: "O pedido já foi finalizado ou cancelado." }), { ok: false, motivo: "O pedido já foi finalizado ou cancelado." });
confere("erro sem corpo", lerRespostaDoLote(false, {}), { ok: false, motivo: "sem resposta do servidor" });

console.log("\n— O aviso único do lote —");
const tres = (falha?: string) => [
  { id: "a", numero: "21", ok: true },
  { id: "b", numero: "26", ok: true },
  falha ? { id: "c", numero: "27", ok: false, motivo: falha } : { id: "c", numero: "27", ok: true },
];
confere("3 de 3 prontos", resumoDoLote("pronto", tres()), { tipo: "ok", titulo: "3 pedidos marcados como prontos", falharam: [] });
confere("1 pronto (singular)", resumoDoLote("pronto", [{ id: "a", numero: "21", ok: true }]).titulo, "1 pedido marcado como pronto");
confere("3 de 3 prioridade", resumoDoLote("prioridade", tres()).titulo, "Prioridade pedida no KDS para 3 pedidos");
const umaFalha = resumoDoLote("pronto", tres("sem conexão"));
confere("lote com 1 falha devolve 2 de 3", umaFalha, { tipo: "atencao", titulo: "2 de 3: o #27 falhou (sem conexão)", falharam: ["c"] });
confere(
  "duas falhas",
  resumoDoLote("prioridade", [{ id: "a", numero: "21", ok: true }, { id: "b", numero: "26", ok: false, motivo: "x" }, { id: "c", numero: "27", ok: false }]).titulo,
  "1 de 3: o #26 falhou (x); o #27 falhou",
);
confere(
  "todas falharam",
  resumoDoLote("pronto", [{ id: "a", numero: "21", ok: false, motivo: "y" }]),
  { tipo: "erro", titulo: "Nenhum pedido foi marcado como pronto", detalhe: "O #21 falhou (y)", falharam: ["a"] },
);

console.log("\n— O palpite otimista depois do lote —");
const palpites = { a: 100, b: 100, c: 100, outro: 50 };
confere("desfaz só o palpite do que falhou", tirarDoPalpite(palpites, umaFalha.falharam), { a: 100, b: 100, outro: 50 });
confere("nada falhou: o mesmo objeto (sem redesenho à toa)", tirarDoPalpite(palpites, []) === palpites, true);
confere(
  "palpite da prioridade (valor + prazo) também",
  tirarDoPalpite({ a: { valor: true, ate: 1 }, c: { valor: true, ate: 1 } }, ["c"]),
  { a: { valor: true, ate: 1 } },
);

console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
if (falhas > 0) process.exit(1);
