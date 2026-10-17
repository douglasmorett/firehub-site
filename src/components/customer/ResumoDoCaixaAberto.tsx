"use client";
import type { CSSProperties } from "react";
import { rotuloDoPapel, type ResumoDoCaixaAberto } from "@/lib/resumo-do-caixa-aberto";

/**
 * O topo do "Movimentar caixa": o caixa aberto, em resumo.
 *
 * Pedido do Allan (Delícia de Casa), aprovado pelo Douglas em 17/10/2026: "em
 * vez de entrada e saída, ter a abertura de caixa, o valor que abriu o caixa,
 * o que entrou de vendas e a saída" — para quem não fica no delivery o tempo
 * inteiro saber quem abriu, com quanto, quanto entrou e conferir a gaveta com
 * as vendas em dinheiro.
 *
 * Os números vêm prontos do servidor (GET /api/cash-session → resumoDoCaixa,
 * lib/resumo-do-caixa-aberto.ts), rearranjados da MESMA apuração que o
 * fechamento confere. A tela não soma nada: o "dinheiro na gaveta" daqui é o
 * dinheiro esperado do fechamento, centavo por centavo.
 */
const fmt = (v: number) =>
  `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "17/10 às 08:12", no fuso da loja. */
function quando(iso: string, fuso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: fuso });
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso });
    return `${dia} às ${hora}`;
  } catch {
    // Fuso inválido gravado na loja: melhor a hora do navegador que nada.
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
}

const rotulo: CSSProperties = { fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.06em", color: "#64748B", textTransform: "uppercase" };

function Linha({ sinal, nome, valor, cor }: { sinal: string; nome: string; valor: number; cor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "0.84rem", color: "#334155", padding: "3px 0" }}>
      <span style={{ width: 12, flexShrink: 0, fontWeight: 900, color: cor || "#94A3B8", textAlign: "center" }}>{sinal}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{nome}</span>
      <span style={{ fontWeight: 800, color: cor || "#0F172A", whiteSpace: "nowrap" }}>{fmt(valor)}</span>
    </div>
  );
}

export default function ResumoDoCaixaAbertoNoMenu({
  resumo,
  carregando,
}: {
  resumo: (ResumoDoCaixaAberto & { fuso: string }) | null;
  carregando: boolean;
}) {
  if (!resumo) {
    // Sem resumo e sem carregar = o servidor não respondeu: some com o bloco
    // em vez de mostrar zeros, que pareceriam um caixa vazio.
    if (!carregando) return null;
    return (
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 14, background: "#F8FAFC", padding: "14px 16px", fontSize: "0.82rem", color: "#94A3B8" }}>
          Carregando o resumo do caixa…
        </div>
      </div>
    );
  }

  const r = resumo;
  return (
    <div style={{ padding: "16px 24px 0" }}>
      <div style={{ border: "1px solid #E2E8F0", borderRadius: 14, background: "#F8FAFC", padding: "14px 16px" }}>
        {/* Quem abriu e quando. Caixa aberto antes deste registro existir
            não tem o "quem": mostra "—", nunca um palpite. */}
        <div style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.5 }}>
          Aberto por{" "}
          {r.abertoPor ? (
            <>
              <strong style={{ color: "#0F172A" }}>{r.abertoPor.nome}</strong>
              <span style={{ color: "#94A3B8" }}> ({rotuloDoPapel(r.abertoPor.papel)})</span>
            </>
          ) : (
            <strong style={{ color: "#0F172A" }}>—</strong>
          )}
          {quando(r.abertoEm, r.fuso) && <span> em <strong style={{ color: "#0F172A" }}>{quando(r.abertoEm, r.fuso)}</strong></span>}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 0, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
            <div style={rotulo}>Abertura</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 900, color: "#0F172A", marginTop: 2 }}>{fmt(r.trocoInicial)}</div>
            <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 1 }}>troco inicial</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
            <div style={rotulo}>Vendas do turno</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 900, color: "#0F172A", marginTop: 2 }}>{fmt(r.vendas.valor)}</div>
            <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 1 }}>
              {r.vendas.qtd === 1 ? "1 venda" : `${r.vendas.qtd} vendas`} · todas as formas
            </div>
          </div>
        </div>

        {/* A gaveta na ordem em que o dinheiro entra — a mesma conta do
            dinheiro esperado do fechamento (lib/esperado-do-turno.ts). */}
        <div style={{ marginTop: 12 }}>
          <div style={{ ...rotulo, marginBottom: 4 }}>Dinheiro na gaveta</div>
          <Linha sinal="" nome="Troco da abertura" valor={r.trocoInicial} />
          <Linha sinal="+" nome="Vendas em dinheiro" valor={r.vendasEmDinheiro} />
          <Linha sinal="+" nome="Entradas (reforço de troco)" valor={r.entradas} cor={r.entradas > 0 ? "#0F766E" : undefined} />
          <Linha sinal="−" nome="Saídas (sangria)" valor={r.saidas} cor={r.saidas > 0 ? "#D14300" : undefined} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, borderTop: "1px solid #E2E8F0", marginTop: 6, paddingTop: 8 }}>
            <span style={{ width: 12, flexShrink: 0, fontWeight: 900, color: "#0F172A", textAlign: "center" }}>=</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: "0.88rem", fontWeight: 800, color: "#0F172A" }}>Deve ter na gaveta agora</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 900, color: "#0F172A", whiteSpace: "nowrap" }}>{fmt(r.dinheiroNaGaveta)}</span>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 6, lineHeight: 1.45 }}>
            É o mesmo dinheiro esperado que o fechamento vai conferir. Cartão, Pix e pago online não ficam na gaveta.
          </div>
        </div>
      </div>
    </div>
  );
}
