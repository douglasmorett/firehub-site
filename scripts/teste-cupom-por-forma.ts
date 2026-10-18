/**
 * Em quais formas de pagamento o cupom vale (lib/cupom-por-forma.ts).
 *
 *   npx tsx scripts/teste-cupom-por-forma.ts
 *
 * O caso é o da Ligeiro Lanches em 18/10/2026: PRIMEIRACOMPRA 10% só para
 * Pix, Débito e Crédito — não para a Arariboia (bandeira de Vale).
 */
import { avaliarCupom, lerCupom } from "../src/lib/cupons";
import { formaParaOCupom, formaRecusadaPeloCupom, partesDaForma, textoDasFormasDoCupom } from "../src/lib/cupom-por-forma";
import { nomeDoCupom } from "../src/lib/cupom-do-robo";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`);
  }
}

const FEES = {
  VOUCHER: { active: true, brands: [{ name: "Ticket", active: true }, { name: "Arariboia", active: true }] },
  formasProprias: [{ id: "fp1", nome: "Macaíba", ativo: true, canais: { pdv: true, mesa: false, site: true, robo: true } }],
};
const fatos = (extra: Record<string, unknown> = {}) => ({ subtotal: 100, taxa: 8, hojeDaLoja: "2026-10-18", usosDoCliente: 0, jaPediuPeloSite: false, ...extra });

const antigo = lerCupom({ code: "PRIMEIRACOMPRA", type: "percent", discount: 10, active: true })!;
const soCartaoEPix = lerCupom({ code: "PRIMEIRACOMPRA", type: "percent", discount: 10, active: true, formasDePagamento: ["PIX", "DEBITO", "CREDITO"] })!;
const valeSemArariboia = lerCupom({ code: "VALE10", type: "percent", discount: 10, active: true, valesFora: ["Arariboia"] })!;
const comPropria = lerCupom({ code: "MAC5", type: "fixed", discount: 5, active: true, formasDePagamento: ["DINHEIRO", "PROPRIA:Macaíba"] })!;

console.log("\n== Campo ausente = vale em todas ==");
conferir("cupom antigo lê formas null", antigo.formasDePagamento, null);
conferir("cupom antigo sem vales fora", antigo.valesFora, []);
conferir("lista vazia também é todas", lerCupom({ code: "X", formasDePagamento: [] })!.formasDePagamento, null);
conferir("chave inválida sozinha é todas", lerCupom({ code: "X", formasDePagamento: ["BOLETO"] })!.formasDePagamento, null);
for (const f of ["DINHEIRO", "PIX", "VOUCHER_Arariboia", "Macaíba (forma própria)", "qualquer coisa"]) {
  conferir(`antigo aceita ${f}`, formaRecusadaPeloCupom(antigo, f, FEES), null);
}
conferir("antigo: avaliarCupom com forma passa", avaliarCupom(antigo, fatos({ formaDePagamento: "DINHEIRO", paymentFees: FEES })).ok, true);
conferir("texto das formas do antigo = null", textoDasFormasDoCupom(antigo), null);

console.log("\n== Pix, Débito e Crédito (Ligeiro) ==");
conferir("texto", textoDasFormasDoCupom(soCartaoEPix), "Pix, Débito e Crédito");
conferir("texto com 'ou'", textoDasFormasDoCupom(soCartaoEPix, "ou"), "Pix, Débito ou Crédito");
for (const f of ["PIX", "PIX_ENTREGA", "PIX_ONLINE", "DEBITO", "CREDITO", "CREDITO_ONLINE", "Pix", "Cartão de débito", "cartão na entrega"]) {
  conferir(`aceita ${f}`, formaRecusadaPeloCupom(soCartaoEPix, f, FEES), null);
}
const recusa = "O cupom PRIMEIRACOMPRA vale só para Pix, Débito e Crédito.";
for (const f of ["DINHEIRO", "VOUCHER", "VOUCHER_Ticket", "Dinheiro", "Vale-refeição", "Macaíba (forma própria)"]) {
  conferir(`recusa ${f}`, formaRecusadaPeloCupom(soCartaoEPix, f, FEES), recusa);
}
conferir("recusa VOUCHER_Arariboia", formaRecusadaPeloCupom(soCartaoEPix, "VOUCHER_Arariboia", FEES), recusa);
conferir("robô escreve 'Arariboia' → vale, recusa", formaRecusadaPeloCupom(soCartaoEPix, "Arariboia", FEES), recusa);
conferir("'Cartão Arariboia' é vale, não crédito", formaParaOCupom("Cartão Arariboia", FEES), { forma: "VALE", bandeira: "Arariboia" });
conferir("forma ainda não escolhida não recusa", formaRecusadaPeloCupom(soCartaoEPix, "", FEES), null);
conferir("null não recusa", formaRecusadaPeloCupom(soCartaoEPix, null, FEES), null);
conferir("texto que não se reconhece recusa", formaRecusadaPeloCupom(soCartaoEPix, "a combinar", FEES), recusa);
const v = avaliarCupom(soCartaoEPix, fatos({ formaDePagamento: "VOUCHER_Arariboia", paymentFees: FEES }));
conferir("avaliarCupom recusa pela forma", { ok: v.ok, motivo: v.motivo, pelaForma: v.recusaPelaForma, desconto: v.desconto }, { ok: false, motivo: recusa, pelaForma: true, desconto: 0 });
const pix = avaliarCupom(soCartaoEPix, fatos({ formaDePagamento: "PIX", paymentFees: FEES }));
conferir("avaliarCupom com Pix dá 10%", { ok: pix.ok, desconto: pix.desconto }, { ok: true, desconto: 10 });
conferir("sem forma nos fatos não confere (sacola)", avaliarCupom(soCartaoEPix, fatos()).ok, true);
conferir("nome do cupom no robô", nomeDoCupom(soCartaoEPix), "PRIMEIRACOMPRA (10% de desconto, só pagando com Pix, Débito ou Crédito)");

console.log("\n== Bandeira de Vale fora ==");
conferir("texto", textoDasFormasDoCupom(valeSemArariboia), "Dinheiro, Pix, Débito, Crédito e Vale-refeição (menos Arariboia)");
conferir("aceita Ticket", formaRecusadaPeloCupom(valeSemArariboia, "VOUCHER_Ticket", FEES), null);
conferir("aceita vale genérico", formaRecusadaPeloCupom(valeSemArariboia, "VOUCHER", FEES), null);
conferir("aceita dinheiro", formaRecusadaPeloCupom(valeSemArariboia, "DINHEIRO", FEES), null);
conferir(
  "recusa Arariboia dizendo a bandeira",
  formaRecusadaPeloCupom(valeSemArariboia, "VOUCHER_Arariboia", FEES),
  "O cupom VALE10 não vale para Arariboia: vale só para Dinheiro, Pix, Débito, Crédito e Vale-refeição (menos Arariboia)."
);
conferir("recusa 'vale arariboia' sem acento/caixa", formaRecusadaPeloCupom(valeSemArariboia, "vale ARARIBÓIA", FEES) !== null, true);

console.log("\n== Pagamento dividido ==");
conferir("partes do resumo", partesDaForma("Dividido: Pix R$ 20,00 + Cartão Débito R$ 15,00"), ["Pix", "Cartão Débito"]);
conferir("dividido Pix + Débito vale", formaRecusadaPeloCupom(soCartaoEPix, "Dividido: Pix R$ 20,00 + Cartão Débito R$ 15,00", FEES), null);
conferir(
  "dividido Pix + Dinheiro recusa",
  formaRecusadaPeloCupom(soCartaoEPix, "Dividido: Pix R$ 20,00 + Dinheiro R$ 15,00", FEES),
  `${recusa} No pagamento dividido, todas as formas precisam estar nessa lista.`
);
conferir("lista de partes (method)", formaRecusadaPeloCupom(soCartaoEPix, [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 15 }], FEES) !== null, true);
conferir("lista de partes toda aceita", formaRecusadaPeloCupom(soCartaoEPix, [{ method: "Pix", amount: 20 }, { method: "Crédito", amount: 15 }], FEES), null);

console.log("\n== Forma própria ==");
conferir("texto", textoDasFormasDoCupom(comPropria), "Dinheiro e Macaíba");
conferir("aceita Macaíba marcada", formaRecusadaPeloCupom(comPropria, "Macaíba (forma própria)", FEES), null);
conferir("aceita 'macaiba' escrito pelo robô", formaRecusadaPeloCupom(comPropria, "macaiba", FEES), null);
conferir("aceita dinheiro", formaRecusadaPeloCupom(comPropria, "DINHEIRO", FEES), null);
conferir("recusa Pix", formaRecusadaPeloCupom(comPropria, "PIX", FEES), "O cupom MAC5 vale só para Dinheiro e Macaíba.");
conferir("cupom sem a própria recusa a Macaíba", formaRecusadaPeloCupom(soCartaoEPix, "Macaíba (forma própria)", FEES), recusa);
conferir("forma própria apagada da loja: lida pela marca", formaParaOCupom("Velha (forma própria)", FEES), { forma: "PROPRIA", nome: "Velha" });

console.log(`\n${ok} ok, ${falhou} falharam`);
if (falhou > 0) process.exit(1);
