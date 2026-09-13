/**
 * Prova de entrega x retirada no pedido do robô do WhatsApp.
 *
 *   node scripts/teste-tipo-do-pedido-do-robo.mjs
 *
 * Os endereços são os dos pedidos que entraram como "Retirada no local" na
 * Hakim Centro entre 06 e 12/09/2026, e o da retirada de verdade da Brazza.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/tipo-do-pedido-do-robo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { tipoDoPedidoDoRobo } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const tipo = (e) => tipoDoPedidoDoRobo(e).tipo;
const igual = (nome, obtido, esperado) => conferir(nome, obtido === esperado, `obtido ${obtido}, esperado ${esperado}`);

console.log("\n1) A conversa do #50 (Hakim Centro, 12/09), mensagem a mensagem");
let rascunho = null;
const m1 = tipoDoPedidoDoRobo({ enderecoDoPayload: "", enderecoDoRascunho: rascunho, frete: 0 });
igual("1ª mensagem, sem endereço e sem frete: rascunho nasce RETIRADA", m1.tipo, "RETIRADA");
rascunho = "Rua Nova Friburgo, 264 - Jardim Mariléa";
igual(
  "cliente passa o endereço e a área cobra 4,99: vira ENTREGA",
  tipo({ enderecoDoPayload: rascunho, enderecoDoRascunho: null, frete: 4.99 }),
  "DELIVERY",
);
igual(
  "confirmação que não repete o endereço: o do rascunho vale, continua ENTREGA",
  tipo({ enderecoDoPayload: undefined, enderecoDoRascunho: rascunho, frete: 0 }),
  "DELIVERY",
);
igual(
  "confirmação com address vazio: o do rascunho vale, continua ENTREGA",
  tipo({ enderecoDoPayload: "", enderecoDoRascunho: rascunho, frete: 4.99 }),
  "DELIVERY",
);
conferir(
  "o endereço devolvido é o do rascunho quando a mensagem não trouxe",
  tipoDoPedidoDoRobo({ enderecoDoPayload: undefined, enderecoDoRascunho: rascunho, frete: 0 }).endereco === rascunho,
);

console.log("\n2) Os outros endereços que entraram como retirada");
for (const endereco of [
  "Rua Santa Helena, 101, casa 03 - Village",
  "Rua dos beijos lote 50 quadra 8 - Âncora",
  "Rua Paraguai, 125, Balneário Remanso, Centro",
  "Rua Paraíba, 374 - Balneário Remanso",
  "Rua Paranaíba, 470, Operário, Rio das Ostras",
]) {
  igual(`"${endereco}" é ENTREGA`, tipo({ enderecoDoPayload: endereco, frete: 4.99 }), "DELIVERY");
}
igual("Balneário não é balcão", tipo({ enderecoDoPayload: "Balneário Remanso", frete: 0 }), "DELIVERY");
igual("frete grátis com endereço é ENTREGA", tipo({ enderecoDoPayload: "Rua Paraíba, 374", frete: 0 }), "DELIVERY");

console.log("\n3) Retirada de verdade continua retirada");
igual("\"Retirada no Balcão\" (Brazza, 04/09)", tipo({ enderecoDoPayload: "Retirada no Balcão", frete: 0 }), "RETIRADA");
igual("\"vou buscar aí\"", tipo({ enderecoDoPayload: "vou buscar aí", frete: 0 }), "RETIRADA");
igual("sem endereço em mensagem nenhuma e sem frete", tipo({ enderecoDoPayload: "", enderecoDoRascunho: null, frete: 0 }), "RETIRADA");
igual("tipo TAKEOUT escrito pela IA", tipo({ enderecoDoPayload: "", tipoInformado: "TAKEOUT", frete: 0 }), "RETIRADA");
igual("tipo pickup em minúsculas", tipo({ enderecoDoPayload: null, tipoInformado: "pickup", frete: 0 }), "RETIRADA");
igual(
  "desistiu da entrega: \"Retirada no balcão\" vence o endereço do rascunho",
  tipo({ enderecoDoPayload: "Retirada no balcão", enderecoDoRascunho: "Rua Paraíba, 374", frete: 0 }),
  "RETIRADA",
);

console.log("\n4) Sem endereço mas com frete: entrega (a área segura se não achar)");
igual("frete 5,99 sem endereço é ENTREGA", tipo({ enderecoDoPayload: "", frete: 5.99 }), "DELIVERY");
igual("endereço só com espaços conta como vazio", tipo({ enderecoDoPayload: "   ", frete: 0 }), "RETIRADA");

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
