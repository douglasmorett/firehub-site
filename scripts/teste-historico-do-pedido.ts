/**
 * Teste da leitura do histórico de edição (lib/historico-do-pedido.ts) — o
 * que a comanda marca como editado e o que mostra como removido. O texto é o
 * que api/store/orders/[id]/itens grava. Rodar: npx tsx scripts/teste-historico-do-pedido.ts
 */
import { edicoesDosItens, lerHistorico } from "../src/lib/historico-do-pedido";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const quando = "2026-10-09T23:13:00.000Z";
const historico = [
  { quando, quem: "Fellipe", acao: "REMOVEU", descricao: "−Batata frita, Coca 2L 2x → 1x", totalAntes: 80, totalDepois: 55 },
  { quando, quem: "Ana", acao: "ACRESCENTOU", descricao: "+2x Pastel de carne (catupiry)", totalAntes: 55, totalDepois: 71 },
  { quando, quem: "Ana", acao: "MUDOU_QTD", descricao: "X Tudo 1x → 3x (pago na plataforma: total mantido)", totalAntes: 71, totalDepois: 71 },
  { quando, quem: "Ana", acao: "PAGAMENTO", descricao: "Dinheiro → Pix", totalAntes: 71, totalDepois: 71 },
  null,
];

const { marcasDe, removidos } = edicoesDosItens(historico);
confere("removido", removidos.map((r) => [r.nome, r.quem]), [["Batata frita", "Fellipe"]]);
confere("quantidade mudou", marcasDe("Coca 2L"), [{ tipo: "QUANTIDADE", antes: 2, depois: 1, quando, quem: "Fellipe" }]);
confere("acrescentado com escolhas casa pelo nome", marcasDe("Pastel de carne").map((m) => [m.tipo, (m as any).quantidade]), [["ACRESCENTADO", 2]]);
confere("sufixo do marketplace sai", marcasDe("X Tudo").map((m) => [(m as any).antes, (m as any).depois]), [[1, 3]]);
confere("maiúscula e espaço não atrapalham", marcasDe("  coca  2l ").length, 1);
confere("item sem mudança", marcasDe("Guaraná"), []);
confere("pagamento não vira item", marcasDe("Dinheiro").length + marcasDe("Pix").length, 0);
confere("histórico lido sem o nulo", lerHistorico(historico).length, 4);
confere("sem histórico", edicoesDosItens(undefined).removidos, []);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
