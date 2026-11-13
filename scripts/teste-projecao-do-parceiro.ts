/**
 * scripts/teste-projecao-do-parceiro.ts — a projeção do mês recortada por
 * vendedor (lib/parceiro/projecao-do-parceiro.ts), sem banco.
 *
 * Pedido do Douglas (12/11/2026): "ver a projeção do mês para eles também,
 * igual eu vejo pra mim no total" — e cada vendedor só com as lojas dele.
 *
 *   npx tsx scripts/teste-projecao-do-parceiro.ts
 */
import { recortarProjecao } from "../src/lib/parceiro/projecao-do-parceiro";
import type { LinhaDaProjecao } from "../src/lib/projecao-do-mes";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};

const linha = (id: string, total: number, chance: number, vendidoNoMes = 1000): LinhaDaProjecao => ({
  id, loja: `Loja ${id}`, whatsapp: "5522999999999", vendedor: null, situacao: "PAGANDO", faixa: "MEDIA", testeAte: null,
  vendidoNoMes, porDia: 0, baseAteAgora: 0, baseProjetada: 0, mensalidade: total, extras: 0, taxas: 0, total,
  chance, porque: "", diasSemPedido: 1,
});

// A plataforma inteira: A e B são do vendedor; C e D, de outro.
const projecao = {
  mes: "2026-11",
  geradoEm: "2026-11-12T12:00:00.000Z",
  linhas: [linha("A", 200, 1, 10000), linha("B", 100, 0.5, 4000), linha("C", 400, 1, 20000), linha("D", 150, 0.25)],
};
const doVendedor = [
  { id: "A", percentual: 3, repasse: "CAI" as const },
  { id: "B", percentual: 10, repasse: "CAI" as const },
  { id: "E", percentual: 3, repasse: "CAI" as const }, // da carteira, sem boleto previsto (teste, isenta…)
];

const p = recortarProjecao(projecao, doVendedor);
confere("só as lojas dele entram", p.linhas.map((l) => l.id), ["A", "B"]);
confere("nenhuma loja de fora vaza", p.linhas.some((l) => l.id === "C" || l.id === "D"), false);
confere("conta as lojas dele e os boletos previstos", [p.lojas, p.boletos], [3, 2]);
confere("mensalidade: garantido / aposta / se todas (a régua da aba Projeção)", p.mensalidade, { garantido: 200, aposta: 250, seTodas: 300 });
// A: 3% de 200 = 6; B: 10% de 100 = 10 (pela chance, 5).
confere("comissão pelo % de cada loja", p.linhas.map((l) => l.comissao), [6, 10]);
confere("comissão: garantido / aposta / se todas", p.comissao, { garantido: 6, aposta: 11, seTodas: 16 });
confere("vendido no mês só das lojas dele", p.vendidoNoMes, 14000);
confere("mês e hora da projeção seguem", [p.mes, p.geradoEm], ["2026-11", "2026-11-12T12:00:00.000Z"]);

// Repasse que não cai (sem carteira do Asaas, teto do split): a comissão não conta, como no "mês atual" do portal.
const semCarteira = recortarProjecao(projecao, [{ id: "A", percentual: 3, repasse: "SEM_CARTEIRA" }, { id: "B", percentual: 10, repasse: "CAI" }]);
confere("repasse que não cai fica fora da comissão", semCarteira.comissao, { garantido: 0, aposta: 5, seTodas: 10 });
confere("e aparece separado como sem repasse", semCarteira.semRepasse, 6);
confere("a mensalidade da loja continua na projeção", semCarteira.mensalidade.seTodas, 300);

// Vendedor sem loja: tudo zero, sem erro.
const vazio = recortarProjecao(projecao, []);
confere("sem loja: zero boletos e zero comissão", [vazio.boletos, vazio.comissao.seTodas, vazio.mensalidade.seTodas], [0, 0, 0]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
