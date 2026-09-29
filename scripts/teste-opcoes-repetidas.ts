/**
 * Listas de opções repetidas escritas uma vez só no prompt do robô
 * (src/lib/opcoes-repetidas.ts).
 *
 *   npx tsx scripts/teste-opcoes-repetidas.ts
 */
import { registroDeOpcoes } from "../src/lib/opcoes-repetidas";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

// Como na Divinos: a mesma lista de adicionais em cada hambúrguer.
const turbine = "Bacon +R$ 5,00 | Cheddar +R$ 4,00 | Ovo +R$ 2,00 | Hambúrguer extra +R$ 9,00 | Cebola caramelizada +R$ 3,00";
const acai = "Leite em pó (sem custo) | Confete (sem custo) | Granola (sem custo) | Paçoca (sem custo) | Jujuba (sem custo)";
const tamanho = "Pequena = R$ 30,00 | Grande = R$ 45,00 | Família = R$ 60,00 | Gigante = R$ 75,00";
const gelo = "Com gelo (sem custo)";

function montar() {
  const r = registroDeOpcoes();
  const combos = [
    ...Array.from({ length: 10 }, (_, i) => `- COMBO: "Burger ${i}" ➔ R$ ${20 + i}\n    ↳ Turbine seu Burger (opcional, até 5): ${r.marcar(turbine)}`),
    ...[300, 500].map((ml) => `- COMBO: "Açaí ${ml}" ➔ R$ ${ml / 30}\n    ↳ Complementos (opcional, até 3): ${r.marcar(acai)}`),
    `- COMBO: "Pizza Calabresa" ➔ a partir de R$ 30\n    ↳ Tamanho (obrigatório, escolha 1): ${r.marcar(tamanho)}`,
  ];
  const avulsos = [
    `- PRODUTO: "Açaí 700" ➔ R$ 19\n    ↳ Complementos (opcional, até 3): ${r.marcar(acai)}`,
    `- PRODUTO: "Refri" ➔ R$ 6\n    ↳ Gelo (opcional, até 1): ${r.marcar(gelo)}`,
    `- PRODUTO: "Suco" ➔ R$ 8\n    ↳ Gelo (opcional, até 1): ${r.marcar(gelo)}`,
  ];
  const naoVai = r.marcar("Lista de um produto que não entrou no prompt, longa o bastante para ser juntada");
  return { r, combos, avulsos, naoVai };
}

const { r, combos, avulsos, naoVai } = montar();
const { blocos: [c, a], secao } = r.resolver([combos, avulsos]);
const tudo = [secao, ...c, ...a].join("\n");

confere("nenhuma marca sobra no texto", !/\u0000/.test(tudo), tudo);
confere("a lista repetida vira UMA definição", (tudo.match(/Bacon \+R\$ 5,00/g) || []).length === 1, tudo);
confere("…e cada hambúrguer aponta para ela", c.slice(0, 10).every((l) => l.endsWith("mesmas opções e preços da LISTA L1")), c.slice(0, 3));
confere("título e regra ficam em cada produto", c[3].includes("Turbine seu Burger (opcional, até 5): mesmas opções"), c[3]);
confere("repetida entre combos e avulsos também junta", c[10].includes("LISTA L2") && a[0].includes("LISTA L2"), [c[10], a[0]]);
confere("lista que aparece uma vez fica escrita no lugar", c[12].includes(tamanho) && !secao.includes(tamanho), c[12]);
confere("lista curta repetida não vira referência (sairia mais cara)", a[1].includes(gelo) && a[2].includes(gelo) && !secao.includes(gelo));
confere("a seção traz as listas com rótulo, na ordem em que aparecem",
  secao.includes(`LISTA L1: ${turbine}`) && secao.includes(`LISTA L2: ${acai}`) && secao.indexOf("L1:") < secao.indexOf("L2:"), secao);
confere("marca de linha que não foi para o prompt não conta nem aparece", !secao.includes("não entrou") && naoVai.startsWith("\u0000"));

const semJuntar = [...combos, ...avulsos].join("\n").replace(/\u0000OP(\d+)\u0000/g, (_, n) => [turbine, acai, tamanho, gelo][Number(n)]);
confere("o texto fica menor", tudo.length < semJuntar.length * 0.8, { antes: semJuntar.length, depois: tudo.length });

// Loja pequena: duas cópias de uma lista curta não pagam o cabeçalho.
const p = registroDeOpcoes();
const pequena = [`- A\n    ↳ X (opcional, até 1): ${p.marcar("Sachê de ketchup (sem custo) | Sachê de maionese (sem custo)")}`, `- B\n    ↳ X (opcional, até 1): ${p.marcar("Sachê de ketchup (sem custo) | Sachê de maionese (sem custo)")}`];
const rp = p.resolver([pequena]);
confere("quando juntar não paga o cabeçalho, nada muda", rp.secao === "" && rp.blocos[0][0].includes("Sachê de ketchup"), rp);
const vazio = registroDeOpcoes().resolver([[`- PRODUTO: "Água"`]]);
confere("sem lista, sem seção", vazio.secao === "" && vazio.blocos[0][0] === `- PRODUTO: "Água"`);

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
