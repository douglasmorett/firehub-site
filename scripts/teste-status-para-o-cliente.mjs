/**
 * Prova dos textos de status por tipo de entrega (lib/status-para-o-cliente.ts).
 *
 *   node scripts/teste-status-para-o-cliente.mjs
 *
 * O caso que o originou: Hakim, 17/09/2026 — pedido de RETIRADA em SAIU_ENTREGA
 * (que no painel é "pronto para retirar") e o robô disse "saiu para entrega com
 * o motoboy".
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/status-para-o-cliente.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ehRetirada, rotuloDeStatusParaOModelo, rotuloDoTipoDeEntrega, fraseDeStatusDeEmergencia } =
  await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
/** Texto de retirada nunca pode sugerir que há alguém levando o pedido. */
const semEntrega = (txt) => !/motoboy|entregador|saiu para entrega|a caminho|na rua/i.test(String(txt));

console.log("\n1) O que é retirada");
for (const t of ["RETIRADA", "TAKEOUT", "BALCAO", "retirada", "RETIRADA_LOJA"]) conferir(`${t} é retirada`, ehRetirada(t) === true);
for (const t of ["DELIVERY", "ENTREGA", "MESA", "", null]) conferir(`${t} não é retirada`, ehRetirada(t) === false);

console.log("\n2) O caso da Hakim: RETIRADA em SAIU_ENTREGA");
const r = rotuloDeStatusParaOModelo("SAIU_ENTREGA", "RETIRADA");
conferir("rótulo diz PRONTO para retirar", /PRONTO.*RETIRAR/i.test(r), r);
conferir("rótulo avisa o modelo que não há entrega", /n[ãa]o tem entrega/i.test(r), r);
conferir("rótulo não contém 'motoboy' nem 'saiu para entrega'", semEntrega(r), r);
const f = fraseDeStatusDeEmergencia({ status: "SAIU_ENTREGA", deliveryType: "RETIRADA", primeiroNome: "Ana", numero: "#12", itens: "1x Pizza" });
conferir("frase de emergência fala em retirada no balcão", /retirada aqui no balc/i.test(f), f);
conferir("frase de emergência não fala de motoboy nem de entrega", semEntrega(f), f);

console.log("\n3) Retirada nunca ganha entregador, em status nenhum");
for (const s of ["NOVO", "ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA", "ENTREGUE"]) {
  for (const tipo of ["RETIRADA", "TAKEOUT"]) {
    const rot = rotuloDeStatusParaOModelo(s, tipo);
    conferir(`rótulo ${tipo}/${s}`, semEntrega(rot), rot);
    const fr = fraseDeStatusDeEmergencia({ status: s, deliveryType: tipo, numero: "#1" });
    conferir(`frase  ${tipo}/${s}`, fr === null || semEntrega(fr), fr);
  }
}

console.log("\n4) Entrega continua como era");
conferir("DELIVERY/SAIU_ENTREGA fala do motoboy", /motoboy/i.test(rotuloDeStatusParaOModelo("SAIU_ENTREGA", "DELIVERY")));
conferir("DELIVERY/PRONTO avisa que AINDA não saiu", /AINDA N[ÃA]O saiu/i.test(rotuloDeStatusParaOModelo("PRONTO", "DELIVERY")));
conferir("frase DELIVERY/SAIU_ENTREGA", /saiu para entrega/i.test(fraseDeStatusDeEmergencia({ status: "SAIU_ENTREGA", deliveryType: "DELIVERY", numero: "#7" })));
conferir("frase DELIVERY/PREPARANDO não promete prazo", !/instantes|minut|logo|j[áa] j[áa]/i.test(fraseDeStatusDeEmergencia({ status: "PREPARANDO", deliveryType: "DELIVERY", numero: "#7" })));
conferir("tipo nulo cai em entrega (comportamento antigo)", rotuloDoTipoDeEntrega(null) === "ENTREGA");
conferir("mesa não ganha frase de emergência", fraseDeStatusDeEmergencia({ status: "PREPARANDO", deliveryType: "MESA", numero: "#3" }) === null);
conferir("cancelado", rotuloDeStatusParaOModelo("CANCELADO", "RETIRADA") === "Cancelado ❌");
conferir("status desconhecido não inventa", rotuloDeStatusParaOModelo("XPTO", "DELIVERY") === "XPTO");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
