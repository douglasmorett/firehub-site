/**
 * A comissão de verdade (o split do Asaas) pela regra de 18/10/2026
 * (lib/parceiro/regras.ts): EMBAIXADOR (autônomo) ganha recorrente das lojas
 * que indicou; VENDEDOR (contratado) ganha enquanto atende — 10% no link de
 * vendedor, 3% na atribuída. Split do boleto no formato que o fechamento manda
 * (splitDoBoletoNoAsaas), split da recarga do disparo (splitDaRecarga, sempre
 * 3% da margem para quem atende) e a tabelinha do portal (ganhoPorPacote).
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-comissao-de-quem-atende.ts
 */
import {
  COMISSAO_DO_DISPARO_PCT, ganhoPorPacote, indicacaoDeEmbaixador, lojaNasRegrasDoCadastro, papelNaLoja, splitDaRecarga, splitDoBoletoNoAsaas,
  vendedorQueAtende, type ParceiroDoCadastro,
} from "../src/lib/parceiro/regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// Os parceiros como vêm do banco (Ambassador).
const vic: ParceiroDoCadastro = { id: "vic", active: true, isVendedor: true, asaasWalletId: "w_vic", commissionPercent: 10, sellerPercent: 3 }; // vendedor puro
const bia: ParceiroDoCadastro = { id: "bia", active: true, isVendedor: true, asaasWalletId: "w_bia", commissionPercent: 10, sellerPercent: 3 }; // vendedora pura
const victor: ParceiroDoCadastro = { id: "victor", active: true, isVendedor: true, asaasWalletId: "w_victor", commissionPercent: 30, sellerPercent: 3 }; // embaixador E vendedor
const ana: ParceiroDoCadastro = { id: "ana", active: true, isVendedor: false, asaasWalletId: "w_ana", commissionPercent: 20, sellerPercent: 3 }; // embaixadora pura
const loja = (ambassador: ParceiroDoCadastro | null, vendedor: ParceiroDoCadastro | null) => ({
  ambassadorId: ambassador?.id ?? null, vendedorId: vendedor?.id ?? null, ambassador, vendedor,
});
const split = (l: ReturnType<typeof loja>) => splitDoBoletoNoAsaas(l).split;

console.log("\n— Embaixador × vendedor: como o sistema distingue —");
confere("embaixadora pura (não vende) = indicação de embaixador", indicacaoDeEmbaixador(ana), true);
confere("vendedor com 10% = link de vendedor", indicacaoDeEmbaixador(vic), false);
confere("vendedor com 30% (era embaixador) = indicação de embaixador", indicacaoDeEmbaixador(victor), true);
confere("vendedor com 0% (antes do script) = link de vendedor", indicacaoDeEmbaixador({ isVendedor: true, commissionPercent: 0 }), false);

console.log("\n— Boleto —");
confere("1. link do vendedor Vic e ele atende → Vic 10%", split(loja(vic, vic)), [{ walletId: "w_vic", percentualValue: 10 }]);
confere("2. link do Vic, ninguém atribuído → Vic 10% (é quem atende)", split(loja(vic, null)), [{ walletId: "w_vic", percentualValue: 10 }]);
confere("3. link do Vic e a Bia atende → só a Bia 3% (o vendedor que não atende perde)", split(loja(vic, bia)), [{ walletId: "w_bia", percentualValue: 3 }]);
confere("4. atribuída à Bia → Bia 3%", split(loja(null, bia)), [{ walletId: "w_bia", percentualValue: 3 }]);
confere("5. link e atende, Vic pausado → nada", split(loja({ ...vic, active: false }, { ...vic, active: false })), []);
confere("6. vendedor puro saiu da equipe (isVendedor falso + pausado) → nada, nem do link", split(loja({ ...vic, isVendedor: false, active: false }, null)), []);
confere("7. embaixadora pura Ana + Bia atendendo → Ana 20% + Bia 3%", split(loja(ana, bia)), [{ walletId: "w_ana", percentualValue: 20 }, { walletId: "w_bia", percentualValue: 3 }]);
confere("8. embaixadora pura sem vendedor → Ana 20%", split(loja(ana, null)), [{ walletId: "w_ana", percentualValue: 20 }]);
confere("9. Victor (embaixador e vendedor) indicou e ele atende → 30% (não soma os 10%)", split(loja(victor, victor)), [{ walletId: "w_victor", percentualValue: 30 }]);
confere("10. Victor indicou e a Bia atende → Victor 30% + Bia 3% (embaixador é recorrente)", split(loja(victor, bia)), [{ walletId: "w_victor", percentualValue: 30 }, { walletId: "w_bia", percentualValue: 3 }]);
confere("11. Victor indicou, ninguém atribuído → Victor 30%", split(loja(victor, null)), [{ walletId: "w_victor", percentualValue: 30 }]);
confere("12. Victor saiu da equipe (isVendedor falso, segue ativo) → as indicações seguem 30%", split(loja({ ...victor, isVendedor: false }, null)), [{ walletId: "w_victor", percentualValue: 30 }]);
confere("13. loja atribuída ao Victor (indicada pela Ana) → Ana 20% + Victor 3%", split(loja(ana, victor)), [{ walletId: "w_ana", percentualValue: 20 }, { walletId: "w_victor", percentualValue: 3 }]);
confere("14. Victor saiu da equipe → a loja da Ana volta a 'sem vendedor' e só a Ana recebe", split(loja(ana, null)), [{ walletId: "w_ana", percentualValue: 20 }]);
confere("15. vendedor sem carteira no Asaas → sem linha", split(loja(vic, { ...vic, asaasWalletId: null })), []);
confere("16. freio de mão: Ana 38% + Bia 3% = 41% → boleto sem split", splitDoBoletoNoAsaas(loja({ ...ana, commissionPercent: 38 }, bia)), { split: [], total: 41, acimaDoTeto: true });
confere("17. nunca dois vendedores na mesma loja (link do Vic + Bia atendendo)", split(loja(vic, bia)).length, 1);

console.log("\n— O portal mostra o mesmo que o split paga —");
const regras = (l: ReturnType<typeof loja>) => lojaNasRegrasDoCadastro(l);
const naRegra = (p: ParceiroDoCadastro) => ({ id: p.id, active: p.active, temCarteira: !!p.asaasWalletId, isVendedor: p.isVendedor, commissionPercent: p.commissionPercent, level2Percent: 3, sellerPercent: p.sellerPercent });
confere("Vic na loja do link que ele atende: VENDEDOR · LINK 10%", papelNaLoja(naRegra(vic), regras(loja(vic, vic))), { papel: "VENDEDOR", percentual: 10, tambemNaCarteira: false, origem: "LINK" });
confere("Vic na loja do link que a Bia atende: nada", papelNaLoja(naRegra(vic), regras(loja(vic, bia))), null);
confere("Bia na loja do link do Vic: VENDEDOR · ATRIBUIDA 3%", papelNaLoja(naRegra(bia), regras(loja(vic, bia))), { papel: "VENDEDOR", percentual: 3, tambemNaCarteira: false, origem: "ATRIBUIDA" });
confere("Victor na loja que indicou e a Bia atende: EMBAIXADOR · INDICACAO 30%", papelNaLoja(naRegra(victor), regras(loja(victor, bia))), { papel: "EMBAIXADOR", percentual: 30, tambemNaCarteira: false, origem: "INDICACAO" });
confere("Victor na loja que indicou e atende: EMBAIXADOR 30%, também na carteira", papelNaLoja(naRegra(victor), regras(loja(victor, victor))), { papel: "EMBAIXADOR", percentual: 30, tambemNaCarteira: true, origem: "INDICACAO" });
confere("Ana (embaixadora pura): EMBAIXADOR · INDICACAO 20%", papelNaLoja(naRegra(ana), regras(loja(ana, bia))), { papel: "EMBAIXADOR", percentual: 20, tambemNaCarteira: false, origem: "INDICACAO" });
confere("quem atende: Victor na própria indicação = INDICACAO (0% de vendedor, não soma)", [vendedorQueAtende(regras(loja(victor, victor)))?.origem, vendedorQueAtende(regras(loja(victor, victor)))?.percentual], ["INDICACAO", 0]);

console.log("\n— Recarga do disparo: sempre 3% da margem para quem ATENDE —");
const r1000 = { valor: 460, disparos: 1000, custoPorDisparo: 0.3217 };
confere(`margem 460 − 1000 × 0,3217 = 138,30 → ${COMISSAO_DO_DISPARO_PCT}% = 4,14`, splitDaRecarga(r1000, regras(loja(null, bia))), { parceiroId: "bia", fixedValue: 4.14, margem: 138.3 });
confere("link do Vic que ele atende: 3% (os 10% são só do boleto)", splitDaRecarga(r1000, regras(loja(vic, vic)))?.fixedValue, 4.14);
confere("link do Vic e a Bia atende: a Bia leva", splitDaRecarga(r1000, regras(loja(vic, bia)))?.parceiroId, "bia");
confere("Victor indicou e atende: ele leva os 3% (é quem atende)", splitDaRecarga(r1000, regras(loja(victor, victor)))?.parceiroId, "victor");
confere("Victor indicou e a Bia atende: a Bia leva (embaixador não ganha no disparo)", splitDaRecarga(r1000, regras(loja(victor, bia)))?.parceiroId, "bia");
confere("Victor indicou, ninguém atende: ninguém leva", splitDaRecarga(r1000, regras(loja(victor, null))), null);
confere("embaixadora pura sem vendedor: ninguém leva", splitDaRecarga(r1000, regras(loja(ana, null))), null);
confere("vendedor pausado ou sem carteira: ninguém leva", [splitDaRecarga(r1000, regras(loja(null, { ...bia, active: false }))), splitDaRecarga(r1000, regras(loja(null, { ...bia, asaasWalletId: null })))], [null, null]);
confere("margem minúscula (3% < 1 centavo): sem split", splitDaRecarga({ valor: 0.5, disparos: 1, custoPorDisparo: 0.3217 }, regras(loja(null, bia))), null);

console.log("\n— Tabelinha do portal (sem mostrar margem nem custo) —");
confere("pacote de 1.000 mensagens → R$ 4,14", ganhoPorPacote(1000, 0.46, 0.3217), 4.14);
confere("pacote de 5.000 → R$ 20,74", ganhoPorPacote(5000, 0.46, 0.3217), 20.74);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
