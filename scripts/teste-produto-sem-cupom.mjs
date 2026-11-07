/**
 * Prova do item que "Não vale cupom nem desconto" (MenuProduct.semCupom,
 * lib/cupons.ts): o % só sobre os itens que valem, o fixo limitado a eles,
 * tudo fora do cupom → recusa, e sem nenhum item marcado a conta de sempre.
 * Pedido do Douglas, 07/11/2026 (Maxuel: cupom de 1º pedido só no combo).
 *
 *   node scripts/teste-produto-sem-cupom.mjs
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = require("jiti")(fileURLToPath(import.meta.url), { alias: { "@": path.join(raiz, "src") }, interopDefault: true });
const { lerCupom, avaliarCupom, descontoDoCupomNosItens, MOTIVO_SEM_ITEM_COM_CUPOM } = jiti(path.join(raiz, "src", "lib", "cupons.ts"));

let falhas = 0;
const conferir = (nome, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok    " : "FALHOU"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`}`);
};

const HOJE = "2026-11-07";
const fatos = (extra = {}) => ({ subtotal: 100, taxa: 8, hojeDaLoja: HOJE, usosDoCliente: null, jaPediuPeloSite: null, ...extra });
const pct20 = lerCupom({ code: "PRIMEIRO20", type: "percent", discount: 20, active: true, primeiroPedido: true });
const fixo30 = lerCupom({ code: "TRINTA", type: "fixed", discount: 30, active: true });
const frete = lerCupom({ code: "FRETE", type: "free_shipping", active: true });

console.log("\n1) Percentual só sobre os itens que valem");
// Combo de 60 vale; refrigerante + sobremesa (40) marcados fora do cupom.
conferir("20% de um pedido de 100 com 60 valendo = 12", avaliarCupom(pct20, fatos({ subtotalComCupom: 60, jaPediuPeloSite: false })).desconto, 12);
conferir("função direta dá o mesmo", descontoDoCupomNosItens("percent", 20, { subtotal: 100, subtotalComCupom: 60, taxa: 8 }), 12);
conferir("centavos arredondados (33,33 × 15% = 5,00)", descontoDoCupomNosItens("percent", 15, { subtotal: 50, subtotalComCupom: 33.33, taxa: 0 }), 5);

console.log("\n2) Fixo limitado aos itens que valem");
conferir("R$ 30 com 20 valendo = 20 (não abate o item fora)", avaliarCupom(fixo30, fatos({ subtotalComCupom: 20 })).desconto, 20);
conferir("R$ 30 com 50 valendo = 30", avaliarCupom(fixo30, fatos({ subtotalComCupom: 50 })).desconto, 30);
conferir("com item fora, a taxa não entra no teto", descontoDoCupomNosItens("fixed", 1000, { subtotal: 100, subtotalComCupom: 70, taxa: 8 }), 70);

console.log("\n3) Nenhum item vale cupom → recusa com a frase");
const recusa = avaliarCupom(pct20, fatos({ subtotalComCupom: 0, jaPediuPeloSite: false }));
conferir("percentual recusado", [recusa.ok, recusa.motivo, recusa.desconto], [false, MOTIVO_SEM_ITEM_COM_CUPOM, 0]);
conferir("a frase", MOTIVO_SEM_ITEM_COM_CUPOM, "Este cupom não vale para os itens do seu pedido.");
conferir("fixo recusado", avaliarCupom(fixo30, fatos({ subtotalComCupom: 0 })).ok, false);
conferir("frete grátis não muda (é a taxa, não item)", [avaliarCupom(frete, fatos({ subtotalComCupom: 0 })).ok, avaliarCupom(frete, fatos({ subtotalComCupom: 0 })).zeraTaxa], [true, true]);
conferir("sacola vazia não vira recusa por item", avaliarCupom(fixo30, fatos({ subtotal: 0, subtotalComCupom: 0 })).motivo, undefined);

console.log("\n4) Sem nenhum item marcado = igual a hoje");
for (const [nome, c] of [["percentual", pct20], ["fixo", fixo30], ["frete", frete]]) {
  const antes = avaliarCupom(c, fatos({ jaPediuPeloSite: false }));
  const depois = avaliarCupom(c, fatos({ jaPediuPeloSite: false, subtotalComCupom: 100 }));
  conferir(`${nome}: subtotalComCupom = subtotal dá o mesmo veredito`, depois, antes);
}
conferir("percentual de 100 = 20", avaliarCupom(pct20, fatos({ jaPediuPeloSite: false })).desconto, 20);
const gigante = lerCupom({ code: "MIL", type: "fixed", discount: 1000, active: true });
conferir("fixo gigante: o teto antigo (itens + taxa) continua", avaliarCupom(gigante, fatos({ subtotalComCupom: 100 })).desconto, 108);
conferir("soma de ponto flutuante igual não conta como item fora", descontoDoCupomNosItens("fixed", 1000, { subtotal: 0.1 + 0.2, subtotalComCupom: 0.30000000000000004, taxa: 8 }), 8.3);
conferir("mínimo do pedido continua sobre o pedido inteiro", avaliarCupom(lerCupom({ code: "M", type: "percent", discount: 10, minOrderValue: 80, active: true }), fatos({ subtotalComCupom: 30 })).desconto, 3);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
