"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Download, Printer, Trash2, XCircle } from "lucide-react";
import { listarEtiquetas, fecharEtiquetaSemEstoque } from "@/app/actions/lotes";
import {
  agruparVencimentos, comoFechar, csvDoHistorico, dadosDaReimpressao, diaLocal, somarDias,
  situacaoNoHistorico, textosDasDatas, NOME_DO_TIPO, NOME_DA_CONSERVACAO, type LoteDaEtiqueta,
} from "@/lib/etiqueta-validade";

/**
 * "Vence hoje / amanhã / venceu" — a pergunta que a cozinha faz toda manhã —,
 * com o "usei" e o "descartei" na mesma linha, e o histórico em CSV.
 *
 * O descarte NÃO tem tabela própria: a etiqueta que entrou no estoque baixa
 * pela rota do QR (WASTE, que o Desperdício do Estoque já soma); a que não
 * entrou vira linha sem valor no mesmo Desperdício. Ver `comoFechar`.
 */
type Lote = LoteDaEtiqueta & { code: string };

const GRUPOS = [
  { chave: "venceu", titulo: "Venceu", cor: "#B71C1C", fundo: "#FEF2F2" },
  { chave: "hoje", titulo: "Vence hoje", cor: "#B45309", fundo: "#FFF7E6" },
  { chave: "amanha", titulo: "Vence amanhã", cor: "#1D4ED8", fundo: "#EFF6FF" },
] as const;

export default function VencimentosDasEtiquetas({
  lojaId,
  onReimprimir,
}: {
  lojaId: string;
  onReimprimir: (lote: Lote) => void;
}) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState("");
  const [ocupado, setOcupado] = useState("");

  const hoje = diaLocal(new Date());
  const [de, setDe] = useState(somarDias(hoje, -30));
  const [ate, setAte] = useState(hoje);
  const [historico, setHistorico] = useState<Lote[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await listarEtiquetas("vencimento");
      setLotes(r.lotes as Lote[]);
    } catch {
      setAviso({ tom: "erro", texto: "Não consegui carregar os vencimentos. Atualize a página." });
    } finally {
      setCarregado(true);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const fechar = async (l: Lote, acao: "USEI" | "DESCARTEI") => {
    setConfirmando("");
    setOcupado(l.code);
    try {
      const como = comoFechar(l, lojaId);
      if (como === "OUTRA_LOJA") {
        setAviso({ tom: "erro", texto: "Esta etiqueta foi recebida por outra loja: quem dá baixa é ela." });
        return;
      }
      if (como === "ESTOQUE") {
        // A rota do QR: baixa o insumo, e o descarte vira WASTE no Desperdício.
        const r = await fetch(`/api/lote/${encodeURIComponent(l.code)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acao: acao === "USEI" ? "SAIDA" : "DESCARTE",
            quantidade: l.quantidadeRestante,
            sourceRef: `vencimento-${acao}`,
            observacao: "Lista de vencimento das etiquetas",
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "Não consegui registrar.");
      } else {
        const r = await fecharEtiquetaSemEstoque(l.code, acao);
        if (!r.ok) throw new Error(r.erro);
      }
      setAviso({ tom: "ok", texto: acao === "USEI" ? `${l.productName}: marcado como usado.` : `${l.productName}: descarte registrado no Desperdício do Estoque.` });
      await carregar();
    } catch (e: any) {
      setAviso({ tom: "erro", texto: e?.message || "Não consegui registrar. Tente de novo." });
    } finally {
      setOcupado("");
    }
  };

  const verHistorico = async () => {
    try {
      const r = await listarEtiquetas("historico", de, ate);
      setHistorico(r.lotes as Lote[]);
    } catch {
      setAviso({ tom: "erro", texto: "Não consegui carregar o histórico." });
    }
  };

  const baixarCsv = () => {
    if (!historico) return;
    const blob = new Blob([csvDoHistorico(historico)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `etiquetas-${de}-a-${ate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const grupos = agruparVencimentos(lotes);
  const total = grupos.venceu.length + grupos.hoje.length + grupos.amanha.length;

  const linha = (l: Lote) => {
    const d = dadosDaReimpressao(l);
    const t = textosDasDatas(d);
    const pedindo = confirmando === l.code;
    return (
      <div key={l.code} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #F1F5F9" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "#0F172A" }}>{l.productName}</div>
          <div style={{ fontSize: "0.8rem", color: "#64748B", lineHeight: 1.45 }}>
            {NOME_DO_TIPO[d.tipo]}{d.conservacao ? ` · ${NOME_DA_CONSERVACAO[d.conservacao]}` : ""} · validade <strong>{t.validade}</strong>
            {d.responsavel ? ` · ${d.responsavel}` : ""} · lote {d.lote}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="fh-btn fh-btn--secundario" style={{ height: 40, fontSize: 14 }} disabled={!!ocupado} onClick={() => fechar(l, "USEI")}>
            <Check size={16} /> Usei
          </button>
          {pedindo ? (
            <button className="fh-btn fh-btn--perigo" style={{ height: 40, fontSize: 14 }} disabled={!!ocupado} onClick={() => fechar(l, "DESCARTEI")}>
              <Trash2 size={16} /> Confirmar descarte
            </button>
          ) : (
            <button className="fh-btn fh-btn--secundario" style={{ height: 40, fontSize: 14 }} disabled={!!ocupado} onClick={() => setConfirmando(l.code)}>
              <Trash2 size={16} /> Descartei
            </button>
          )}
          <button className="fh-btn fh-btn--secundario" style={{ height: 40, fontSize: 14 }} disabled={!!ocupado} onClick={() => onReimprimir(l)} title="Reimprime com a MESMA data e validade">
            <Printer size={16} /> Reimprimir
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fh-card" style={{ marginTop: "var(--fh-s6)" }}>
      <div className="fh-card__body">
        <h2 className="fh-h2" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <CalendarClock size={20} /> Vencimentos
        </h2>
        <p className="fh-corpo" style={{ marginBottom: 12 }}>
          O que já venceu, vence hoje ou amanhã. Vencido é separado e descartado: marque aqui para o Desperdício contar.
        </p>

        {aviso && (
          <div className={`fh-aviso fh-aviso--${aviso.tom}`} role={aviso.tom === "erro" ? "alert" : "status"} style={{ marginBottom: 12 }}>
            {aviso.tom === "ok" ? <Check size={18} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span style={{ flex: 1 }}>{aviso.texto}</span>
            <button onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", width: 32, height: 32 }}>✕</button>
          </div>
        )}

        {carregado && total === 0 && (
          <div className="fh-corpo" style={{ color: "#64748B" }}>Nada vencido nem vencendo até amanhã.</div>
        )}

        {GRUPOS.map((g) => grupos[g.chave].length > 0 && (
          <div key={g.chave} style={{ background: g.fundo, borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
            <div style={{ fontWeight: 900, color: g.cor, display: "flex", alignItems: "center", gap: 6 }}>
              {g.chave === "venceu" && <AlertTriangle size={16} />} {g.titulo} ({grupos[g.chave].length})
            </div>
            {grupos[g.chave].map(linha)}
          </div>
        ))}

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>Histórico de etiquetas</summary>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
            <div className="fh-campo">
              <label htmlFor="hist-de">De</label>
              <input id="hist-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div className="fh-campo">
              <label htmlFor="hist-ate">Até</label>
              <input id="hist-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
            <button className="fh-btn fh-btn--secundario" style={{ height: 44 }} onClick={verHistorico}>Ver histórico</button>
            <button className="fh-btn fh-btn--secundario" style={{ height: 44 }} onClick={baixarCsv} disabled={!historico || historico.length === 0}>
              <Download size={16} /> Baixar CSV
            </button>
          </div>
          {historico && (
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              {historico.length === 0 ? (
                <div className="fh-corpo" style={{ color: "#64748B" }}>Nenhuma etiqueta neste período.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748B" }}>
                      {["Produto", "Tipo", "Manipulação", "Validade", "Responsável", "Lote", "Impr.", "Situação", ""].map((h) => (
                        <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((l) => {
                      const d = dadosDaReimpressao(l);
                      const t = textosDasDatas(d);
                      return (
                        <tr key={l.code}>
                          <td style={{ padding: "6px 8px", fontWeight: 700 }}>{l.productName}</td>
                          <td style={{ padding: "6px 8px" }}>{NOME_DO_TIPO[d.tipo]}</td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{t.data}</td>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{t.validade}</td>
                          <td style={{ padding: "6px 8px" }}>{d.responsavel}</td>
                          <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{d.lote}</td>
                          <td style={{ padding: "6px 8px" }}>{l.impressoes ?? 1}</td>
                          <td style={{ padding: "6px 8px" }}>{situacaoNoHistorico(l)}</td>
                          <td style={{ padding: "6px 8px" }}>
                            <button className="fh-btn fh-btn--secundario" style={{ height: 34, fontSize: 13 }} onClick={() => onReimprimir(l)} title="Reimprime com a MESMA data e validade">
                              <Printer size={14} /> Reimprimir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </details>
      </div>
    </div>
  );
}
