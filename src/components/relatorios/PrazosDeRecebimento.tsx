"use client";
/**
 * O quadro "Prazos de recebimento" do Fluxo de caixa e do Contas a receber:
 * em quantos dias cada forma e cada app cai na conta. Sem nada cadastrado vale
 * o padrão (lib/relatorios/recebiveis.ts) — e o quadro diz qual é padrão.
 * Grava em /api/store/financeiro/fluxo-de-caixa.
 *
 * A taxa aparece ao lado só para leitura: ela é a de Minha loja → Formas de
 * pagamento (a maquininha) e a comissão é a de Financeiro → Configurações (o
 * app) — as mesmas do DRE. Um número em dois lugares seria dois números.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Cópia local do AvisoNoTopo (app/store/financeiro/DespesasLancadas.tsx):
// ainda não há componente compartilhado.
export type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
export function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div role={aviso.tipo === "erro" ? "alert" : "status"} onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

export type PrazoNaTela = { chave: string; rotulo: string; tipo: "LOJA" | "APP"; dias: number; padrao: boolean; taxa: string };

export default function PrazosDeRecebimento({ prazos, aberto: abertoDeInicio, onSalvo }: {
  prazos: PrazoNaTela[];
  aberto?: boolean;
  onSalvo: () => void;
}) {
  const [aberto, setAberto] = useState(Boolean(abertoDeInicio));
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  // O que está gravado vira o texto do campo; o padrão fica vazio, com o número no placeholder.
  useEffect(() => {
    setTextos(Object.fromEntries(prazos.map((p) => [p.chave, p.padrao ? "" : String(p.dias)])));
  }, [prazos]);
  useEffect(() => { if (abertoDeInicio) setAberto(true); }, [abertoDeInicio]);

  const salvar = async () => {
    const limpo: Record<string, string> = {};
    for (const p of prazos) {
      const t = (textos[p.chave] || "").trim();
      if (t && !/^\d{1,3}$/.test(t)) {
        setAviso({ tipo: "erro", titulo: `Prazo de ${p.rotulo} inválido`, detalhe: "Use só o número de dias: 0, 1, 30…" });
        return;
      }
      limpo[p.chave] = t;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/store/financeiro/fluxo-de-caixa", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prazos: limpo }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Não foi possível salvar.");
      setAviso({ tipo: "ok", titulo: "Prazos salvos", detalhe: "O a receber já foi refeito com os prazos novos." });
      onSalvo();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não salvou", detalhe: e?.message });
    } finally {
      setSalvando(false);
    }
  };

  const campo: React.CSSProperties = { width: 56, padding: "6px 8px", borderRadius: 8, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.9rem", fontFamily: "inherit", textAlign: "center" };

  return (
    <section id="prazos" className="fh-relatorio-bloco fh-sem-impressao" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, marginBottom: "1.25rem", overflow: "hidden" }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "0.9rem 1.1rem", background: PALETA.areia, border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span>
          <strong style={{ fontSize: "0.98rem", color: PALETA.carvao }}>⚙️ Prazos de recebimento</strong>
          <span style={{ display: "block", fontSize: "0.76rem", color: PALETA.areiaTinta, marginTop: 2 }}>
            Em quantos dias cada forma cai na sua conta. Confira no extrato da maquininha e no contrato do app.
          </span>
        </span>
        <span style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.marca }}>{aberto ? "fechar" : "ajustar"}</span>
      </button>
      {aberto && (
        <div style={{ padding: "1rem 1.1rem" }}>
          <div style={{ display: "grid", gap: 8 }}>
            {prazos.map((p) => (
              <div key={p.chave} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px dashed ${PALETA.areiaBorda}` }}>
                <span style={{ minWidth: 220, flex: "1 1 220px", fontWeight: 700, fontSize: "0.88rem" }}>
                  {p.rotulo}
                  <span style={{ display: "block", fontWeight: 500, fontSize: "0.74rem", color: PALETA.areiaTinta }}>{p.taxa}</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
                  cai em D+
                  <input type="text" inputMode="numeric" aria-label={`Dias para ${p.rotulo} cair`} value={textos[p.chave] ?? ""} placeholder={String(p.dias)}
                    onChange={(e) => setTextos((t) => ({ ...t, [p.chave]: e.target.value.replace(/\D/g, "").slice(0, 3) }))} style={campo} />
                  dias
                </span>
                {p.padrao && !(textos[p.chave] || "").trim() && (
                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: PALETA.atencao, background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, borderRadius: 999, padding: "2px 8px" }}>
                    prazo padrão
                  </span>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.76rem", color: PALETA.areiaTinta, margin: "0.8rem 0" }}>
            D+0 = cai no mesmo dia da venda; D+1 = no dia seguinte. Cartão, vale, app e site caem em dia útil (sábado e domingo passam para a segunda). Deixe em branco para usar o padrão.
            A taxa da maquininha se ajusta em <Link href="/store/minha-loja" style={{ color: PALETA.marca, fontWeight: 700 }}>Minha loja → Formas de pagamento</Link>;
            a comissão do app em <Link href="/store/financeiro?tab=configuracoes" style={{ color: PALETA.marca, fontWeight: 700 }}>Financeiro → Configurações</Link>.
          </p>
          <button type="button" onClick={salvar} disabled={salvando} className="btn btn-primary">{salvando ? "Salvando…" : "Salvar prazos"}</button>
        </div>
      )}
    </section>
  );
}
