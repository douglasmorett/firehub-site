/**
 * Teste do Indique e Ganhe entre lojistas (lib/indique-e-ganhe.ts): quem pode
 * indicar, o gatilho do crédito, o abatimento na próxima mensalidade e a
 * isenção a partir de 10 indicados ativos e pagantes. Sem banco. Rodar:
 *
 * JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-indique-e-ganhe.ts
 */
import {
  abaterCreditos,
  cicloGeraCredito,
  codigoDaIndicacao,
  indicadosAtivosPagantes,
  isentaPorIndicacoes,
  linkDeIndicacao,
  motivoDaRecusa,
  previsaoDoAbatimento,
  saldoTotal,
  situacaoDaIndicacao,
  type CreditoDaIndicacao,
  type IndicadaNaContagem,
  type LojaNaIndicacao,
} from "../src/lib/indique-e-ganhe";
import type { CicloNasRegras } from "../src/lib/parceiro/regras";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── Link ────────────────────────────────────────────────────────────────────
confere("link pelo slug", linkDeIndicacao({ id: "abc", slug: "hakim-centro" }), "https://firehubfood.com.br/cadastro?indicacao=hakim-centro");
confere("link sem slug cai no id", linkDeIndicacao({ id: "abc", slug: null }), "https://firehubfood.com.br/cadastro?indicacao=abc");
confere("código limpo", codigoDaIndicacao("  Hakim-Centro "), "hakim-centro");
confere("código vazio = sem indicação", codigoDaIndicacao(""), null);
confere("código com lixo = sem indicação", codigoDaIndicacao("x' OR 1=1"), null);

// ── Elegibilidade ───────────────────────────────────────────────────────────
const loja = (id: string, extra: Partial<LojaNaIndicacao> = {}): LojaNaIndicacao => ({
  id, role: "FRANCHISEE", accountGroupId: null, ownerId: null, cpfCnpj: null, cpfDoResponsavel: null, ...extra,
});
confere("lojas diferentes valem", motivoDaRecusa(loja("a", { cpfCnpj: "11.111.111/0001-11" }), loja("b", { cpfCnpj: "22222222000122" })), null);
confere("a si mesma não", motivoDaRecusa(loja("a"), loja("a")), "MESMA_LOJA");
confere("filial da mesma conta não", motivoDaRecusa(loja("a"), loja("b", { accountGroupId: "a" })), "MESMA_CONTA");
confere("duas filiais da mesma conta não", motivoDaRecusa(loja("b", { accountGroupId: "m" }), loja("c", { accountGroupId: "m" })), "MESMA_CONTA");
confere("sub-conta do dono (ownerId) não", motivoDaRecusa(loja("a"), loja("b", { ownerId: "a" })), "MESMO_DONO");
confere("mesmo ownerId não", motivoDaRecusa(loja("a", { ownerId: "x" }), loja("b", { ownerId: "x" })), "MESMO_DONO");
confere("mesmo CNPJ não", motivoDaRecusa(loja("a", { cpfCnpj: "11.111.111/0001-11" }), loja("b", { cpfCnpj: "11111111000111" })), "MESMO_DONO");
confere("CPF do responsável igual ao CPF da outra conta não", motivoDaRecusa(loja("a", { cpfCnpj: "123.456.789-09" }), loja("b", { cpfCnpj: "33333333000133", cpfDoResponsavel: "12345678909" })), "MESMO_DONO");
confere("link de conta excluída não", motivoDaRecusa(loja("a", { role: "DELETED" }), loja("b")), "INDICADORA_INVALIDA");

// ── Gatilho ─────────────────────────────────────────────────────────────────
confere("mensalidade paga gera", cicloGeraCredito({ status: "PAID", paidAt: "2026-11-04", amountDue: 100 }), true);
confere("boleto gerado e não pago não gera", cicloGeraCredito({ status: "CLOSED", paidAt: null, amountDue: 100 }), false);
confere("PAID do teste (sem boleto) não gera", cicloGeraCredito({ status: "PAID", paidAt: null, amountDue: 0 }), false);
confere("pagou só tráfego no teste não gera", cicloGeraCredito({ status: "PAID", paidAt: "2026-11-04", amountDue: 0 }), false);

// ── Abatimento ──────────────────────────────────────────────────────────────
const agora = new Date("2026-12-01T06:00:00Z");
const credito = (id: string, geradoEm: string, usado = 0, usos: CreditoDaIndicacao["usos"] = []): CreditoDaIndicacao => ({
  id, creditoValor: 100, creditoGeradoEm: geradoEm, creditoUsado: usado, usos,
});
const um = [credito("c1", "2026-11-05")];

const r1 = abaterCreditos(um, { id: "ciclo-nov", yearMonth: "2026-11" }, 256.4, agora);
confere("mensalidade 256,40 com um crédito: abate 100", r1.abatido, 100);
confere("crédito vira usado inteiro", r1.alteracoes.map((a) => a.creditoUsado), [100]);

const r2 = abaterCreditos(um, { id: "ciclo-nov", yearMonth: "2026-11" }, 60, agora);
confere("mensalidade 60 (< 100): abate 60", r2.abatido, 60);
const depois = [{ ...um[0], creditoUsado: r2.alteracoes[0].creditoUsado, usos: r2.alteracoes[0].usos }];
confere("sobram 40 para o mês seguinte", saldoTotal(depois), 40);
const r3 = abaterCreditos(depois, { id: "ciclo-dez", yearMonth: "2026-12" }, 100, agora);
confere("no mês seguinte abate os 40 que sobraram", r3.abatido, 40);

// Idempotência: o fechamento do MESMO ciclo rodando de novo não usa outra vez.
const r4 = abaterCreditos(depois, { id: "ciclo-nov", yearMonth: "2026-11" }, 60, agora);
confere("refazer o fechamento do mesmo ciclo: abatido igual", r4.abatido, 60);
confere("refazer o fechamento do mesmo ciclo: nada a gravar", r4.alteracoes.length, 0);

const dois = [credito("novo", "2026-11-20"), credito("velho", "2026-11-02")];
const r5 = abaterCreditos(dois, { id: "c", yearMonth: "2026-11" }, 150, agora);
confere("dois créditos, mensalidade 150: abate 150", r5.abatido, 150);
confere("o mais antigo vai primeiro", r5.alteracoes.map((a) => [a.id, a.creditoUsado]), [["velho", 100], ["novo", 50]]);
confere("mensalidade zero não consome", abaterCreditos(um, { id: "c", yearMonth: "2026-11" }, 0, agora).alteracoes.length, 0);
confere("previsão do painel = min(saldo, mensalidade)", previsaoDoAbatimento(dois, 150), 150);

// ── Isenção ─────────────────────────────────────────────────────────────────
const ciclo = (yearMonth: string, extra: Partial<CicloNasRegras>): CicloNasRegras => ({
  yearMonth, status: "CLOSED", amountDue: 100, amountPending: 100, asaasPaymentId: "pay", asaasBoletoUrl: "u",
  dueDate: null, closedAt: null, paidAt: null, paidValue: null, paidNetValue: null, asaasStatus: "PENDING", notes: null, ...extra,
});
const pago = (ym: string) => ciclo(ym, { status: "PAID", amountPending: 0, paidAt: "2026-11-03T15:00:00Z", paidValue: 100, asaasStatus: "RECEIVED" });
const ativa = (id: string): IndicadaNaContagem => ({ id, role: "FRANCHISEE", trialEndsAt: "2026-09-01", ciclos: [pago("2026-10")] });
const hoje = new Date("2026-12-01T06:00:00Z");

// A partir de 10 (Douglas, 22/10/2026; era "mais de 10").
const nove = Array.from({ length: 9 }, (_, i) => ativa(`l${i}`));
confere("9 ativos pagantes → cobra", isentaPorIndicacoes(indicadosAtivosPagantes(nove, hoje)), false);
const dez = [...nove, ativa("l9")];
confere("10 ativos pagantes → isento", isentaPorIndicacoes(indicadosAtivosPagantes(dez, hoje)), true);

// Boleto de outubro vencido (venceu 05/11) e não pago: sai da conta.
const emAtraso: IndicadaNaContagem = { id: "l10", role: "FRANCHISEE", trialEndsAt: "2026-08-01", ciclos: [pago("2026-09"), ciclo("2026-10", {})] };
confere("10 com um em atraso → cobra", isentaPorIndicacoes(indicadosAtivosPagantes([...nove, emAtraso], hoje)), false);

// O boleto de novembro acabou de sair (vence 05/12): a VENCER não tira ninguém.
const aVencer: IndicadaNaContagem = { id: "l10", role: "FRANCHISEE", trialEndsAt: "2026-08-01", ciclos: [pago("2026-10"), ciclo("2026-11", {})] };
confere("boleto a vencer não tira da conta", indicadosAtivosPagantes([...dez, aVencer], hoje), 11);

confere("em teste não conta", indicadosAtivosPagantes([{ ...ativa("t"), trialEndsAt: "2026-12-20" }], hoje), 0);
confere("nunca pagou não conta", indicadosAtivosPagantes([{ ...ativa("n"), ciclos: [] }], hoje), 0);
confere("conta excluída não conta", indicadosAtivosPagantes([{ ...ativa("x"), role: "DELETED" }], hoje), 0);

// Créditos preservados durante a isenção: com a mensalidade isenta o
// fechamento abate sobre ZERO (lib/billing.ts), e nada é consumido.
const isentoAbate = abaterCreditos(dois, { id: "ciclo-isento", yearMonth: "2026-11" }, 0, agora);
confere("isento: nada abatido", isentoAbate.abatido, 0);
confere("isento: créditos continuam guardados", saldoTotal(dois), 200);

// ── Situação na lista ───────────────────────────────────────────────────────
const linha = (extra: Partial<CreditoDaIndicacao & { recusadaMotivo: string | null }>) => ({
  id: "i", creditoValor: 0, creditoGeradoEm: null, creditoUsado: 0, usos: [], recusadaMotivo: null, ...extra,
});
confere("em teste", situacaoDaIndicacao(linha({}), { role: "FRANCHISEE", trialEndsAt: "2026-12-20" }, hoje), "EM_TESTE");
confere("saiu do teste sem pagar", situacaoDaIndicacao(linha({}), { role: "FRANCHISEE", trialEndsAt: "2026-11-01" }, hoje), "AGUARDANDO_PAGAMENTO");
confere("pagou → crédito gerado", situacaoDaIndicacao(linha({ creditoValor: 100, creditoGeradoEm: "2026-11-05" }), null, hoje), "CREDITO_GERADO");
confere("crédito usado", situacaoDaIndicacao(linha({ creditoValor: 100, creditoUsado: 100 }), null, hoje), "CREDITO_USADO");
confere("recusada", situacaoDaIndicacao(linha({ recusadaMotivo: "MESMO_DONO" }), null, hoje), "NAO_VALEU");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
