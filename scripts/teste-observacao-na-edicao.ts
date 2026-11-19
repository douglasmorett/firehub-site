/**
 * Teste da observação editável no pedido já lançado (lib/observacao-na-edicao.ts
 * e avaliarEdicaoDaObservacao em lib/edicao-de-pedido.ts). Caso real: Garagem
 * Burger, 19/11/2026 — "2 Hot Dog Prensado" (sem pergunta, NFC-e emitida), o
 * cliente avisou "sem mostarda" depois de fechar o pedido.
 * Rodar: npx tsx scripts/teste-observacao-na-edicao.ts
 */
import {
  gravacaoDasObservacoes,
  itensComObservacaoAlterada,
  obsAlteradaEsperandoACozinha,
} from "../src/lib/observacao-na-edicao";
import { avaliarEdicao, avaliarEdicaoDaObservacao, empilharEdicao } from "../src/lib/edicao-de-pedido";
import { edicoesDosItens } from "../src/lib/historico-do-pedido";
import { telaTemPendencia, type TelaDoKds } from "../src/lib/kds-telas";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const dono = { role: "FRANCHISEE" };
const quem = { nome: "Thalyta (dono)", id: "u1" };
const baixa = new Date("2026-11-19T14:40:00Z");
// A tela da Garagem: uma só, produção, sem filtro.
const tela1 = { id: "t1", name: "Tela 1", stage: "production", filter: "all", categoryFilter: [] } as unknown as TelaDoKds;

/** Aplica a gravação como a rota faz (itens + rastro), sem banco. */
function aplicar(pedido: any, g: NonNullable<ReturnType<typeof gravacaoDasObservacoes>>) {
  return {
    ...pedido,
    items: pedido.items.map((i: any) => {
      const w = g.itens.find((x) => x.id === i.id);
      return w ? { ...i, ...w.data } : i;
    }),
    editHistory: empilharEdicao(pedido.editHistory, g.registro),
  };
}

// ── 1. Pedido próprio, ainda na produção (sem baixa) ──────────────────────
const naProducao = {
  id: "p1", status: "ACEITO", deliveryType: "DELIVERY", source: "ONLINE", totalAmount: 45,
  fiscalStatus: "PENDING", kdsStage: "PRODUCTION", kdsFinishedAt: null, editHistory: null,
  items: [
    { id: "dog", productName: "2 Hot Dog Prensado", quantity: 1, price: 40, notes: null, prontoEm: null },
    { id: "coca", productName: "Coca Cola 2l", quantity: 1, price: 5, notes: null, prontoEm: null },
  ],
};
confere("pedido próprio aceita observação", avaliarEdicaoDaObservacao(naProducao, dono).modo, "COMPLETO");
const g1 = gravacaoDasObservacoes(naProducao, quem, [{ itemId: "dog", notes: "  sem mostarda " }])!;
confere("só o dog muda, só o texto (sem preço/quantidade)", g1.itens, [{ id: "dog", data: { notes: "sem mostarda" } }]);
confere("total igual antes e depois", [g1.registro.totalAntes, g1.registro.totalDepois], [45, 45]);
confere("rastro com quem e o texto", [g1.registro.acao, g1.registro.quem, g1.registro.descricao], ["OBSERVACAO", "Thalyta (dono)", '📝 2 Hot Dog Prensado: "sem mostarda"']);
const p1 = aplicar(naProducao, g1);
confere("item sem baixa: atualizado no lugar, sem duplicar", p1.items.map((i: any) => [i.id, i.notes]), [["dog", "sem mostarda"], ["coca", null]]);
confere("KDS: selo no dog", [...itensComObservacaoAlterada(p1.editHistory)], ["dog"]);
confere("KDS: continua na tela de produção", telaTemPendencia(tela1, p1.items), true);
confere("histórico da comanda não confunde com item editado", edicoesDosItens(p1.editHistory).marcasDe("2 Hot Dog Prensado"), []);
confere("mesma observação de novo: nada a gravar", gravacaoDasObservacoes(p1, quem, [{ itemId: "dog", notes: "sem mostarda" }]), null);
confere("item de outro pedido: ignorado", gravacaoDasObservacoes(naProducao, quem, [{ itemId: "outro", notes: "x" }]), null);

// ── 2. Já teve baixa no KDS, encerrado na cozinha, NFC-e emitida ──────────
const jaPronto = {
  ...naProducao, id: "p2", status: "PRONTO", fiscalStatus: "EMITTED",
  fiscalInfo: { nfceKey: "3526...", nfceNumber: 62, ambiente: 1 },
  kdsStage: "FINISHED", kdsFinishedAt: baixa,
  items: naProducao.items.map((i) => ({ ...i, prontoEm: baixa })),
};
confere("nota emitida trava a edição dos itens", avaliarEdicao(jaPronto, dono).modo, "BLOQUEADO");
confere("...mas não a observação", avaliarEdicaoDaObservacao(jaPronto, dono).modo, "COMPLETO");
confere("sem a nova, o pedido encerrado não volta ao KDS", obsAlteradaEsperandoACozinha(jaPronto), false);
const g2 = gravacaoDasObservacoes(jaPronto, quem, [{ itemId: "dog", notes: "sem mostarda" }], new Date("2026-11-19T14:45:00Z"))!;
confere("item com baixa: prontoEm zerado (volta para a cozinha)", g2.itens, [{ id: "dog", data: { notes: "sem mostarda", prontoEm: null } }]);
const p2 = aplicar(jaPronto, g2);
confere("pedido encerrado volta à produção por causa do dog", obsAlteradaEsperandoACozinha(p2), true);
confere("na Tela 1 ele aparece (só o dog por fazer)", [telaTemPendencia(tela1, p2.items), p2.items.filter((i: any) => !i.prontoEm).map((i: any) => i.id)], [true, ["dog"]]);
confere("status, etapa e total do pedido intocados", [p2.status, p2.kdsStage, p2.totalAmount], ["PRONTO", "FINISHED", 45]);
confere("rastro de quem tirou a observação", gravacaoDasObservacoes(p2, quem, [{ itemId: "dog", notes: "" }])!.registro.descricao, '📝 2 Hot Dog Prensado: "sem mostarda" → (sem observação)');
const refeito = { ...p2, items: p2.items.map((i: any) => ({ ...i, prontoEm: new Date("2026-11-19T14:50:00Z") })) };
confere("cozinha deu baixa de novo: sai da produção", obsAlteradaEsperandoACozinha(refeito), false);
confere("...e o selo continua para quem olhar o item", itensComObservacaoAlterada(refeito.editHistory).has("dog"), true);

// ── 3. A comida já saiu (delivery na rua / entregue): não volta ───────────
const naRua = { ...jaPronto, status: "SAIU_ENTREGA" };
confere("entrega na rua: só registra, a cozinha não refaz", gravacaoDasObservacoes(naRua, quem, [{ itemId: "dog", notes: "sem mostarda" }])!.itens, [{ id: "dog", data: { notes: "sem mostarda" } }]);
const retiradaPronta = { ...jaPronto, status: "SAIU_ENTREGA", deliveryType: "RETIRADA" };
confere("retirada 'pronta no balcão': ainda volta", gravacaoDasObservacoes(retiradaPronta, quem, [{ itemId: "dog", notes: "sem mostarda" }])!.itens[0].data.prontoEm, null);

// ── 4. Marketplace pago no app: observação passa, total não muda ──────────
const ifood = {
  ...naProducao, id: "p4", source: "IFOOD", ifoodOrderId: "if-1", paymentMethod: "Pago Online", isPrepaid: true, totalAmount: 61.9,
};
const av4 = avaliarEdicaoDaObservacao(ifood, dono);
confere("iFood: modo marketplace", [av4.modo, av4.totalMuda], ["MARKETPLACE", false]);
const g4 = gravacaoDasObservacoes(ifood, quem, [{ itemId: "dog", notes: "sem mostarda" }])!;
confere("iFood: total igual, nada além do texto", [g4.registro.totalAntes, g4.registro.totalDepois, Object.keys(g4.itens[0].data)], [61.9, 61.9, ["notes"]]);

// ── 5. As travas que continuam ────────────────────────────────────────────
confere("mesa: vai para o painel de Mesas", avaliarEdicaoDaObservacao({ ...naProducao, tableSessionId: "m1" }, dono).modo, "BLOQUEADO");
confere("cancelado: não edita", avaliarEdicaoDaObservacao({ ...naProducao, status: "CANCELADO" }, dono).modo, "BLOQUEADO");
confere("funcionário sem permissão: não edita", avaliarEdicaoDaObservacao(naProducao, { role: "STAFF", permissions: "" }).modo, "BLOQUEADO");

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
