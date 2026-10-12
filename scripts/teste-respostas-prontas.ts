/**
 * Trava as respostas prontas do robô (lib/respostas-prontas.ts).
 *   npx tsx scripts/teste-respostas-prontas.ts
 */
import {
  lerRespostasProntas, blocoDasRespostasProntas, extrairMarcasDeRespostaPronta, envioDasRespostasProntas, textoDasRespostasProntas,
} from "../src/lib/respostas-prontas";
import { RESPOSTAS } from "./respostas-prontas-pizzaria-17";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

const lista = lerRespostasProntas({ respostasProntas: RESPOSTAS });
confere("as 5 respostas da Pizzaria 17 são válidas", lista.length === 5, lista.length);
confere("loja sem lista: nada muda", lerRespostasProntas({}).length === 0 && blocoDasRespostasProntas([]) === "");
confere("lixo é ignorado", lerRespostasProntas({ respostasProntas: [{ id: "Com Espaço", assunto: "x", texto: "y" }, { id: "ok", assunto: "", texto: "y" }, { id: "ok2", assunto: "a" }, 3, null] }).length === 0);
confere("id repetido entra uma vez", lerRespostasProntas({ respostasProntas: [{ id: "a", assunto: "x", texto: "1" }, { id: "a", assunto: "x", texto: "2" }] }).length === 1);

const bloco = blocoDasRespostasProntas(lista);
confere("o prompt traz a marca de cada uma", ["combos", "tamanhos", "vale-refeicao", "rodizio", "reserva-festa"].every((id) => bloco.includes(`[[RESPOSTA_PRONTA:${id}]]`)), bloco.slice(0, 300));
confere("o prompt explica Alelo só refeição", /Alelo é SOMENTE refeição/.test(bloco));

const e1 = extrairMarcasDeRespostaPronta("Claro! Te mando aqui 👇 [[RESPOSTA_PRONTA:combos]]", lista);
confere("marca sai do texto", e1.texto.trim() === "Claro! Te mando aqui 👇" && e1.ids.join() === "combos", e1);
const e2 = extrairMarcasDeRespostaPronta("[[ resposta pronta : Tamanhos ]] e [[RESPOSTA_PRONTA:tamanhos]] [[RESPOSTA_PRONTA:inventada]]", lista);
confere("tolera variação, não repete e ignora id que não existe", e2.ids.join() === "tamanhos" && !/\[\[/.test(e2.texto), e2);

const s1 = envioDasRespostasProntas(["combos"], lista, "Claro! Te mando aqui 👇");
confere("combo: fotos absolutas e aviso depois", s1.resposta === "Claro! Te mando aqui 👇" && s1.envios[0].imagens.every((u) => u.startsWith("https://firehubfood.com.br/robo/pizzaria-17/")) && /válidos somente/.test(s1.envios[0].textoDepois || ""), s1);
const s2 = envioDasRespostasProntas(["tamanhos"], lista, "");
confere("só a marca: o texto da loja vira a resposta e não é mandado duas vezes", /^Dúvidas sobre tamanho/.test(s2.resposta) && s2.envios[0].texto === null, s2);
const s3 = envioDasRespostasProntas(["combos"], lista, "");
confere("só a marca de resposta só com foto: frase curta", s3.resposta === "Claro! Te mando aqui 👇", s3);
const s4 = envioDasRespostasProntas(["reserva-festa"], lista, "Que legal! 🎉");
confere("reserva: regras, 2 fotos e a ficha", !!s4.envios[0].texto && s4.envios[0].imagens.length === 2 && /Ornamentação/.test(s4.envios[0].textoDepois || ""), s4);

confere("a régua de fonte enxerga rodízio e área kids", /RODÍZIO DA 17/.test(textoDasRespostasProntas(lista)) && /Área Kids/.test(textoDasRespostasProntas(lista)));

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
