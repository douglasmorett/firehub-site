/**
 * Prova de lib/resposta-enxuta.ts: uma pergunta por vez, sem repetir o que o
 * cliente já respondeu, sem "é outro pedido?" à toa e sem puxar venda.
 * Os casos são das conversas reais de 06/11/2026 (auditoria do robô).
 *
 *   node scripts/teste-resposta-enxuta.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/resposta-enxuta.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { enxugarResposta, clientePedeItem } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, extra = "") => {
  console.log(`  ${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        ${extra}`}`);
  if (!ok) falhas++;
};
const cli = (text) => ({ sender: "user", text });
const bot = (text) => ({ sender: "bot", text });
const enx = (resposta, historico, mensagemDoCliente) => enxugarResposta(resposta, { historico, mensagemDoCliente });

console.log("\n1) Lapastine, Felipe (pedido nº 14): pagamento e troco já ditos");
{
  const h = [cli("Pix"), bot("Pix anotado!"), cli("Vai ser no dinheiro tá")];
  const r = enx("Opa, troco pra 100 reais é pagamento em dinheiro? Você tinha falado em Pix, então me confirma: Pix ou dinheiro?", h, "Troco pra 100");
  conferir("não pergunta de novo 'Pix ou dinheiro?'", !/pix ou dinheiro/i.test(r.texto), r.texto);
  const r2 = enx("Dinheiro anotado 👍 Vai precisar de troco pra quanto? E confirma o X.NEZE e o sachê de ketchup?", h, "Troco pra 100");
  conferir("não pergunta o troco que ele acabou de dar", !/troco/i.test(r2.texto), r2.texto);
  conferir("e fica com uma pergunta só", (r2.texto.match(/\?/g) || []).length <= 1, r2.texto);
  const r3 = enx("Cidade Nova a gente entrega sim, taxa de 3,00 reais! Total fica 93,00 reais. Vai ser em dinheiro com troco pra 100 ou no Pix?", [...h, cli("Troco pra 100")], "Bairro cidade nova");
  conferir("'dinheiro com troco pra 100 ou no Pix?' sai", !/\?/.test(r3.texto) && /93,00/.test(r3.texto), r3.texto);
}

console.log("\n2) Lapastine: 'é o mesmo pedido ou um segundo?' sem item pedido");
{
  const r = enx("Felipe, você já tem o pedido nº 14 aceito e indo pra cozinha. Quer acrescentar nele ou é um segundo pedido separado?", [cli("Dinheiro")], "Troco para 100");
  conferir("a pergunta sai (ele só falou do troco)", !/separado|acrescentar/i.test(r.texto) && /nº 14/.test(r.texto), r.texto);
  const r2 = enx(
    "Você já tem o pedido nº 14 com a gente, com esses mesmos itens, e ele está em preparo na cozinha. É o mesmo pedido ou quer um segundo separado?",
    [bot("Felipe, você já tem o pedido nº 14 aceito e indo pra cozinha. Quer acrescentar nele ou é um segundo pedido separado?")],
    "quero mais uma pizza",
  );
  conferir("não pergunta 'outro pedido?' pela segunda vez nem se ele pedir item", !/segundo|separado/i.test(r2.texto), r2.texto);
}

console.log("\n3) Construção do Lanche: 'Ok' e 'Qual valor?' não viram 'quer acrescentar?'");
{
  const r = enx("Beleza! Você já tem o pedido nº 6 com a gente, aceito e indo para a cozinha. Quer acrescentar algo nele ou prefere outro pedido separado?", [], "Ok");
  conferir("'Ok' → sem a pergunta", !/\?/.test(r.texto), r.texto);
  const r2 = enx("O pedido nº 6 ficou em 57 reais: 54 reais dos itens mais 3 reais de entrega. Quer acrescentar algo nele ou prefere um pedido separado?", [], "Qual valor?");
  conferir("'Qual valor?' → só o valor", r2.texto === "O pedido nº 6 ficou em 57 reais: 54 reais dos itens mais 3 reais de entrega.", r2.texto);
}

console.log("\n4) Pedido novo de verdade, primeira vez: a pergunta fica");
{
  const r = enx("Você já tem o pedido nº 6 em preparo. Quer um segundo pedido separado?", [], "quero 2 pizzas de calabresa");
  conferir("pergunta mantida", /separado\?/.test(r.texto), r.texto);
  conferir("'e uma coca' é pedido de item", clientePedeItem("e uma coca"));
  conferir("'Troco para 100' não é pedido de item", !clientePedeItem("Troco para 100"));
  conferir("'Travessa we 72 número 1221' não é pedido de item", !clientePedeItem("Travessa we 72 número 1221"));
}

console.log("\n5) Uma pergunta por mensagem");
{
  const r = enx("Anotado: Combo Duplo Família com mussarela e calabresa e guaraná 1,5L: 90 reais. Vai com cebola? Quer X.NEZE e sachê de ketchup? E é no mesmo endereço da última vez? Pix, cartão ou dinheiro?", [], "as duas de calabresa");
  conferir("fica só 'Vai com cebola?'", r.texto === "Anotado: Combo Duplo Família com mussarela e calabresa e guaraná 1,5L: 90 reais. Vai com cebola?", r.texto);
  const g = enx("Boa noite, Bia! 😊 Tudo bem? Pode me dizer o que você quer pedir?", [], "Boa noite");
  conferir("'Tudo bem?' de cumprimento não ocupa o lugar da pergunta", /Tudo bem\?/.test(g.texto) && /pedir\?/.test(g.texto), g.texto);
  const l = enx("Pode fazer pelo site: https://firehubfood.com.br/loja/x?origem=robo Quer que eu anote por aqui?", [], "quero pedir");
  conferir("'?' de link não conta como pergunta", /origem=robo/.test(l.texto) && /anote por aqui\?/.test(l.texto), l.texto);
  const s = "Resumo:\nPizza Família de Frango: 48 reais\nTaxa de entrega: 8 reais\nValor Total a pagar: 56 reais\n\nVai pagar como: Pix, cartão ou dinheiro?";
  conferir("resumo com uma pergunta fica igual", enx(s, [], "isso").texto === s);
}

console.log("\n6) Pagamento: só corta o pedaço quando a frase pede mais coisa");
{
  const r = enx("Entregamos aí sim! A taxa é 3 reais, ficando 73 reais no total. Me passa rua, número, bairro e a forma de pagamento?", [cli("Joao sergio de almeida silva pix")], "📍 Localização enviada pelo WhatsApp: -1.35, -48.38");
  conferir("pede rua/número/bairro, não o pagamento", /bairro\?/.test(r.texto) && !/pagamento/.test(r.texto), r.texto);
  const q = enx("Aceitamos sim! Vai pagar como: Pix, cartão ou dinheiro?", [], "Aceita cartão?");
  conferir("'aceita cartão?' não conta como pagamento dito", /Pix, cartão ou dinheiro\?/.test(q.texto), q.texto);
}

console.log("\n6b) Pedaços que sobravam soltos (simulação nas conversas reais)");
{
  const r = enx("Anotado, dinheiro 👍 Vai precisar de troco? Se sim, pra quanto?", [cli("Troco pra 100")], "Dinheiro");
  conferir("'Se sim, pra quanto?' sai junto", r.texto === "Anotado, dinheiro 👍", r.texto);
  const r2 = enx("Dinheiro anotado 👍 Vai precisar de troco pra quanto? E confirma o X.NEZE e o sachê de ketchup?", [], "Troco pra 100");
  conferir("o 'E' que sobrou no começo sai", r2.texto === "Dinheiro anotado 👍 Confirma o X.NEZE e o sachê de ketchup?", r2.texto);
  const r3 = enx("Beleza, Williane, sem borda então! 😊 Pra fechar preciso da rua, do número, do bairro e da forma de pagamento: Pix, cartão ou dinheiro?", [cli("Cartao")], "Pode ser sem a borda mesmo");
  conferir("'do bairro e da forma de pagamento' não vira 'do bairro e d?'", /do bairro\?$/.test(r3.texto), r3.texto);
  const r4 = enx("Desculpa a confusão, Williane! Só falta o pagamento: Pix, cartão ou dinheiro? O cupom de 10 reais vale nessas formas 😊", [cli("Cartao")], "Pelo amor de Deus");
  conferir("'Só falta o pagamento:?' sai inteira", !/pagamento/.test(r4.texto), r4.texto);
}

console.log("\n7) Não puxa venda");
{
  const r = enx("Haha, beleza, primo! 😄 Então bora pedir uma pizza?", [], "É nós primo.🩷");
  conferir("'bora pedir uma pizza?' sai", r.texto === "Haha, beleza, primo! 😄", r.texto);
  const r2 = enx("Guaraná Antarctica 1,5L anotado, fica 14 reais 😊 Maionese avulsa a gente não tem por aqui 😕 Quer algo pra acompanhar, tipo Nuggets 4 unidades?", [], "guaraná");
  conferir("'quer algo pra acompanhar?' sai", !/acompanhar/.test(r2.texto) && /14 reais/.test(r2.texto), r2.texto);
  const r3 = enx("Opa Gabriel, beleza? Bora fechar esse pedido hoje? 🍕", [], "Voltando");
  conferir("'bora fechar esse pedido hoje?' sai", !/fechar/.test(r3.texto), r3.texto);
}

console.log("\n8) Sem nada para cortar, o texto sai idêntico");
{
  const t = "Temos sim! O Combo Duplo sai por 90 reais no tamanho Família.\n\nhttps://firehubfood.com.br/loja/pizzaria-lapastine";
  const r = enx(t, [], "Ainda tem a promoção?");
  conferir("idêntico", r.texto === t && r.cortes.length === 0, JSON.stringify(r));
}

console.log(falhas === 0 ? "\nTUDO CERTO\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
