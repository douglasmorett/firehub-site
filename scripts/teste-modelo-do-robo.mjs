/**
 * Qual modelo responde cada mensagem (src/lib/modelo-do-robo.ts).
 *
 *   node scripts/teste-modelo-do-robo.mjs
 *
 * Os casos são mensagens reais do A/B de 03/10/2026. Os dez em que o
 * Flash-Lite errou TÊM de ir ao 3.6; a conversa comum vai ao Lite.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/modelo-do-robo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { escolherModeloDoRobo, MODELO_BARATO, MODELO_DE_PEDIDO } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const bot = (text) => ({ sender: "bot", text });
const user = (text) => ({ sender: "user", text });
function espera(nome, entrada, modelo) {
  const r = escolherModeloDoRobo({ temPedidoEmAndamento: false, historico: [], ...entrada });
  if (r.modelo === modelo) { console.log(`  ok    ${nome}${r.motivo ? ` (${r.motivo})` : ""}`); return; }
  falhas++;
  console.log(`  FALHA ${nome} — veio ${r.modelo} (${r.motivo}), esperado ${modelo}`);
}

console.log("\n1) Onde o Lite errou no A/B: vai ao 3.6");
espera("Divinos: itens com cliente que já tem pedido", { mensagem: "1 X tudo sem salada\n1 coca em lata" }, MODELO_DE_PEDIDO);
espera("Divinos: \"50\" depois de perguntar o troco", { mensagem: "50", historico: [bot("Vai precisar de troco?")] }, MODELO_DE_PEDIDO);
espera("Deeds: endereço escrito (chutou a taxa)", { mensagem: "av rosalvo marques bonfim 1501" }, MODELO_DE_PEDIDO);
espera("Delícias: \"??\" (não viu o pedido nº 94)", { mensagem: "??" }, MODELO_DE_PEDIDO);
espera("Delícias: localização pelo 📎", { mensagem: "📍 Localização enviada pelo WhatsApp: -22.505869, -41.916759" }, MODELO_DE_PEDIDO);
espera("Na Goma: \"quando for entregar me avisa… em casa\"", { mensagem: "Mano, quando você for entregar você me avisa pra mim saber se eu vou tá em casa, na academia ou na hamburgueria" }, MODELO_DE_PEDIDO);
espera("Na Goma: meio a meio", { mensagem: "Vou querer uma pizza meio a meio A moda e 4 carnes" }, MODELO_DE_PEDIDO);
espera("R&D: \"acabei de fazer o pedido\"", { mensagem: "Acabei de fazer o pedido por aqui" }, MODELO_DE_PEDIDO);
espera("Yakisoba: rascunho em andamento", { mensagem: "Entregar", temPedidoEmAndamento: true }, MODELO_DE_PEDIDO);
espera("L&M: \"Ta\" confirmando o resumo", { mensagem: "Ta", temPedidoEmAndamento: true }, MODELO_DE_PEDIDO);

console.log("\n2) Outros sinais de pedido");
espera("áudio vai ao 3.6", { mensagem: "", temAudio: true }, MODELO_DE_PEDIDO);
espera("forma de pagamento", { mensagem: "vai ser no pix" }, MODELO_DE_PEDIDO);
espera("robô acabou de pedir o endereço", { mensagem: "ok já mando", historico: [user("quero um x tudo"), bot("Anotado! Me passa o endereço com bairro?")] }, MODELO_DE_PEDIDO);
espera("CEP", { mensagem: "28890-000" }, MODELO_DE_PEDIDO);
espera("número da casa", { mensagem: "Rua das Flores nº 31" }, MODELO_DE_PEDIDO);
espera("\"no\" não é endereço", { mensagem: "tem açaí no cardápio de vocês?" }, MODELO_BARATO);

console.log("\n3) Conversa comum: Lite");
espera("boa noite", { mensagem: "Boa noite" }, MODELO_BARATO);
espera("pede o cardápio", { mensagem: "Pode me mandar o cardápio por favor" }, MODELO_BARATO);
espera("horário", { mensagem: "Tudo sim, vocês estão abertos?" }, MODELO_BARATO);
espera("onde fica a loja", { mensagem: "Você está localizado aonde" }, MODELO_BARATO);
espera("já está preparando?", { mensagem: "Já está preparando ?" }, MODELO_BARATO);
espera("pergunta que vai para a equipe", { mensagem: "Vocês possuem espaço kids?" }, MODELO_BARATO);
espera("reclamação (o Lite chama atendente igual)", { mensagem: "Faltou" }, MODELO_BARATO);
espera("depois de mandar o link", { mensagem: "Ok", historico: [bot("Nosso cardápio tá no link: https://firehubfood.com.br/loja/x 😊")] }, MODELO_BARATO);

console.log("\n4) Loja que não anota pedido pelo robô: sempre o Lite");
espera("pedido escrito, mas o robô não anota", { mensagem: "quero 2 x tudo", anotaPedido: false }, MODELO_BARATO);
espera("áudio, mas o robô não anota", { mensagem: "", temAudio: true, anotaPedido: false }, MODELO_BARATO);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
