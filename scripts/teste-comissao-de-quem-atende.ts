/**
 * A comissão de verdade (o split do Asaas) pela regra de 18/10/2026 — "quem
 * atende é quem ganha" (lib/parceiro/regras.ts): split do boleto no formato que
 * o fechamento manda (splitDoBoletoNoAsaas), split da recarga do disparo
 * (splitDaRecarga, sempre 3% da margem) e a tabelinha do portal (ganhoPorPacote).
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-comissao-de-quem-atende.ts
 */
import {
  COMISSAO_DO_DISPARO_PCT, ganhoPorPacote, lojaNasRegrasDoCadastro, papelNaLoja, splitDaRecarga, splitDoBoletoNoAsaas, vendedorQueAtende,
  type ParceiroDoCadastro,
} from "../src/lib/parceiro/regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// Os parceiros como vêm do banco (Ambassador).
const vic: ParceiroDoCadastro = { id: "vic", active: true, isVendedor: true, asaasWalletId: "w_vic", commissionPercent: 10, sellerPercent: 3 };
const bia: ParceiroDoCadastro = { id: "bia", active: true, isVendedor: true, asaasWalletId: "w_bia", commissionPercent: 10, sellerPercent: 3 };
const victor30: ParceiroDoCadastro = { id: "victor", active: true, isVendedor: true, asaasWalletId: "w_victor", commissionPercent: 30, sellerPercent: 3 };
const ana: ParceiroDoCadastro = { id: "ana", active: true, isVendedor: false, asaasWalletId: "w_ana", commissionPercent: 20, sellerPercent: 3 };
const loja = (ambassador: ParceiroDoCadastro | null, vendedor: ParceiroDoCadastro | null) => ({
  ambassadorId: ambassador?.id ?? null, vendedorId: vendedor?.id ?? null, ambassador, vendedor,
});
const split = (l: ReturnType<typeof loja>) => splitDoBoletoNoAsaas(l).split;

console.log("\n— Boleto: quem atende é quem ganha —");
confere("1. veio pelo link do Vic e o Vic atende → Vic 10%", split(loja(vic, vic)), [{ walletId: "w_vic", percentualValue: 10 }]);
confere("2. veio pelo link do Vic, ninguém atribuído → o Vic (quem convidou) 10%", split(loja(vic, null)), [{ walletId: "w_vic", percentualValue: 10 }]);
confere("3. veio pelo link do Vic e a Bia atende → só a Bia 3% (o Vic perde)", split(loja(vic, bia)), [{ walletId: "w_bia", percentualValue: 3 }]);
confere("4. atribuída à Bia (sem link) → Bia 3%", split(loja(null, bia)), [{ walletId: "w_bia", percentualValue: 3 }]);
confere("5. link e atende, mas o Vic está pausado → nada", split(loja({ ...vic, active: false }, { ...vic, active: false })), []);
confere("6. link do Vic, a Bia atende e está pausada → nada (o Vic não atende)", split(loja(vic, { ...bia, active: false })), []);
confere("7. saiu da equipe (isVendedor falso + pausado) com loja do link → nada", split(loja({ ...vic, isVendedor: false, active: false }, null)), []);
confere("8. embaixadora pura (Ana 20%) + Bia atendendo → Ana 20% + Bia 3% (regra de indicação intocada)", split(loja(ana, bia)), [
  { walletId: "w_ana", percentualValue: 20 }, { walletId: "w_bia", percentualValue: 3 },
]);
confere("9. embaixadora pura sem vendedor → Ana 20%", split(loja(ana, null)), [{ walletId: "w_ana", percentualValue: 20 }]);
confere("10. embaixador que também vende (Victor 30%) e atende a loja do link → 30% (o % maior fica)", split(loja(victor30, victor30)), [{ walletId: "w_victor", percentualValue: 30 }]);
confere("11. Victor convidou e a Bia atende → só a Bia 3%", split(loja(victor30, bia)), [{ walletId: "w_bia", percentualValue: 3 }]);
confere("12. vendedor sem carteira no Asaas → sem linha (não tem para onde mandar)", split(loja(vic, { ...vic, asaasWalletId: null })), []);
confere("13. freio de mão: Ana 38% + Bia 3% = 41% → boleto sem split", splitDoBoletoNoAsaas(loja({ ...ana, commissionPercent: 38 }, bia)), { split: [], total: 41, acimaDoTeto: true });
confere("14. ex-vendedor que virou só embaixador ATIVO segue o programa de indicação (decisão à mão do admin)", split(loja({ ...vic, isVendedor: false }, null)), [{ walletId: "w_vic", percentualValue: 10 }]);
confere("15. nunca dois vendedores na mesma loja", split(loja(vic, bia)).length, 1);

console.log("\n— O portal mostra o mesmo que o split paga —");
const regras = (l: ReturnType<typeof loja>) => lojaNasRegrasDoCadastro(l);
const naRegra = (p: ParceiroDoCadastro) => ({ id: p.id, active: p.active, temCarteira: !!p.asaasWalletId, isVendedor: p.isVendedor, commissionPercent: p.commissionPercent, level2Percent: 3, sellerPercent: p.sellerPercent });
confere("Vic na loja do link que ele atende: EMBAIXADOR 10%", papelNaLoja(naRegra(vic), regras(loja(vic, vic))), { papel: "EMBAIXADOR", percentual: 10, tambemNaCarteira: true });
confere("Vic na loja do link que a Bia atende: nada", papelNaLoja(naRegra(vic), regras(loja(vic, bia))), null);
confere("Bia na loja do link do Vic que ela atende: VENDEDOR 3%", papelNaLoja(naRegra(bia), regras(loja(vic, bia))), { papel: "VENDEDOR", percentual: 3, tambemNaCarteira: false });
confere("Ana (embaixadora pura) na loja que indicou: EMBAIXADOR 20%", papelNaLoja(naRegra(ana), regras(loja(ana, bia))), { papel: "EMBAIXADOR", percentual: 20, tambemNaCarteira: false });
confere("quem atende: link sem atribuído = quem convidou (LINK)", vendedorQueAtende(regras(loja(vic, null)))?.origem, "LINK");
confere("quem atende: link com outro atribuído = o atribuído (ATRIBUIDA)", [vendedorQueAtende(regras(loja(vic, bia)))?.parceiroId, vendedorQueAtende(regras(loja(vic, bia)))?.origem], ["bia", "ATRIBUIDA"]);

console.log("\n— Recarga do disparo: sempre 3% da margem para quem atende —");
const r1000 = { valor: 460, disparos: 1000, custoPorDisparo: 0.3217 };
confere(`margem 460 − 1000 × 0,3217 = 138,30 → ${COMISSAO_DO_DISPARO_PCT}% = 4,14 (centavo para baixo)`, splitDaRecarga(r1000, regras(loja(null, bia))), { parceiroId: "bia", fixedValue: 4.14, margem: 138.3 });
confere("loja do link do Vic que ele atende: também 3% (os 10% são só do boleto)", splitDaRecarga(r1000, regras(loja(vic, vic)))?.fixedValue, 4.14);
confere("link do Vic e a Bia atende: a Bia leva", splitDaRecarga(r1000, regras(loja(vic, bia)))?.parceiroId, "bia");
confere("embaixadora pura sem vendedor: ninguém leva", splitDaRecarga(r1000, regras(loja(ana, null))), null);
confere("vendedor pausado: ninguém leva", splitDaRecarga(r1000, regras(loja(null, { ...bia, active: false }))), null);
confere("sem carteira: ninguém leva", splitDaRecarga(r1000, regras(loja(null, { ...bia, asaasWalletId: null }))), null);
confere("recarga com margem minúscula (3% < 1 centavo): sem split", splitDaRecarga({ valor: 0.5, disparos: 1, custoPorDisparo: 0.3217 }, regras(loja(null, bia))), null);

console.log("\n— Tabelinha do portal (sem mostrar margem nem custo) —");
confere("pacote de 1.000 mensagens → R$ 4,14", ganhoPorPacote(1000, 0.46, 0.3217), 4.14);
confere("pacote de 5.000 → R$ 20,74", ganhoPorPacote(5000, 0.46, 0.3217), 20.74);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
