"use client";
/**
 * Como a compra foi paga, para a compra já nascer como conta a pagar
 * (lib/cmv/lancar-compra.ts). Usado na nota com IA do Estoque e na compra sem
 * nota (/store/estoque/compras).
 *
 *   Pago na hora   a conta nasce baixada (Pix, dinheiro, cartão).
 *   A prazo        uma conta por vencimento (boleto do fornecedor).
 *   Não criar      o boleto vai ser lançado à parte em Contas a Pagar.
 */
import React, { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { somarDias } from "@/lib/relatorios/base";
import { lerNumeroBr } from "@/lib/cmv/numero";

export type EstadoDoPagamento = {
  forma: "PAGO" | "A_PRAZO" | "NAO_LANCAR";
  meio: string;
  pagoEm: string;
  parcelas: { vencimento: string; valor: string }[];
};

export const pagamentoInicial = (): EstadoDoPagamento => ({ forma: "PAGO", meio: "PIX", pagoEm: "", parcelas: [] });

/** O corpo que a API espera. */
export function pagamentoParaApi(p: EstadoDoPagamento) {
  if (p.forma === "NAO_LANCAR") return { forma: "NAO_LANCAR" as const };
  if (p.forma === "PAGO") return { forma: "PAGO" as const, meio: p.meio, ...(p.pagoEm ? { pagoEm: p.pagoEm } : {}) };
  return { forma: "A_PRAZO" as const, meio: p.meio || "BOLETO", parcelas: p.parcelas.map((x) => ({ vencimento: x.vencimento, valor: x.valor })) };
}

const MEIOS = [["PIX", "Pix"], ["DINHEIRO", "Dinheiro"], ["CARTAO", "Cartão"], ["BOLETO", "Boleto"], ["TRANSFERENCIA", "Transferência"]];

const r2 = (n: number) => Math.round(n * 100) / 100;
const br = (n: number) => r2(n).toFixed(2).replace(".", ",");

/** Divide o total em `n` vencimentos, de 7 em 7 dias a partir do dia da compra. */
function dividir(total: number, n: number, dia: string) {
  const cada = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    vencimento: somarDias(dia, 7 * (i + 1)),
    valor: br(i === n - 1 ? total - cada * (n - 1) : cada),
  }));
}

export default function PagamentoDaCompra({ valor, onChange, total, dia }: {
  valor: EstadoDoPagamento;
  onChange: (v: EstadoDoPagamento) => void;
  total: number;
  /** Dia da compra: base dos vencimentos. */
  dia: string;
}) {
  const soma = valor.parcelas.reduce((s, p) => s + (lerNumeroBr(p.valor) || 0), 0);
  const fecha = Math.abs(soma - total) <= 0.05;

  // O total muda enquanto a compra é digitada. Se os vencimentos fechavam com o
  // total anterior (ninguém mexeu à mão), redistribui pelo total novo e mantém
  // as datas; se alguém digitou um valor, não mexe.
  const totalAnterior = useRef(total);
  useEffect(() => {
    const antes = totalAnterior.current;
    totalAnterior.current = total;
    if (valor.forma !== "A_PRAZO" || !valor.parcelas.length || Math.abs(antes - total) < 0.005) return;
    if (Math.abs(soma - antes) > 0.05) return;
    const novas = dividir(total, valor.parcelas.length, dia).map((p, i) => ({ ...p, vencimento: valor.parcelas[i]?.vencimento || p.vencimento }));
    onChange({ ...valor, parcelas: novas });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  const botao = (ativo: boolean): React.CSSProperties => ({
    border: `1.5px solid ${ativo ? PALETA.carvao : PALETA.areiaBorda}`, background: ativo ? PALETA.carvao : "#fff", color: ativo ? "#fff" : PALETA.carvao,
    borderRadius: 10, padding: "0.5rem 0.8rem", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
  });
  const entrada: React.CSSProperties = { border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.45rem 0.55rem", fontSize: "0.9rem" };

  return (
    <fieldset style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.8rem 0.9rem", margin: 0, minWidth: 0 }}>
      <legend style={{ fontWeight: 900, fontSize: "0.88rem", padding: "0 6px" }}>Pagamento</legend>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.7rem" }}>
        <button type="button" style={botao(valor.forma === "PAGO")} onClick={() => onChange({ ...valor, forma: "PAGO", meio: valor.meio === "BOLETO" ? "PIX" : valor.meio })}>Pago na hora</button>
        <button type="button" style={botao(valor.forma === "A_PRAZO")} onClick={() => onChange({ ...valor, forma: "A_PRAZO", meio: "BOLETO", parcelas: valor.parcelas.length ? valor.parcelas : dividir(total, 1, dia) })}>A prazo (boleto)</button>
        <button type="button" style={botao(valor.forma === "NAO_LANCAR")} onClick={() => onChange({ ...valor, forma: "NAO_LANCAR" })}>Não criar conta</button>
      </div>

      {valor.forma === "PAGO" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 800, color: PALETA.areiaTinta }}>
            Como pagou
            <select value={valor.meio} onChange={(e) => onChange({ ...valor, meio: e.target.value })} style={entrada}>
              {MEIOS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 800, color: PALETA.areiaTinta }}>
            Pago em
            <input type="date" value={valor.pagoEm || dia} onChange={(e) => onChange({ ...valor, pagoEm: e.target.value })} style={entrada} />
          </label>
          <span style={{ fontSize: "0.78rem", color: PALETA.areiaTinta }}>Entra em Contas a Pagar já como paga.</span>
        </div>
      )}

      {valor.forma === "A_PRAZO" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: "0.78rem", alignItems: "center" }}>
            <span style={{ fontWeight: 800, color: PALETA.areiaTinta }}>Dividir em</span>
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" onClick={() => onChange({ ...valor, parcelas: dividir(total, n, dia) })}
                style={{ ...botao(valor.parcelas.length === n), padding: "0.25rem 0.6rem", fontSize: "0.78rem" }}>{n}x</button>
            ))}
          </div>
          {valor.parcelas.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 800, width: 22, color: PALETA.areiaTinta }}>{i + 1}ª</span>
              <input type="date" aria-label={`Vencimento ${i + 1}`} value={p.vencimento} onChange={(e) => onChange({ ...valor, parcelas: valor.parcelas.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)) })} style={entrada} />
              <span style={{ fontSize: "0.8rem" }}>R$</span>
              <input inputMode="decimal" aria-label={`Valor ${i + 1}`} value={p.valor} onChange={(e) => onChange({ ...valor, parcelas: valor.parcelas.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} style={{ ...entrada, width: 110, textAlign: "right" }} />
              {valor.parcelas.length > 1 && (
                <button type="button" aria-label={`Tirar vencimento ${i + 1}`} onClick={() => onChange({ ...valor, parcelas: valor.parcelas.filter((_, j) => j !== i) })} style={{ border: "none", background: "none", cursor: "pointer", color: PALETA.areiaTinta }}><X size={15} /></button>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => onChange({ ...valor, parcelas: [...valor.parcelas, { vencimento: somarDias(dia, 7 * (valor.parcelas.length + 1)), valor: "" }] })}
              style={{ border: "none", background: "none", color: PALETA.marca, fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> Vencimento
            </button>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: fecha ? PALETA.ok : PALETA.grave }}>
              Soma R$ {br(soma)} {fecha ? "✓ fecha com a compra" : `· a compra é R$ ${br(total)}`}
            </span>
          </div>
        </div>
      )}

      {valor.forma === "NAO_LANCAR" && (
        <p style={{ margin: 0, fontSize: "0.8rem", color: PALETA.atencao, fontWeight: 600 }}>
          A compra entra no estoque e no CMV, mas sem conta a pagar. Lance o boleto em Financeiro › Contas a Pagar, com a categoria "Fornecedores e insumos".
        </p>
      )}
    </fieldset>
  );
}
