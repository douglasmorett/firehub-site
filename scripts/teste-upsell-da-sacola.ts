/**
 * scripts/teste-upsell-da-sacola.ts — o upsell da sacola (lib/upsell-config.ts):
 * a leitura da config e a regra que a rota do pedido (api/customer-order) usa
 * para aceitar ou recusar o desconto que vem do navegador.
 *
 *   npx tsx scripts/teste-upsell-da-sacola.ts
 */
import { lerUpsellConfig, precoNoUpsell, precoDaLinhaDoUpsell, CHAMADA_PADRAO_DO_UPSELL } from "../src/lib/upsell-config";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

// ── Leitura ──────────────────────────────────────────────────────────────
confere("coluna vazia → desligado", lerUpsellConfig(null), { ativo: false, chamada: CHAMADA_PADRAO_DO_UPSELL, itens: [] });
confere("string → desligado", lerUpsellConfig('{"ativo":true}').ativo, false);
confere("ativo só com true", lerUpsellConfig({ ativo: "sim" }).ativo, false);
confere("chamada vazia → padrão", lerUpsellConfig({ chamada: "  " }).chamada, CHAMADA_PADRAO_DO_UPSELL);
confere(
  "sem repetido, % inteiro de 0 a 90",
  lerUpsellConfig({
    ativo: true,
    itens: [
      { produtoId: "a", desconto: 10.4 }, { produtoId: "a", desconto: 50 }, { produtoId: "b", desconto: -5 },
      { produtoId: "c", desconto: 150 }, { produtoId: "d", desconto: "x" }, { produtoId: "e", desconto: 0 }, { produtoId: "f", desconto: 5 },
      { produtoId: "" },
    ],
  }).itens,
  [{ produtoId: "a", desconto: 10 }, { produtoId: "b", desconto: 0 }, { produtoId: "c", desconto: 90 }, { produtoId: "d", desconto: 0 }, { produtoId: "e", desconto: 0 }, { produtoId: "f", desconto: 5 }],
);
confere(
  "a loja escolhe quantos (mais de 5 vale); o que passar de 20 sai",
  lerUpsellConfig({ ativo: true, itens: Array.from({ length: 25 }, (_, i) => ({ produtoId: `p${i}`, desconto: 0 })) }).itens.length,
  20,
);

// ── Conta do preço ───────────────────────────────────────────────────────
confere("10% de R$ 12,00 = R$ 10,80", precoNoUpsell(12, 10), 10.8);
confere("15% de R$ 7,90 = R$ 6,72", precoNoUpsell(7.9, 15), 6.72);
confere("15% de R$ 19,90 = R$ 16,92 (meio centavo sobe)", precoNoUpsell(19.9, 15), 16.92);
confere("0% não mexe", precoNoUpsell(9.9, 0), 9.9);

// ── A regra da rota do pedido ────────────────────────────────────────────
const config = { ativo: true, chamada: "Leva junto?", itens: [{ produtoId: "refri", desconto: 20 }, { produtoId: "pudim", desconto: 0 }] };
confere("aceita o % configurado (refri R$ 8,00 → R$ 6,40)", precoDaLinhaDoUpsell(8, 8, config, "refri", 20), 6.4);
confere("aceita item sem desconto (preço cheio)", precoDaLinhaDoUpsell(12, 12, config, "pudim", 0), 12);
confere("desconto só na base: R$ 30 base + R$ 5 de opção, 20% → R$ 29,00", precoDaLinhaDoUpsell(35, 30, config, "refri", 20), 29);
confere("recusa % forjado (50 no lugar de 20)", precoDaLinhaDoUpsell(8, 8, config, "refri", 50), null);
confere("recusa % no item que é sem desconto", precoDaLinhaDoUpsell(12, 12, config, "pudim", 10), null);
confere("recusa produto fora da lista", precoDaLinhaDoUpsell(40, 40, config, "picanha", 20), null);
confere("recusa com o upsell desligado", precoDaLinhaDoUpsell(8, 8, { ...config, ativo: false }, "refri", 20), null);
confere("recusa sem config (coluna ausente)", precoDaLinhaDoUpsell(8, 8, null, "refri", 20), null);
confere("recusa % em texto que não bate", precoDaLinhaDoUpsell(8, 8, config, "refri", "20abc"), null);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
