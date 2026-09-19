/**
 * "Sem cebola" tem que chegar na comanda, venha de onde vier.
 *
 * O Frangoso avisou em 19/09/2026 que a observação vinda da Brendi não saía no
 * pedido nem na notinha. A medição no banco (últimos 30 dias) mostrou que não
 * era só a Brendi — era todo mundo menos o iFood:
 *
 *   iFood        544 de 9.144 itens com observação   ✅
 *   99Food         0 de   366                        ❌
 *   JotaJá         0 de   365                        ❌
 *   Brendi         0 de   105                        ❌
 *   Wabiz          0 de    15                        ❌
 *
 * A observação chegava no payload e era jogada na descrição do produto-espelho
 * (que ninguém imprime) ou no rodapé do pedido. A coluna que a comanda lê,
 * `CustomerOrderItem.notes`, ficava vazia.
 *
 * Este harness cobra as duas metades: a regra pura (lib/observacao-do-item.ts)
 * e o fato de cada tradutor ESCREVER na coluna. Os tradutores da Brendi e da
 * JotaJá são processadores de evento que falam com o banco, então para esses
 * dois a conferência é no código-fonte — o mesmo que teste-cron-runner-alvo.js
 * faz.
 *
 *   node scripts/teste-observacao-do-item.js
 */
const fs = require("fs");
const path = require("path");
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const { observacaoDoItem, observacaoDasPartes } = jiti(path.resolve(__dirname, "..", "src", "lib", "observacao-do-item.ts"));
const { itens99ParaPrisma } = jiti(path.resolve(__dirname, "..", "src", "lib", "food99-pedido.ts"));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

console.log("\n== os nomes que cada plataforma usa para o mesmo campo ==");
conferir("iFood/Brendi/JotaJá: observations", observacaoDoItem({ observations: "sem cebola" }), "sem cebola");
conferir("Open Delivery: specialInstructions", observacaoDoItem({ specialInstructions: "bem passado" }), "bem passado");
conferir("genérico: notes", observacaoDoItem({ notes: "capricha no molho" }), "capricha no molho");
conferir("99Food: remark", observacaoDoItem({ remark: "sem pimenta" }), "sem pimenta");
conferir("Wabiz: obs", observacaoDoItem({ obs: "sem azeitona" }), "sem azeitona");

console.log("\n== string vazia NÃO pode barrar o campo preenchido de trás ==");
// Era o bug do `??`: observations "" impedia specialInstructions de ser lido.
conferir("observations vazio cai para specialInstructions", observacaoDoItem({ observations: "", specialInstructions: "sem cebola" }), "sem cebola");
conferir("só espaços também cai", observacaoDoItem({ observations: "   ", notes: "gelada" }), "gelada");
conferir("sem observação nenhuma vira null", observacaoDoItem({ name: "Coca" }), null);
conferir("item nulo vira null", observacaoDoItem(null), null);
conferir("espaços nas pontas são aparados", observacaoDoItem({ observations: "  sem cebola  " }), "sem cebola");

console.log("\n== pizza meio a meio (Wabiz): a cozinha precisa saber de que lado ==");
conferir(
  "duas metades, cada uma com a sua",
  observacaoDasPartes([
    { rotulo: "Portuguesa", observacao: "sem azeitona" },
    { rotulo: "Calabresa", observacao: "capricha na cebola" },
  ]),
  "Portuguesa: sem azeitona | Calabresa: capricha na cebola",
);
conferir(
  "só uma metade tem observação — ainda diz qual",
  observacaoDasPartes([
    { rotulo: "Portuguesa", observacao: "sem azeitona" },
    { rotulo: "Calabresa", observacao: "" },
  ]),
  "Portuguesa: sem azeitona",
);
conferir(
  "item de uma parte só: o rótulo seria ruído",
  observacaoDasPartes([{ rotulo: "Pizza Grande", observacao: "sem azeitona" }]),
  "sem azeitona",
);
conferir("nenhuma parte com observação vira null", observacaoDasPartes([{ rotulo: "X", observacao: null }]), null);

console.log("\n== 99Food: a observação vai para a COLUNA do item ==");
const itens = itens99ParaPrisma(
  [
    { nome: "X-Burger", quantidade: 1, precoUnitario: 25, observacao: "sem cebola", complementos: [] },
    { nome: "Coca", quantidade: 1, precoUnitario: 8, observacao: "", complementos: [] },
  ],
  "loja1",
);
conferir("item com observação grava em notes", itens[0].notes, "sem cebola");
conferir("item sem observação grava null", itens[1].notes, null);
// E continua no rodapé de complementos: o Assistente antigo só lê de lá.
conferir(
  "continua também como complemento, para o Assistente antigo",
  JSON.parse(itens[0].comboSelections).some((c) => c.name === "Obs: sem cebola"),
  true,
);

console.log("\n== os tradutores que falam com o banco: conferência no código ==");
const fonte = (p) => fs.readFileSync(path.resolve(__dirname, "..", "src", "lib", p), "utf8");
for (const [nome, arquivo] of [["Brendi", "processBrendiEvent.ts"], ["JotaJá", "processJotajaEvent.ts"]]) {
  const s = fonte(arquivo);
  conferir(`${nome}: o item recebe notes: observacaoDoItem(i)`, /notes: observacaoDoItem\(i\),/.test(s), true);
  conferir(`${nome}: não sobrou \`??\` barrando a observação do pedido`, /const customerNote = orderData\.extraInfo \?\?/.test(s), false);
}
const wabiz = fonte("wabiz-traducao.ts");
conferir("Wabiz: o item recebe notes das partes", /notes: observacaoDasPartes\(/.test(wabiz), true);
const ifood = fonte("ifood-itens.ts");
conferir("iFood: passou a usar a regra única", /notes: observacaoDoItem\(i\),/.test(ifood), true);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
