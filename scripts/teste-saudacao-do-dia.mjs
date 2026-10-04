/**
 * Prova da saudação do dia do robô (lib/saudacao-do-dia.ts): que mensagem é
 * "só um oi", quando é a primeira do dia, e como fica o texto com o link.
 *
 *   node scripts/teste-saudacao-do-dia.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/saudacao-do-dia.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ehSoUmaSaudacao, ehPrimeiraMensagemDoDia, linkDoCardapioDaLoja, mensagemDeBoasVindasDoDia } =
  await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

console.log("\n1) O que é só um cumprimento");
for (const t of [
  "oi", "Oi!", "oii", "oiee", "Oiii, tudo bem?", "olá", "Ola", "Olá, boa noite!", "bom dia", "Boa tarde",
  "boa noite 😊", "e aí, tudo bem?", "eai", "opa", "salve", "fala", "tudo bem?", "td bem", "oi, tudo bom?",
  "oi gente", "boa noite pessoal",
]) conferir(`"${t}" é saudação`, ehSoUmaSaudacao(t) === true);

console.log("\n2) O que NÃO é (tem assunto, e assunto é do modelo)");
for (const t of [
  "oi, quanto tá a esfiha?", "boa noite, quero pedir", "oi vocês entregam no centro?", "quero 10 esfihas",
  "oi, meu pedido 1234 chegou?", "cardápio", "ok", "sim", "obrigado", "valeu", "", "   ", "oi tudo bem quero fazer um pedido",
  "boa noite, qual a promoção de hoje?", "Rua das Flores 12",
  // Pergunta se a loja está aberta: só o modelo, com o horário na mão, responde certo.
  "oi, tá aberto?", "oi, tem alguém aí?", "olá, estão atendendo?",
]) conferir(`"${t}" não é saudação`, ehSoUmaSaudacao(t) === false);

console.log("\n3) Primeira mensagem do dia");
{
  const inicioDoDia = new Date("2026-09-24T08:00:00.000Z"); // 05:00 em Brasília
  const ontem = new Date("2026-09-24T02:00:00.000Z").getTime(); // 23:00 da véspera
  const hoje = new Date("2026-09-24T15:00:00.000Z").getTime(); // 12:00 de hoje
  conferir("nunca falou (null) → é a primeira", ehPrimeiraMensagemDoDia({ ultimaMensagemEm: null, historico: [], inicioDoDia }) === true);
  conferir("não se sabe (undefined) → é a primeira", ehPrimeiraMensagemDoDia({ inicioDoDia }) === true);
  conferir("falou ontem à noite → é a primeira de hoje", ehPrimeiraMensagemDoDia({ ultimaMensagemEm: ontem, historico: [], inicioDoDia }) === true);
  conferir("falou hoje ao meio-dia → não é", ehPrimeiraMensagemDoDia({ ultimaMensagemEm: hoje, historico: [], inicioDoDia }) === false);
  conferir("conversa em curso (histórico) → não é", ehPrimeiraMensagemDoDia({ ultimaMensagemEm: null, historico: [{ sender: "bot", text: "Oi!" }], inicioDoDia }) === false);
  conferir("madrugada: falou 23:00, escreve 00:30 → mesmo expediente, não é",
    ehPrimeiraMensagemDoDia({ ultimaMensagemEm: ontem, historico: [], inicioDoDia: new Date("2026-09-23T08:00:00.000Z") }) === false);
}

console.log("\n4) Link do cardápio da loja");
conferir("slug vira link do site", linkDoCardapioDaLoja({ slug: "hakim-contato" }) === "https://firehubfood.com.br/loja/hakim-contato");
conferir("link externo ganha do slug", linkDoCardapioDaLoja({ slug: "x", chatbotConfig: { externalMenuUrl: " https://meu.cardapio " } }) === "https://meu.cardapio");
conferir("sem slug e sem externo → vazio", linkDoCardapioDaLoja({ slug: null, chatbotConfig: {} }) === "");

console.log("\n5) O texto que vai para o cliente");
{
  const link = "https://firehubfood.com.br/loja/hakim-contato";
  const m = mensagemDeBoasVindasDoDia({ primeiroNome: "Douglas", nomeDoAtendente: "Ana", nomeDaLoja: "Hakim Centro", horaLocal: 20, link });
  conferir("boa noite às 20h, com nome", m.startsWith("Boa noite, Douglas! Tudo bem? 😊"), m);
  conferir("apresenta a atendente e a loja", m.includes("Aqui é Ana, do atendimento da Hakim Centro."), m);
  conferir("convida com o link", m.includes(`Para conhecer nosso cardápio e fazer seu pedido é só acessar: ${link}`), m);
  conferir("deixa a porta aberta", m.includes("Qualquer dúvida sobre sabor, preço ou entrega"), m);

  const cedo = mensagemDeBoasVindasDoDia({ horaLocal: 9, link });
  conferir("bom dia às 9h, sem nome nem atendente", cedo.startsWith("Bom dia! Tudo bem? 😊\n\nPara conhecer"), cedo);
  const tarde = mensagemDeBoasVindasDoDia({ horaLocal: 15, link, primeiroNome: "" });
  conferir("boa tarde às 15h", tarde.startsWith("Boa tarde! Tudo bem?"), tarde);
  const madrugada = mensagemDeBoasVindasDoDia({ horaLocal: 1, link });
  conferir("1h da manhã ainda é boa noite", madrugada.startsWith("Boa noite!"), madrugada);
  const formal = mensagemDeBoasVindasDoDia({ horaLocal: 20, link, personalidade: "FORMAL", nomeDoAtendente: "Carlos" });
  conferir("formal: sem emoji e com 'à disposição'", !formal.includes("😊") && formal.includes("estou à disposição"), formal);
  conferir("o link aparece uma vez só", (m.match(/https:\/\//g) || []).length === 1);

  // Rafa (R&D, 28/09): o cliente novo ouve do cupom de primeiro pedido no "oi".
  const novo = mensagemDeBoasVindasDoDia({ horaLocal: 20, link, cupomDePrimeiroPedido: { code: "PRIMEIROPEDIDO", beneficio: "40% de desconto" } });
  conferir("cliente novo: o cupom logo depois do link", novo.includes(`${link}\n\nComo é seu primeiro pedido aqui, você ganha 40% de desconto com o cupom PRIMEIROPEDIDO 🎉`), novo);
  conferir("sem cupom (loja sem cadastro ou cliente antigo): nada muda", mensagemDeBoasVindasDoDia({ horaLocal: 20, link, cupomDePrimeiroPedido: null }) === mensagemDeBoasVindasDoDia({ horaLocal: 20, link }));
  const novoFormal = mensagemDeBoasVindasDoDia({ horaLocal: 20, link, personalidade: "FORMAL", cupomDePrimeiroPedido: { code: "BEMVINDO", beneficio: "R$ 10,00 de desconto" } });
  conferir("formal: o cupom sem emoji", novoFormal.includes("com o cupom BEMVINDO.") && !novoFormal.includes("🎉"), novoFormal);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
