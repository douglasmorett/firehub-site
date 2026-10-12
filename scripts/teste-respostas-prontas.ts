/**
 * Trava as respostas prontas do robô (lib/respostas-prontas.ts).
 *   npx tsx scripts/teste-respostas-prontas.ts
 */
import {
  lerRespostasProntas, blocoDasRespostasProntas, extrairMarcasDeRespostaPronta, envioDasRespostasProntas, textoDasRespostasProntas,
  extrairFichaPreenchida, textoDoAvisoDaFicha, regraDaReservaPelaFicha,
} from "../src/lib/respostas-prontas";
import { regrasDoRobo } from "../src/lib/regras-do-robo";
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

// ── Ficha preenchida vai para a equipe (12/10/2026) ──
confere("a reserva leva ficha para a equipe", lista.find((r) => r.id === "reserva-festa")?.fichaParaALoja === "Reserva de festa");
confere("o prompt ensina a marca da ficha", /FICHA PREENCHIDA VAI PARA A EQUIPE/.test(bloco) && /\[\[FICHA_PARA_A_LOJA:/.test(bloco));
confere("loja sem ficha: o prompt não fala de ficha", !/FICHA PREENCHIDA/.test(blocoDasRespostasProntas(lista.filter((r) => !r.fichaParaALoja))));
const f1 = extrairFichaPreenchida(
  "Recebi tudo! 😊 Já passei para a equipe, eles confirmam com você por aqui. [[FICHA_PARA_A_LOJA:reserva-festa| Nome: Ana Souza ; Telefone: 22 99999-0000 ; Pessoas: 20 ; Data: 25/10 ; Horário: 18h ; Unidade: Aeroporto ; Ornamentação: sim]]",
  lista,
);
confere("ficha sai do texto com os campos", !/\[\[/.test(f1.texto) && f1.ficha?.titulo === "Reserva de festa" && f1.ficha?.dados.split("\n").length === 7 && /Pessoas: 20/.test(f1.ficha?.dados || ""), f1);
const f2 = extrairFichaPreenchida("Ok [[ficha para a loja: combos | Nome: X]]", lista);
confere("marca de resposta sem ficha: some e não chama ninguém", f2.ficha === null && f2.texto.trim() === "Ok", f2);
const f3 = extrairFichaPreenchida("Recebi! [[FICHA_PARA_A_LOJA:reserva-festa]]", lista);
confere("ficha sem dados ainda chama a equipe", f3.ficha?.id === "reserva-festa" && f3.ficha?.dados === "", f3);
const aviso = textoDoAvisoDaFicha(f1.ficha!, { nome: "Ana", telefone: "5522999990000" });
confere("aviso ao dono: título, cliente sem 55 e os dados", /Reserva de festa: para a equipe confirmar/.test(aviso) && /Ana \(22999990000\)/.test(aviso) && /Data: 25\/10/.test(aviso), aviso);

const ctxBase: any = {
  storeLink: "x", cardapioArquivoUrl: null, cardapioArquivoNoInicio: false, temCupomParaCitar: false, diaDeHoje: "segunda", codigoDoDia: "SEG",
  diaDeAmanha: "terça", lojaFisica: true, enderecoDaLoja: "Rua A", fazReservaDeMesa: true, modoDaArea: "BAIRRO", ehRota: false, regraDoPix: "",
  anotaPedido: true, notaFiscal: null, regraDoMinimo: "", lembreteDoMinimo: "",
};
const comFicha = regrasDoRobo({ ...ctxBase, regraDaReserva: regraDaReservaPelaFicha(lista) });
const semFicha = regrasDoRobo(ctxBase);
confere("regra de reserva com ficha: manda a ficha e não chama antes", /\[\[RESPOSTA_PRONTA:reserva-festa\]\]/.test(comFicha) && /FICHA PREENCHIDA/.test(comFicha) && /NÃO chame a equipe antes/.test(bloco) && !/Me diz o dia, o horário e quantas pessoas/.test(comFicha));
confere("regra de reserva sem ficha: igual a antes", /Me diz o dia, o horário e quantas pessoas/.test(semFicha) && !/RESPOSTA_PRONTA:reserva/.test(semFicha));

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
