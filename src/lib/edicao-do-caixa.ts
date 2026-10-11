/**
 * CORRIGIR A CONTAGEM DE UM CAIXA JÁ FECHADO — sem apagar como ele estava.
 *
 * O operador digita errado no fechamento ("o valor do cartão de crédito
 * lançaram errado", Nik Esfirraria, 11/10/2026) e o caixa ficava para sempre
 * com uma falta que não aconteceu. Agora o Histórico de caixas deixa corrigir,
 * com três regras:
 *
 *   1. SÓ O CONTADO MUDA. O esperado é o que o sistema apurou no fechamento e
 *      continua o mesmo: corrigir é dizer o que tinha na gaveta e na
 *      maquininha, não mexer no que o sistema vendeu. A diferença é recalculada
 *      pela mesma conta do fechamento (conferirFechamento).
 *   2. NADA SOME. Cada correção grava quem, quando e o antes e o depois
 *      (CashSessionEdicao). O Histórico marca o caixa como corrigido e mostra
 *      como estava.
 *   3. QUEM CORRIGE É ESCOLHA DO DONO. O dono sempre pode; o funcionário só
 *      com "Corrigir caixa fechado" marcado em Equipe, que nasce desmarcada
 *      (mesma regra de `editar_pedidos`: mexe em dinheiro já fechado).
 *
 * Puro, sem banco: a rota (api/cash-session/editar) e a tela leem daqui.
 */

import { FORMAS_DA_CONFERENCIA, conferirFechamento, lerContado, type ChaveDaConferencia } from "@/lib/conferencia-do-caixa";

/** A chave da permissão no CSV de `User.permissions`. */
export const PERMISSAO_EDITAR_CAIXA = "editar_caixa";

export function podeEditarCaixa(operador: { role?: string | null; permissions?: string | null }): boolean {
  const role = String(operador.role || "").toUpperCase();
  if (role === "ADMIN" || role === "FRANCHISEE") return true;
  return String(operador.permissions || "").split(",").map((p) => p.trim()).includes(PERMISSAO_EDITAR_CAIXA);
}

/** O que a correção mexe — e o que fica guardado no antes e no depois. */
export type RetratoDoContado = {
  closingCash: number | null;
  closingDebit: number | null;
  closingCredit: number | null;
  closingPix: number | null;
  closingVoucher: number | null;
  difference: number | null;
  justification: string | null;
  notes: string | null;
};

const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function retratoDoContado(s: Record<string, unknown>): RetratoDoContado {
  return {
    closingCash: num(s.closingCash),
    closingDebit: num(s.closingDebit),
    closingCredit: num(s.closingCredit),
    closingPix: num(s.closingPix),
    closingVoucher: num(s.closingVoucher),
    difference: num(s.difference),
    justification: s.justification == null ? null : String(s.justification),
    notes: s.notes == null ? null : String(s.notes),
  };
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * O caixa depois da correção: o contado novo (null = forma não conferida) e
 * a diferença recalculada contra o esperado GRAVADO.
 */
export function aplicarCorrecao(
  s: Record<string, unknown>,
  novo: Record<ChaveDaConferencia, unknown>,
  justificativa: unknown,
): RetratoDoContado {
  const contado = {} as Record<ChaveDaConferencia, number | null>;
  const esperado = {} as Record<ChaveDaConferencia, number>;
  for (const f of FORMAS_DA_CONFERENCIA) {
    const v = lerContado(novo[f.chave]);
    contado[f.chave] = v == null ? null : Math.round(v * 100) / 100;
    esperado[f.chave] = num(s[f.esperado]) ?? 0;
  }
  const { diferenca, semConferencia, naoConferidas } = conferirFechamento(esperado, contado);
  const just = typeof justificativa === "string" ? justificativa.trim() : "";
  return {
    closingCash: contado.cash,
    closingDebit: contado.debit,
    closingCredit: contado.credit,
    closingPix: contado.pix,
    closingVoucher: contado.voucher,
    difference: diferenca,
    justification: just || (s.justification == null ? null : String(s.justification)),
    // A mesma nota do fechamento (api/cash-session, PUT), para quem lê o banco.
    notes: semConferencia
      ? "Sem conferência da gaveta: ninguém digitou a contagem. Sem falta nem sobra gravada."
      : naoConferidas.length > 0
        ? `Não conferido (fora da diferença): ${naoConferidas.map((l) => `${l.nome} (esperado ${brl(l.esperado)})`).join(", ")}.`
        : null,
  };
}

/** As formas cujo contado mudou, para a tela e o registro dizerem o que foi corrigido. */
export function formasAlteradas(antes: RetratoDoContado, depois: RetratoDoContado) {
  return FORMAS_DA_CONFERENCIA
    .map((f) => ({
      chave: f.chave,
      nome: f.nome,
      antes: antes[f.contado as keyof RetratoDoContado] as number | null,
      depois: depois[f.contado as keyof RetratoDoContado] as number | null,
    }))
    .filter((l) => (l.antes == null) !== (l.depois == null) || (l.antes != null && l.depois != null && Math.abs(l.antes - l.depois) > 0.004));
}
