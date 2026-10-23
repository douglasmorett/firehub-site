/**
 * Pergunta obrigatória sem resposta (src/lib/preco-combo.ts,
 * `perguntasObrigatoriasSemResposta`): o POST do site e do totem recusam.
 * Lapastine, 22/10/2026, pedido 4: "COMBO SIMPLES" chegou do site sem nenhuma
 * escolha, com tamanho/sabor/cebola obrigatórios.
 *
 *   npx tsx scripts/teste-pergunta-obrigatoria-no-pedido.ts
 */
import { perguntasObrigatoriasSemResposta } from "../src/lib/preco-combo";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

const opcao = (name: string, extra: Record<string, unknown> = {}, active = true) =>
  ({ additionalPrice: 0, ...extra, menuProduct: { name, price: 0, active } });

// O COMBO SIMPLES da Lapastine, resumido: tamanho, sabor, meia opcional,
// borda POR tamanho (só aparece depois do tamanho) e cebola obrigatória.
const comboSimples = {
  price: 47,
  isCombo: true,
  comboGroups: [
    { id: "tam", title: "Tamanho", maxQty: 1, minQty: 1, items: [opcao("Média"), opcao("Família")] },
    { id: "sab", title: "Escolha o sabor", maxQty: 1, minQty: 1, items: [opcao("1/2 PIZZA CALABRESA"), opcao("1/2 PIZZA FRANGO")] },
    { id: "meia", title: "Quer a outra metade de outro sabor? (opcional)", maxQty: 1, minQty: 0, items: [opcao("1/2 PIZZA MISTA")] },
    { id: "bordaF", title: "Vamos de borda hoje?", maxQty: 1, minQty: 1, items: [opcao("BORDA DE CATUPIRY", { precoPorEscolha: { "Média": null, "Família": 8 } })] },
    { id: "ceb", title: "Cebola no seu pedido?", maxQty: 1, minQty: 1, items: [opcao("COM CEBOLA"), opcao("SEM CEBOLA")] },
  ],
};

const falta = (escolhas: any) => perguntasObrigatoriasSemResposta(comboSimples as any, escolhas);

confere("pedido 4 da Lapastine (sem nenhuma escolha): recusa e diz o que falta",
  falta(null).includes("Tamanho") && falta(null).includes("Escolha o sabor") && falta(null).includes("Cebola no seu pedido?"), falta(null));
confere("… a pergunta opcional não entra na lista", !falta(null).some((t) => t.includes("outra metade")), falta(null));
confere("objeto vazio = mesma coisa que nada", falta({}).length === falta(null).length, falta({}));
confere("tudo escolhido: passa",
  falta({ tam: { "Família": 1 }, sab: { "1/2 PIZZA FRANGO": 1 }, bordaF: { "BORDA DE CATUPIRY": 1 }, ceb: { "SEM CEBOLA": 1 } }).length === 0,
  falta({ tam: { "Família": 1 }, sab: { "1/2 PIZZA FRANGO": 1 }, bordaF: { "BORDA DE CATUPIRY": 1 }, ceb: { "SEM CEBOLA": 1 } }));
confere("faltou só a cebola: só ela",
  falta({ tam: { "Família": 1 }, sab: { "1/2 PIZZA FRANGO": 1 }, bordaF: { "BORDA DE CATUPIRY": 1 } }).join() === "Cebola no seu pedido?");

// A borda da Família é bloqueada com a Média: escolhendo Média, a pergunta
// some da tela e não pode ser exigida.
confere("pergunta escondida pela outra escolha (borda da Família com a Média) não conta",
  falta({ tam: { "Média": 1 }, sab: { "1/2 PIZZA CALABRESA": 1 }, ceb: { "COM CEBOLA": 1 } }).length === 0,
  falta({ tam: { "Média": 1 }, sab: { "1/2 PIZZA CALABRESA": 1 }, ceb: { "COM CEBOLA": 1 } }));

// Pergunta com todas as opções pausadas: a tela não a mostra.
const comPausa = { price: 10, comboGroups: [{ id: "g", title: "Sabor", maxQty: 1, minQty: 1, items: [opcao("Carne", {}, false)] }] };
confere("pergunta só com opção pausada não é exigida", perguntasObrigatoriasSemResposta(comPausa as any, null).length === 0);

// minQty nulo = regra antiga (exige maxQty).
const antigo = { price: 10, comboGroups: [{ id: "g", title: "Escolha 2", maxQty: 2, minQty: null, items: [opcao("A"), opcao("B")] }] };
confere("minQty nulo exige o maxQty", perguntasObrigatoriasSemResposta(antigo as any, { g: { A: 1 } }).join() === "Escolha 2");
confere("… e passa com os 2", perguntasObrigatoriasSemResposta(antigo as any, { g: { A: 1, B: 1 } }).length === 0);

// O que não se julga (recusar por não saber seria pior).
confere("lista do PDV (sem grupo): não julga", perguntasObrigatoriasSemResposta(comboSimples as any, [{ name: "Família", quantity: 1 }]).length === 0);
confere("sacola com pergunta que não existe mais: não julga",
  perguntasObrigatoriasSemResposta(comboSimples as any, { velho: { "Família": 1 } }).length === 0);
confere("escolhas em texto JSON também valem", perguntasObrigatoriasSemResposta(comboSimples as any, JSON.stringify({ tam: { "Família": 1 } }) as any).includes("Escolha o sabor"));
confere("produto sem pergunta: nada", perguntasObrigatoriasSemResposta({ price: 10 } as any, null).length === 0);

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
