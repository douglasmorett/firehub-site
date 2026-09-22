/**
 * Trava o "pager obrigatório" por loja (lib/balcao-config.ts).
 *
 *   npx tsx scripts/teste-pager-obrigatorio.ts
 *
 * O risco aqui é de UM lado só, e é grave: uma configuração ilegível virar
 * "obrigatório" travaria a venda de uma loja que nunca pediu nada — em
 * horário de operação, com fila. Por isso todo caso duvidoso cai em LIVRE.
 *
 * O outro lado (loja que marcou e o pedido passa sem pager) só custa um
 * cliente esperando sem ser chamado.
 */
import {
  lerBalcaoConfig, pagerEhObrigatorio, problemaDoPagerObrigatorio, BALCAO_CONFIG_PADRAO,
} from "../src/lib/balcao-config";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok   " : "FALHA"} ${oQue}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

const SO_BALCAO = { pagerObrigatorioBalcao: true, pagerObrigatorioMesa: false };
const SO_MESA = { pagerObrigatorioBalcao: false, pagerObrigatorioMesa: true };
const OS_DOIS = { pagerObrigatorioBalcao: true, pagerObrigatorioMesa: true };

console.log("\n1) Toda loja nasce sem nada obrigatório");
confere("coluna nula", lerBalcaoConfig(null), BALCAO_CONFIG_PADRAO);
confere("coluna ausente (undefined)", lerBalcaoConfig(undefined), BALCAO_CONFIG_PADRAO);
confere("objeto vazio", lerBalcaoConfig({}), BALCAO_CONFIG_PADRAO);

console.log("\n2) Config ilegível NUNCA vira obrigatório");
for (const lixo of ["sim", 1, 0, true, [], ["pagerObrigatorioBalcao"], "{}"]) {
  confere(`${JSON.stringify(lixo)} cai no padrão`, lerBalcaoConfig(lixo), BALCAO_CONFIG_PADRAO);
}
// "true" em texto é o caso que um formulário mal feito mandaria.
confere('string "true" não liga', lerBalcaoConfig({ pagerObrigatorioBalcao: "true" }), BALCAO_CONFIG_PADRAO);
confere("1 não liga", lerBalcaoConfig({ pagerObrigatorioMesa: 1 }), BALCAO_CONFIG_PADRAO);
confere("só o booleano true liga", lerBalcaoConfig({ pagerObrigatorioBalcao: true }), SO_BALCAO);

console.log("\n3) Cada chave tranca só a sua aba");
confere("só balcão → balcão exige", pagerEhObrigatorio(SO_BALCAO, "BALCAO"), true);
confere("só balcão → mesa livre", pagerEhObrigatorio(SO_BALCAO, "MESA"), false);
confere("só mesa → mesa exige", pagerEhObrigatorio(SO_MESA, "MESA"), true);
confere("só mesa → balcão livre", pagerEhObrigatorio(SO_MESA, "BALCAO"), false);
confere("os dois → balcão exige", pagerEhObrigatorio(OS_DOIS, "BALCAO"), true);
confere("os dois → mesa exige", pagerEhObrigatorio(OS_DOIS, "MESA"), true);

console.log("\n4) Delivery nunca exige pager");
confere("delivery com tudo ligado", pagerEhObrigatorio(OS_DOIS, "DELIVERY"), false);
confere("tipo desconhecido entra livre", pagerEhObrigatorio(OS_DOIS, "TOTEM"), false);
confere("tipo nulo entra livre", pagerEhObrigatorio(OS_DOIS, null), false);

console.log("\n5) A mensagem que trava o pedido");
confere("loja sem nada marcado passa", problemaDoPagerObrigatorio(null, "BALCAO", ""), null);
confere("marcado e preenchido passa", problemaDoPagerObrigatorio(OS_DOIS, "BALCAO", "12"), null);
confere("marcado e vazio trava", typeof problemaDoPagerObrigatorio(OS_DOIS, "BALCAO", ""), "string");
confere("só espaço em branco trava", typeof problemaDoPagerObrigatorio(OS_DOIS, "BALCAO", "   "), "string");
confere("nulo trava", typeof problemaDoPagerObrigatorio(OS_DOIS, "MESA", null), "string");
confere("a mensagem da mesa fala em mesa", (problemaDoPagerObrigatorio(SO_MESA, "MESA", "") || "").includes("na mesa"), true);
confere("a mensagem do balcão fala em balcão", (problemaDoPagerObrigatorio(SO_BALCAO, "BALCAO", "") || "").includes("no balcão"), true);
confere("a mensagem diz onde configurar", (problemaDoPagerObrigatorio(SO_BALCAO, "BALCAO", "") || "").includes("Minha Loja"), true);
// Pager "0" é um número de aparelho válido — não pode ser lido como vazio.
confere('pager "0" conta como preenchido', problemaDoPagerObrigatorio(OS_DOIS, "BALCAO", "0"), null);
confere('pager "A3" conta como preenchido', problemaDoPagerObrigatorio(OS_DOIS, "MESA", "A3"), null);

console.log(falhas === 0 ? "\n✅ Tudo certo.\n" : `\n❌ ${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);
