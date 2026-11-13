/**
 * npx tsx scripts/teste-forma-do-totem.ts — as formas do totem (lib/forma-do-totem).
 */
import { formaParaAMaquininha, formasDoTotem, lerFormaDoTotem, textoDaForma } from "../src/lib/forma-do-totem";
import { formaDoTexto } from "../src/lib/relatorios/formas-de-pagamento";
import { formaDoPedido } from "../src/lib/pix-online-pedido";

let falhas = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
}

confere("loja que nunca salvou as formas: tudo, sem Pix", formasDoTotem({ paymentFees: null, pixOnlineAtivo: false }), ["CREDITO", "DEBITO", "VOUCHER"]);
confere("Pix só com o Pix do FireHub ligado", formasDoTotem({ paymentFees: null, pixOnlineAtivo: true }), ["CREDITO", "DEBITO", "VOUCHER", "PIX"]);
confere(
  "forma desligada some (vale off)",
  formasDoTotem({ paymentFees: { VOUCHER: { active: false } }, pixOnlineAtivo: true }),
  ["CREDITO", "DEBITO", "PIX"]
);
confere(
  "Pix na entrega desligado não tira o Pix do FireHub",
  formasDoTotem({ paymentFees: { PIX: { active: false } }, pixOnlineAtivo: true }),
  ["CREDITO", "DEBITO", "VOUCHER", "PIX"]
);
confere("vocabulário da Stone", ["credit", "debit", "voucher", "pix", "x"].map(lerFormaDoTotem), ["CREDITO", "DEBITO", "VOUCHER", "PIX", null]);
confere("maquininha recebe a forma do texto gravado", (["CREDITO", "DEBITO", "VOUCHER"] as const).map((f) => formaParaAMaquininha(textoDaForma(f))), ["CREDITO", "DEBITO", "VOUCHER"]);
confere("totem antigo: maquininha pergunta", formaParaAMaquininha("Cartão (Maquininha)"), null);
confere("Pix não vai para a maquininha", formaParaAMaquininha(textoDaForma("PIX")), null);
confere("relatório lê os textos novos", (["CREDITO", "DEBITO", "VOUCHER"] as const).map((f) => formaDoTexto(textoDaForma(f))), ["CREDITO", "DEBITO", "VALE"]);
confere("Pix do totem é Pix pelo site", formaDoPedido(textoDaForma("PIX")), "pix");

if (falhas) {
  console.error(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\nTudo certo.");
