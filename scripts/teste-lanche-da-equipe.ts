/**
 * O lanche dos motoboys (lib/lanche-da-equipe-regras.ts) — a conta do limite
 * do dia, a Promoção do Dia fora e "1 bebida por dia no crédito".
 *
 *   npx tsx scripts/teste-lanche-da-equipe.ts
 */
import { bebidasDoItem, contaDoLanche, dividirNoLimite, ehPromocaoDoDia, lerConfigDoLanche } from "../src/lib/lanche-da-equipe-regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— O limite do dia (R$ 22,90) —");
confere("primeiro lanche de R$ 19,90: tudo no combinado", dividirNoLimite(0, 19.9, 22.9), { coberto: 19.9, excedente: 0, restanteDepois: 3 });
confere("segundo de R$ 6,90 com R$ 3 livres: R$ 3,90 descontado", dividirNoLimite(19.9, 6.9, 22.9), { coberto: 3, excedente: 3.9, restanteDepois: 0 });
confere("limite já usado: tudo descontado", dividirNoLimite(22.9, 9.9, 22.9), { coberto: 0, excedente: 9.9, restanteDepois: 0 });
confere("exatamente o limite", dividirNoLimite(0, 22.9, 22.9), { coberto: 22.9, excedente: 0, restanteDepois: 0 });
confere("centavos não sobram (0,1 + 0,2)", dividirNoLimite(0.1, 0.2, 22.9).restanteDepois, 22.6);

console.log("\n— Promoção do Dia fora —");
confere("categoria 'Promoção do Dia'", ehPromocaoDoDia({ category: "Promoção do Dia" }), true);
confere("sem acento e caixa alta", ehPromocaoDoDia({ category: "PROMOCAO DO DIA" }), true);
confere("pela etiqueta (JSON em texto, como vem do banco)", ehPromocaoDoDia({ category: "Esfihas", tags: '["Promoção","Promoção do Dia"]' }), true);
confere("'Promoção' sozinha não é a do dia", ehPromocaoDoDia({ category: "Combos", tags: '["Promoção"]' }), false);
confere("esfiha normal", ehPromocaoDoDia({ category: "Esfihas Salgadas", tags: null }), false);

console.log("\n— Configuração —");
confere("padrão: desligado, R$ 22,90, 1 bebida por dia ligada", lerConfigDoLanche(null), { ativo: false, limite: 22.9, umaBebidaPorDia: true });
confere("valores lidos e arredondados", lerConfigDoLanche({ ativo: true, limite: "25.555", umaBebidaPorDia: true }), { ativo: true, limite: 25.56, umaBebidaPorDia: true });
confere("desligar pelo painel vale", lerConfigDoLanche({ umaBebidaPorDia: false }).umaBebidaPorDia, false);
confere("umaBebidaPorDia em texto fica no padrão", lerConfigDoLanche({ umaBebidaPorDia: "nao" }).umaBebidaPorDia, true);
confere("negativo é ignorado", lerConfigDoLanche({ limite: -5 }).limite, 22.9);

console.log("\n— 1 bebida por dia no crédito —");
// `excedente` = o que passou do limite (acerto); `fora` = a bebida a mais (fiado).
const lanche = { preco: 15.9, qtd: 1, bebidas: [] as number[] };
const lata = { preco: 6, qtd: 1, bebidas: [6] };
const base = { jaUsado: 0, limite: 22.9, umaBebidaPorDia: true, bebidasHoje: 0 };
const resumo = (c: ReturnType<typeof contaDoLanche>) => ({ coberto: c.coberto, excedente: c.excedente, bebidasNoCredito: c.bebidasNoCredito, bebidasFora: c.bebidasFora, fora: c.valorDasBebidasFora });
confere("lanche + 1 lata: tudo no crédito, a bebida do dia usada", resumo(contaDoLanche({ ...base, itens: [lanche, lata] })), { coberto: 21.9, excedente: 0, bebidasNoCredito: 1, bebidasFora: 0, fora: 0 });
confere("lanche + 2 latas: a 2ª vai pro fiado mesmo cabendo R$ 1", resumo(contaDoLanche({ ...base, itens: [lanche, { ...lata, qtd: 2 }] })), { coberto: 21.9, excedente: 0, bebidasNoCredito: 1, bebidasFora: 1, fora: 6 });
confere("2 bebidas diferentes: fica no crédito a mais barata", resumo(contaDoLanche({ ...base, itens: [{ preco: 12, qtd: 1, bebidas: [12] }, lata] })), { coberto: 6, excedente: 0, bebidasNoCredito: 1, bebidasFora: 1, fora: 12 });
confere("bebida do dia já usada: a lata vai toda pro fiado", resumo(contaDoLanche({ ...base, bebidasHoje: 1, jaUsado: 15.9, itens: [lata] })), { coberto: 0, excedente: 0, bebidasNoCredito: 0, bebidasFora: 1, fora: 6 });
confere("bebida do dia usada, mas lanche ainda cabe no limite", resumo(contaDoLanche({ ...base, bebidasHoje: 1, jaUsado: 6, itens: [lanche] })), { coberto: 15.9, excedente: 0, bebidasNoCredito: 0, bebidasFora: 0, fora: 0 });
confere("opção desligada: 2 latas no limite como antes", resumo(contaDoLanche({ ...base, umaBebidaPorDia: false, itens: [{ ...lata, qtd: 2 }] })), { coberto: 12, excedente: 0, bebidasNoCredito: 0, bebidasFora: 0, fora: 0 });
confere("bebida pro fiado + estouro do limite pro acerto", resumo(contaDoLanche({ ...base, itens: [{ ...lanche, preco: 20 }, { ...lata, qtd: 2 }] })), { coberto: 22.9, excedente: 3.1, bebidasNoCredito: 1, bebidasFora: 1, fora: 6 });

console.log("\n— Guaravita dentro do combo conta como a bebida —");
const mapa = { porId: { guara: 4.9, coca: 9.9 }, porNome: { "guaravita 280ml": 4.9, "coca-cola lata": 9.9 } };
const comboGuara = { menuProductId: "combo3", preco: 17.9, comboSelections: { g1: { "Esfirra de Carne": 3 }, g2: { "Guaravita 280ml": 1 } } };
const bebidasDoCombo = bebidasDoItem(comboGuara, mapa);
confere("combo '3 Clássicas + Guaravita' leva 1 bebida de R$ 4,90", bebidasDoCombo, [4.9]);
confere("formato do PDV (lista sem grupo) também acha", bebidasDoItem({ ...comboGuara, comboSelections: [{ name: "Guaravita 280ml", quantity: 1 }, { name: "Esfirra de Carne", quantity: 3 }] }, mapa), [4.9]);
confere("trocou por Coca no combo: conta a Coca (R$ 9,90)", bebidasDoItem({ ...comboGuara, comboSelections: { g2: { "Coca-Cola lata": 1 } } }, mapa), [9.9]);
confere("combo sem bebida não leva nenhuma", bebidasDoItem({ ...comboGuara, comboSelections: { g1: { "Esfirra de Carne": 4 } } }, mapa), []);
confere("bebida solta: o preço do item", bebidasDoItem({ menuProductId: "coca", preco: 9.9 }, mapa), [9.9]);
confere("opção desligada (sem mapa): nenhuma", bebidasDoItem(comboGuara, null), []);
const combo = { preco: 17.9, qtd: 1, bebidas: bebidasDoCombo };
confere("combo com Guaravita + Coca lata: Guaravita no crédito, Coca pro fiado", resumo(contaDoLanche({ ...base, itens: [combo, { preco: 9.9, qtd: 1, bebidas: [9.9] }] })), { coberto: 17.9, excedente: 0, bebidasNoCredito: 1, bebidasFora: 1, fora: 9.9 });
confere("2 combos com Guaravita: o 2º Guaravita pro fiado, o resto no limite", resumo(contaDoLanche({ ...base, itens: [{ ...combo, qtd: 2 }] })), { coberto: 22.9, excedente: 8, bebidasNoCredito: 1, bebidasFora: 1, fora: 4.9 });

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
